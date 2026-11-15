/**
 * Banque de sons : d'où viennent les échantillons des effets et des musiques.
 *
 * Aujourd'hui, la banque synthétisée les calcule. Demain, une banque de fichiers d'artiste
 * implémentera la même interface : elle téléchargera et décodera ses fichiers dans `load()` (un
 * `OfflineAudioContext` décode sans action de l'utilisateur) et rendra leurs échantillons. Le
 * moteur audio ne connaît que cette interface.
 */
import { SOUND_COUNT } from './cues.ts';
import { ARENA_STYLE, compose, createMusicRender, loopSeconds, type TrackStyle } from './music.ts';
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
}

export interface SynthBankOptions {
  /** Musiques à composer ; par défaut, celle du stage de test. */
  readonly styles?: readonly TrackStyle[];
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
  const styles = options.styles ?? [ARENA_STYLE];
  const sampleRate = options.sampleRate ?? SAMPLE_RATE;
  const sliceMs = options.sliceMs ?? 6;
  const yieldToHost = options.yieldToHost ?? yieldWithTimeout;
  const sounds: (SoundData | null)[] = new Array<SoundData | null>(SOUND_COUNT).fill(null);
  const musics = new Map<string, MusicData>();
  let loading: Promise<void> | undefined;

  async function run(): Promise<void> {
    let sliceStart = performance.now();
    const maybeYield = async (): Promise<void> => {
      if (performance.now() - sliceStart < sliceMs) return;
      await yieldToHost();
      sliceStart = performance.now();
    };

    for (let id = 0; id < SOUND_COUNT; id++) {
      sounds[id] = { sampleRate, channels: [renderSound(id, sampleRate)] };
      await maybeYield();
    }
    for (const style of styles) {
      const composition = compose(style);
      const render = createMusicRender(composition, sampleRate);
      while (!render.step()) await maybeYield();
      const { left, right } = render.result();
      musics.set(style.name, {
        sampleRate,
        channels: [left, right],
        loopStart: 0,
        loopEnd: left.length / sampleRate,
      });
      // Contrôle de cohérence : la boucle rendue a la durée de la composition.
      if (Math.abs(left.length / sampleRate - loopSeconds(composition)) > 1 / sampleRate) {
        throw new Error(`Musique ${style.name} : longueur de boucle incohérente.`);
      }
      await maybeYield();
    }
  }

  return {
    tracks: styles.map((style) => style.name),
    load() {
      loading ??= run();
      return loading;
    },
    sound: (id) => sounds[id] ?? null,
    music: (track) => musics.get(track) ?? null,
  };
}
