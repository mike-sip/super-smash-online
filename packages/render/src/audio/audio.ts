/**
 * Assemblage Web Audio : contexte, bus, voix en réserve, déverrouillage, musique.
 *
 * Ce fichier reste mince : quel son jouer vient de `cues.ts`, ses échantillons de la banque,
 * le choix de la voix et le volume de `mixer.ts`. Il ne fait que relire des tampons déjà prêts.
 *
 * Graphe :
 *   voix (source → gain → panoramique) ×24 → bus effets ─┐
 *   musique (source en boucle → gain A ou B) → pause → bus musique ─┴→ général → sortie
 */
import { fxToFloat, type Sim } from '@game/sim-core';
import { ROOMS, impulseResponse } from './reverb.ts';
import { createSynthBank, type SoundBank, type SoundData } from './bank.ts';
import { SOUND_COUNT, collectCues, createCueTracker } from './cues.ts';
import {
  SOUND_LEVELS,
  SOUND_PRIORITIES,
  allowSound,
  createJitter,
  createThrottle,
  createVoicePool,
  nextJitter,
  panFor,
  pickVoice,
  resetThrottle,
  takeVoice,
  volumeGain,
} from './mixer.ts';

export interface AudioSettings {
  /** Faux : aucun son. */
  readonly enabled: boolean;
  /** De 0 à 1. */
  readonly effects: number;
  readonly music: number;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { enabled: true, effects: 0.8, music: 0.6 };

export type GameAudioState = 'locked' | 'loading' | 'running' | 'closed';

export interface GameAudioOptions {
  /** Par défaut, la banque synthétisée. */
  readonly bank?: SoundBank;
  readonly settings?: AudioSettings;
}

export interface GameAudio {
  /**
   * À appeler depuis un gestionnaire d'action de l'utilisateur (clic, touche) : crée et démarre
   * le contexte audio. Sans effet une fois le son actif ; peut être rappelé si le navigateur a
   * refusé le premier essai.
   */
  unlock(): void;
  /** `locked` avant le déverrouillage, `loading` tant que la banque se prépare, puis `running`. */
  readonly state: GameAudioState;
  /**
   * À appeler après chaque `step`, comme `Renderer.capture`. Une frame déjà vue ne rejoue rien ;
   * une nouvelle simulation (autre objet `Sim`) repart d'un filtre neuf.
   */
  capture(sim: Sim): void;
  /** Démarre la musique `track` en boucle (identifiant de la banque) ; `null` l'arrête. */
  playMusic(track: string | null): void;
  /** Efface la musique en pause, la rétablit ensuite. */
  setPaused(paused: boolean): void;
  /**
   * Tension de la musique (SPEC-finition.md, phase 5), de 0 à 1 : à 1, elle monte d'un demi-ton et
   * s'éclaircit (dernière vie, dernière minute).
   */
  setIntensity(level: number): void;
  /** Réverbération du lieu (`ROOMS` : un stage), ou `null` pour aucune. */
  setRoom(room: string | null): void;
  /** Joue une fois le jingle `name` (victoire), par-dessus la musique. */
  playJingle(name: string): void;
  /** Thème des effets de chaque joueur, pour les sons des coups spéciaux. */
  setThemes(themes: readonly (string | undefined)[]): void;
  /** Joue le son `sound` (`SND_*`) au centre : planche d'écoute, menus. */
  play(sound: number): void;
  readonly settings: AudioSettings;
  setSettings(settings: AudioSettings): void;
  /** Sons d'effets lancés depuis la création : pour les tests et la vue technique. */
  readonly soundsPlayed: number;
  /** Ferme le contexte audio. */
  dispose(): void;
}

/** Ce que le moteur utilise d'un `AudioContext` : un faux contexte suffit dans les tests. */
export type AudioContextLike = Pick<
  AudioContext,
  | 'currentTime'
  | 'sampleRate'
  | 'state'
  | 'destination'
  | 'createGain'
  | 'createStereoPanner'
  | 'createBufferSource'
  | 'createBuffer'
  | 'resume'
  | 'close'
> &
  Partial<Pick<AudioContext, 'createBiquadFilter' | 'createConvolver'>>;

export const VOICES = 24;
/** Durée des fondus de musique, en secondes. */
const MUSIC_FADE = 0.5;
/** Constante de temps des changements de volume, en secondes : rapides mais sans clic. */
const VOLUME_SMOOTHING = 0.02;
const PAUSE_SMOOTHING = 0.08;
/** Demi-ton, en rapport de vitesse de lecture : la montée de tension. */
const SEMITONE = 1.0595;
/** Coupure de la musique au repos et en pleine tension, en hertz. */
const MUSIC_TONE = 12000;
const MUSIC_TONE_TENSE = 20000;
/** Constante de temps des changements de tension, en secondes : une montée sensible. */
const INTENSITY_SMOOTHING = 0.6;

export function createGameAudio(options: GameAudioOptions = {}): GameAudio {
  return createGameAudioWith(() => new AudioContext({ latencyHint: 'interactive' }), options);
}

/** Construit le moteur sur une fabrique de contexte donnée. Interne : l'API est `createGameAudio`. */
export function createGameAudioWith(
  createContext: () => AudioContextLike,
  options: GameAudioOptions = {},
): GameAudio {
  const bank = options.bank ?? createSynthBank();
  let settings: AudioSettings = { ...(options.settings ?? DEFAULT_AUDIO_SETTINGS) };
  const tracker = createCueTracker();
  const pool = createVoicePool(VOICES);
  const throttle = createThrottle();
  const jitter = createJitter(0x5eed);

  let context: AudioContextLike | undefined;
  let closed = false;
  let bankReady = false;
  let played = 0;
  let paused = false;

  // Construits au déverrouillage, une fois pour toutes.
  let master: GainNode | undefined;
  let effectsBus: GainNode | undefined;
  let musicBus: GainNode | undefined;
  let pauseGain: GainNode | undefined;
  const voiceGains: GainNode[] = [];
  const voicePans: StereoPannerNode[] = [];
  const voiceSources: (AudioBufferSourceNode | null)[] = new Array<AudioBufferSourceNode | null>(
    VOICES,
  ).fill(null);
  const buffers: (AudioBuffer | null)[] = new Array<AudioBuffer | null>(SOUND_COUNT).fill(null);
  const musicGains: GainNode[] = [];
  const musicSources: (AudioBufferSourceNode | null)[] = [null, null];
  /** Tampons des musiques déjà jouées : relancer un morceau ne recopie pas ses échantillons. */
  const musicBuffers = new Map<string, AudioBuffer>();
  let musicSlot = 0;
  let wantedTrack: string | null = null;
  let playingTrack: string | null = null;
  let halfWidth = 100;
  let trackedSim: Sim | null = null;
  let intensity = 0;
  let musicFilter: BiquadFilterNode | undefined;
  let reverb: ConvolverNode | undefined;
  let reverbWet: GainNode | undefined;
  let jingleGain: GainNode | undefined;
  let wantedRoom: string | null = null;
  const rooms = new Map<string, AudioBuffer>();

  const loading = bank.load().then(
    () => {
      bankReady = true;
      prepareBuffers();
    },
    (error: unknown) => {
      // Une banque qui échoue rend le jeu muet, sans l'arrêter.
      console.error('Banque de sons indisponible :', error);
    },
  );
  void loading;

  function toBuffer(data: SoundData): AudioBuffer {
    const ctx = context!;
    const length = data.channels[0]!.length;
    const buffer = ctx.createBuffer(data.channels.length, length, data.sampleRate);
    data.channels.forEach((channel, c) =>
      buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, c),
    );
    return buffer;
  }

