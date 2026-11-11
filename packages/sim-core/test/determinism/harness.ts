/**
 * Outils communs aux tests de déterminisme, de rollback et au benchmark.
 * Les inputs sont tirés par un générateur propre au harnais, distinct de celui de la simulation.
 */
import { checksum, createSim, step, type Sim, type SimConfig } from '../../src/index.ts';

export class InputStream {
  private x: number;

  constructor(seed: number) {
    this.x = seed | 0 || 1;
  }

  next(): number {
    let x = this.x;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.x = x;
    return x >>> 0;
  }

  /** Entier dans [0, n). */
  range(n: number): number {
    return this.next() % n;
  }

  /**
   * Remplit `out` avec un input par joueur. Un joueur garde son input précédent 3 fois sur 4,
   * comme un humain qui maintient une direction : des inputs entièrement aléatoires à chaque
   * frame n'exerceraient presque aucune mécanique.
   */
  fill(out: Uint32Array): void {
    for (let i = 0; i < out.length; i++) {
      if (this.range(4) === 0) out[i] = this.next();
    }
  }
}

/** Joue `frames` frames d'inputs tirés de `inputSeed` et renvoie la simulation obtenue. */
export function play(config: SimConfig, inputSeed: number, frames: number): Sim {
  const sim = createSim(config);
  const stream = new InputStream(inputSeed);
  const inputs = new Uint32Array(config.fighters.length);
  for (let f = 0; f < frames; f++) {
    stream.fill(inputs);
    step(sim, inputs);
  }
  return sim;
}

export const playChecksum = (config: SimConfig, inputSeed: number, frames: number): number =>
  checksum(play(config, inputSeed, frames));
