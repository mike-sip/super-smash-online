/** Faux contexte Web Audio et fausse banque, pour tester le moteur audio dans Node. */
import type { AudioContextLike } from '../src/audio/audio.ts';
import type { MusicData, SoundBank, SoundData } from '../src/audio/bank.ts';
import { SOUND_COUNT } from '../src/audio/cues.ts';

export class FakeParam {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
  setValueAtTime(value: number): this {
    this.value = value;
    return this;
  }
  setTargetAtTime(value: number): this {
    this.value = value;
    return this;
  }
  linearRampToValueAtTime(value: number): this {
    this.value = value;
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
}

export class FakeNode {
  readonly outputs: FakeNode[] = [];
  connect(node: FakeNode): FakeNode {
    this.outputs.push(node);
    return node;
  }
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
}

export class FakePanner extends FakeNode {
  readonly pan = new FakeParam(0);
}

export class FakeBuffer {
  readonly data: Float32Array[];
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  copyToChannel(source: Float32Array, channel: number): void {
    this.data[channel]!.set(source);
  }
}

export class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  readonly playbackRate = new FakeParam(1);
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  startedAt: number | null = null;
  stopped = false;
  start(when = 0): void {
    this.startedAt = when;
  }
  stop(): void {
    this.stopped = true;
  }
}

export class FakeContext {
  currentTime = 0;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  /** Faux : le navigateur refuse de démarrer le son (pas d'action de l'utilisateur). */
  allowResume = true;
  readonly destination = new FakeNode();
  readonly gains: FakeGain[] = [];
  readonly panners: FakePanner[] = [];
  readonly sources: FakeSource[] = [];
  createGain(): FakeGain {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }
  createStereoPanner(): FakePanner {
    const node = new FakePanner();
    this.panners.push(node);
    return node;
  }
  createBufferSource(): FakeSource {
    const node = new FakeSource();
    this.sources.push(node);
    return node;
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(channels, length, sampleRate);
  }
  resume(): Promise<void> {
    if (this.allowResume && this.state !== 'closed') this.state = 'running';
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }
  /** Sources d'effets (hors musique) démarrées. */
  effects(): FakeSource[] {
    return this.sources.filter((s) => !s.loop && s.startedAt !== null);
  }
  music(): FakeSource[] {
    return this.sources.filter((s) => s.loop);
  }
  get master(): FakeGain {
    return this.gains[0]!;
  }
  get effectsBus(): FakeGain {
    return this.gains[1]!;
  }
  get musicBus(): FakeGain {
    return this.gains[2]!;
  }
  get pause(): FakeGain {
    return this.gains[3]!;
  }
}

export const asContext = (fake: FakeContext): AudioContextLike =>
  fake as unknown as AudioContextLike;

/** Longueur des échantillons du son `id` dans la fausse banque : permet de reconnaître un son. */
export const fakeLength = (id: number): number => 1000 + id;

/** Banque factice : des tampons silencieux, de longueur propre à chaque son. */
export function fakeBank(missing: readonly number[] = []): SoundBank & { loads: number } {
  const bank = {
    loads: 0,
    tracks: ['arena'],
    load(): Promise<void> {
      bank.loads++;
      return Promise.resolve();
    },
    sound(id: number): SoundData | null {
      if (id < 0 || id >= SOUND_COUNT || missing.includes(id)) return null;
      return { sampleRate: 10_000, channels: [new Float32Array(fakeLength(id))] };
    },
    music(track: string): MusicData | null {
      if (track !== 'arena') return null;
      return {
        sampleRate: 1000,
        channels: [new Float32Array(2000), new Float32Array(2000)],
        loopStart: 0,
        loopEnd: 2,
      };
    },
  };
  return bank;
}

/** Laisse s'exécuter les promesses en attente. */
export const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