  /** Copie les échantillons de la banque dans des tampons Web Audio, une fois. */
  function prepareBuffers(): void {
    if (context === undefined || !bankReady || closed) return;
    for (let id = 0; id < SOUND_COUNT; id++) {
      if (buffers[id] !== null) continue;
      const data = bank.sound(id);
      if (data !== null) buffers[id] = toBuffer(data);
    }
    startMusic();
  }

  function build(ctx: AudioContextLike): void {
    master = ctx.createGain();
    master.connect(ctx.destination);
    effectsBus = ctx.createGain();
    effectsBus.connect(master);
    musicBus = ctx.createGain();
    musicBus.connect(master);
    pauseGain = ctx.createGain();
    pauseGain.gain.value = paused ? 0 : 1;
    // Tension de la musique : un filtre entre la pause et le bus (s'il existe dans ce navigateur).
    if (typeof ctx.createBiquadFilter === 'function') {
      musicFilter = ctx.createBiquadFilter();
      musicFilter.type = 'lowpass';
      musicFilter.frequency.value = MUSIC_TONE;
      pauseGain.connect(musicFilter);
      musicFilter.connect(musicBus);
    } else {
      pauseGain.connect(musicBus);
    }
    for (let v = 0; v < VOICES; v++) {
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      gain.connect(pan);
      pan.connect(effectsBus);
      voiceGains.push(gain);
      voicePans.push(pan);
    }
    for (let slot = 0; slot < 2; slot++) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(pauseGain);
      musicGains.push(gain);
    }
    // Jingles : directement sur le bus de musique, ni filtrés ni coupés par la pause.
    jingleGain = ctx.createGain();
    jingleGain.connect(musicBus);
    // Réverbération : un départ des effets vers une salle, puis vers la sortie.
    if (typeof ctx.createConvolver === 'function') {
      reverb = ctx.createConvolver();
      reverbWet = ctx.createGain();
      reverbWet.gain.value = 0;
      effectsBus.connect(reverb);
      reverb.connect(reverbWet);
      reverbWet.connect(master);
    }
    applySettings(true);
    applyRoom();
  }

  function applySettings(immediate: boolean): void {
    if (context === undefined) return;
    const now = context.currentTime;
    const set = (param: AudioParam, value: number): void => {
      if (immediate) param.value = value;
      else param.setTargetAtTime(value, now, VOLUME_SMOOTHING);
    };
    set(master!.gain, settings.enabled ? 1 : 0);
    set(effectsBus!.gain, volumeGain(settings.effects));
    set(musicBus!.gain, volumeGain(settings.music));
  }

  function running(): boolean {
    return !closed && context !== undefined && context.state === 'running' && bankReady;
  }

  /** Lance l'effet `id` en `pan`. Aucune allocation, hormis le nœud de lecture imposé par Web Audio. */
  function start(id: number, pan: number): void {
    const buffer = buffers[id];
    if (buffer === null || buffer === undefined || !allowSound(throttle, id)) return;
    const ctx = context!;
    const now = ctx.currentTime;
    const priority = SOUND_PRIORITIES[id]!;
    const v = pickVoice(pool, priority, now);
    if (v < 0) return;
    const previous = voiceSources[v];
    if (previous !== null && pool.endsAt[v]! > now) previous.stop();
    const rate = nextJitter(jitter);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(voiceGains[v]!);
    voiceGains[v]!.gain.value = SOUND_LEVELS[id]!;
    voicePans[v]!.pan.value = pan;
    source.start(now);
    voiceSources[v] = source;
    takeVoice(pool, v, priority, now, buffer.duration / rate);
    played++;
  }

  /** Salle de réverbération voulue, calculée une fois par lieu. */
  function applyRoom(): void {
    if (context === undefined || reverb === undefined || reverbWet === undefined) return;
    const room = wantedRoom === null ? undefined : ROOMS[wantedRoom];
    const now = context.currentTime;
    if (room === undefined) {
      reverbWet.gain.setTargetAtTime(0, now, VOLUME_SMOOTHING);
      return;
    }
    try {
      let buffer = rooms.get(wantedRoom!);
      if (buffer === undefined) {
        // La réponse doit avoir la fréquence du contexte (exigence du ConvolverNode).
        const rate = context.sampleRate ?? 22050;
        const [left, right] = impulseResponse(room, rate);
        buffer = context.createBuffer(2, left.length, rate);
        buffer.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
        buffer.copyToChannel(right as Float32Array<ArrayBuffer>, 1);
        rooms.set(wantedRoom!, buffer);
      }
      if (reverb.buffer !== buffer) reverb.buffer = buffer;
      reverbWet.gain.setTargetAtTime(room.wet, now, VOLUME_SMOOTHING);
    } catch (error) {
      // Une réverbération impossible laisse le son sec, sans arrêter le jeu.
      console.warn('Réverbération indisponible :', error);
      reverbWet.gain.setTargetAtTime(0, now, VOLUME_SMOOTHING);
    }
  }

  /** Tension : vitesse de lecture (demi-ton) et éclat de la musique en cours. */
  function applyIntensity(): void {
    if (context === undefined) return;
    const now = context.currentTime;
    const source = musicSources[musicSlot];
    source?.playbackRate.setTargetAtTime(1 + (SEMITONE - 1) * intensity, now, INTENSITY_SMOOTHING);
    musicFilter?.frequency.setTargetAtTime(
      MUSIC_TONE + (MUSIC_TONE_TENSE - MUSIC_TONE) * intensity,
      now,
      INTENSITY_SMOOTHING,
    );
  }

  function startMusic(): void {
    if (!running() || wantedTrack === playingTrack) return;
    // Morceau pas encore rendu : on le demande, l'ancien continue jusqu'à ce qu'il soit prêt.
    if (wantedTrack !== null && bank.music(wantedTrack) === null && bank.ensure !== undefined) {
      const track = wantedTrack;
      void bank.ensure(track).then(() => {
        if (wantedTrack === track) startMusic();
      });
      return;
    }
    const ctx = context!;
    const now = ctx.currentTime;
    // Le morceau en cours s'efface pendant que le suivant arrive.
    const old = musicSources[musicSlot];
    if (old !== null) {
      const gain = musicGains[musicSlot]!.gain;
      gain.cancelScheduledValues(now);
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(0, now + MUSIC_FADE);
      old.stop(now + MUSIC_FADE);
      musicSources[musicSlot] = null;
    }
    playingTrack = wantedTrack;
    if (wantedTrack === null) return;
    const data = bank.music(wantedTrack);
    if (data === null) return;
    musicSlot = 1 - musicSlot;
    const source = ctx.createBufferSource();
    let buffer = musicBuffers.get(wantedTrack);
    if (buffer === undefined) {
      buffer = toBuffer(data);
      musicBuffers.set(wantedTrack, buffer);
    }
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = data.loopStart;
    source.loopEnd = data.loopEnd;
    const gain = musicGains[musicSlot]!.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(0, now);
    gain.linearRampToValueAtTime(1, now + MUSIC_FADE);
    source.connect(musicGains[musicSlot]!);
    source.playbackRate.value = 1 + (SEMITONE - 1) * intensity;
    source.start(now);
    musicSources[musicSlot] = source;
  }

  function startJingle(name: string): void {
    if (!running() || jingleGain === undefined) return;
    const data = bank.music(name);
    if (data === null) {
      if (bank.ensure !== undefined) void bank.ensure(name).then(() => startJingle(name));
      return;
    }
    let buffer = musicBuffers.get(name);
    if (buffer === undefined) {
      buffer = toBuffer(data);
      musicBuffers.set(name, buffer);
    }
    const source = context!.createBufferSource();
    source.buffer = buffer;
    source.connect(jingleGain);
    source.start(context!.currentTime);
  }

  const audio: GameAudio = {
    get state(): GameAudioState {
      if (closed) return 'closed';
      if (context === undefined || context.state !== 'running') return 'locked';
      return bankReady ? 'running' : 'loading';
    },

    get settings() {
      return settings;
    },

    get soundsPlayed() {
      return played;
    },

    unlock() {
      if (closed) return;
      if (context === undefined) {
        context = createContext();
        build(context);
        prepareBuffers();
      }
      if (context.state !== 'running') {
        // Le contexte démarre quand le navigateur l'autorise ; la musique attend ce moment.
        context.resume().then(
          () => startMusic(),
          () => {},
        );
      }
    },

    capture(sim) {
      // Le suivi avance même sans son : au déverrouillage, rien d'ancien ne ressort.
      const count = collectCues(tracker, sim);
      if (sim !== trackedSim) {
        trackedSim = sim;
        const blast = sim.config.stage.blast;
        halfWidth = (fxToFloat(blast.right) - fxToFloat(blast.left)) / 2;
      }
      if (count === 0 || !running() || !settings.enabled) return;
      resetThrottle(throttle);
      const queue = tracker.queue;
      for (let c = 0; c < count; c++) start(queue.sound[c]!, panFor(queue.x[c]!, halfWidth));
    },

    playMusic(track) {
      wantedTrack = track;
      // Un nouveau morceau repart sans tension.
      intensity = 0;
      applyIntensity();
      startMusic();
    },

    setIntensity(level) {
      const next = Math.max(0, Math.min(1, level));
      if (next === intensity) return;
      intensity = next;
      applyIntensity();
    },

    setRoom(room) {
      if (room === wantedRoom) return;
      wantedRoom = room;
      applyRoom();
    },

    playJingle(name) {
      startJingle(name);
    },

    setThemes(themes) {
      tracker.themes = [...themes];
    },

    setPaused(value) {
      if (value === paused) return;
      paused = value;
      if (context === undefined || pauseGain === undefined) return;
      pauseGain.gain.setTargetAtTime(paused ? 0 : 1, context.currentTime, PAUSE_SMOOTHING);
    },

    play(sound) {
      if (!running() || sound < 0 || sound >= SOUND_COUNT) return;
      resetThrottle(throttle);
      start(sound, 0);
    },

    setSettings(next) {
      settings = { ...next };
      applySettings(false);
    },

    dispose() {
      if (closed) return;
      closed = true;
      if (context !== undefined) void context.close().catch(() => {});
    },
  };
  return audio;
}
