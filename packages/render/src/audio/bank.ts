/**
 * Banque de sons : d'où viennent les échantillons des effets et des musiques.
 *
 * Aujourd'hui, la banque synthétisée les calcule. Demain, une banque de fichiers d'artiste
 * implémentera la même interface : elle téléchargera et décodera ses fichiers dans `load()` (un
 * `OfflineAudioContext` décode sans action de l'utilisateur) et rendra leurs échantillons. Le
 * moteur audio ne connaît que cette interface.
 */
import { SOUND_COUNT } from './cues.ts';
import {
  JINGLE_STYLES,
  TRACK_STYLES,
  compose,
  composeJingle,
  createMusicRender,
  loopSeconds,
  type TrackStyle,
} from './music.ts';
import { renderSound } from './sounds.ts';
import { SAMPLE_RATE } from './synth.ts';

export interface SoundData {
  readonly sampleRate: number;
  /** Un canal (mono) ou deux (stéréo). */
  readonly channels: readonly Float32Array[];
}

export interface MusicData extends SoundData {
  /** Boucle, en secondes : la lecture reprend à `loopStart` quand elle atteint `loopEnd`. */
  readonly loopStart: number;
  readonly loopEnd: number;
  /** Faux pour un jingle, joué une seule fois. */
  readonly loops?: boolean;
}

/** Source des sons et des musiques : synthèse aujourd'hui, fichiers d'artiste demain. */
export interface SoundBank {
  /** Prépare les sons ; peut être long (synthèse, téléchargement), n'attend pas le déverrouillage. */
  load(): Promise<void>;
  /** Échantillons du son `id` (`SND_*`), ou `null` s'il manque : il est alors muet. */
  sound(id: number): SoundData | null;
  /** Musique `track`, ou `null`. */
  music(track: string): MusicData | null;
  /** Musiques disponibles. */
  readonly tracks: readonly string[];
  /**
   * Prépare la musique `track` si elle ne l'est pas encore (rendu à la demande) ; résolue quand
   * `music(track)` la rend, ou tout de suite si elle est inconnue.
   */
  ensure?(track: string): Promise<void>;
}

export interface SynthBankOptions {
  /** Musiques en boucle ; par défaut, les menus, l'arène d'essai et un thème par stage. */
  readonly styles?: readonly TrackStyle[];
  /** Jingles joués une fois ; par défaut, la victoire de chaque thème. */
  readonly jingles?: readonly TrackStyle[];
  /**
   * Musiques rendues pendant `load()` ; les autres le sont à la première demande (`ensure`).
   * Par défaut, toutes celles de `styles` si elles sont données, sinon les menus seulement.
   */
  readonly eager?: readonly string[];
  readonly sampleRate?: number;
  /** Temps de calcul visé entre deux retours au navigateur, en millisecondes. */
  readonly sliceMs?: number;
  /** Rend la main au navigateur ; par défaut, un `setTimeout` nul. */
  readonly yieldToHost?: () => Promise<void>;
}

const yieldWithTimeout = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * Banque dont tous les sons sont calculés par le code. `load()` les calcule par tranches, en
 * rendant la main entre deux pour ne pas figer la page ; elle compose toutes les musiques de
 * `styles` (une application qui n'a besoin que de celle de son stage n'en passe qu'une).
 */
export function createSynthBank(options: SynthBankOptions = {}): SoundBank {
  const styles = options.styles ?? TRACK_STYLES;
  const jingles = options.jingles ?? (options.styles === undefined ? JINGLE_STYLES : []);
  const eager = new Set(
    options.eager ?? (options.styles === undefined ? [styles[0]!.name] : styles.map((t) => t.name)),
  );
  const sampleRate = options.sampleRate ?? SAMPLE_RATE;
  const sliceMs = options.sliceMs ?? 6;
  const yieldToHost = options.yieldToHost ?? yieldWithTimeout;
  const sounds: (SoundData | null)[] = new Array<SoundData | null>(SOUND_COUNT).fill(null);
  const musics = new Map<string, MusicData>();
  const pending = new Map<string, Promise<void>>();
  let loading: Promise<void> | undefined;
  let sliceStart = performance.now();

  const maybeYield = async (): Promise<void> => {
    if (performance.now() - sliceStart < sliceMs) return;
    await yieldToHost();
    sliceStart = performance.now();
  };

  /** Compose et rend un morceau (en boucle ou jingle), par tranches. */
  async function renderTrack(style: TrackStyle, loops: boolean): Promise<void> {
    const composition = loops ? compose(style) : composeJingle(style);
    const render = createMusicRender(composition, sampleRate);
    while (!render.step()) await maybeYield();
    const { left, right } = render.result();
    const seconds = left.length / sampleRate;
    musics.set(style.name, {
      sampleRate,
      channels: [left, right],
      loopStart: 0,
      loopEnd: loops ? seconds : 0,
      loops,
    });
    // Contrôle de cohérence : la boucle rendue a la durée de la composition.
    if (loops && Math.abs(seconds - loopSeconds(composition)) > 1 / sampleRate) {
      throw new Error(`Musique ${style.name} : longueur de boucle incohérente.`);
    }
  }

  async function run(): Promise<void> {
    sliceStart = performance.now();
    for (let id = 0; id < SOUND_COUNT; id++) {
      sounds[id] = { sampleRate, channels: [renderSound(id, sampleRate)] };
      await maybeYield();
    }
    for (const style of styles) {
      if (!eager.has(style.name)) continue;
      await renderTrack(style, true);
      await maybeYield();
    }
  }

  function ensure(track: string): Promise<void> {
    if (musics.has(track)) return Promise.resolve();
    const known = pending.get(track);
    if (known !== undefined) return known;
    const loop = styles.find((t) => t.name === track);
    const jingle = jingles.find((t) => t.name === track);
    if (loop === undefined && jingle === undefined) return Promise.resolve();
    // Après le chargement principal : les sons d'abord, la musique demandée ensuite.
    const job = (loading ?? Promise.resolve())
      .then(() =>
        musics.has(track) ? undefined : renderTrack((loop ?? jingle)!, loop !== undefined),
      )
      .finally(() => pending.delete(track));
    pending.set(track, job);
    return job;
  }

  return {
    tracks: [...styles, ...jingles].map((style) => style.name),
    load() {
      loading ??= run();
      return loading;
    },
    sound: (id) => sounds[id] ?? null,
    music: (track) => musics.get(track) ?? null,
    ensure,
  };
}
