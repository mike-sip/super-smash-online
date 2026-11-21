/**
 * Réverbération par stage (SPEC-finition.md, phase 5), générée : une réponse impulsionnelle de
 * bruit qui décroît, assourdie avec le temps (les aigus s'éteignent plus vite), précédée de
 * quelques réflexions précoces propres au lieu. Aucune image sonore stockée. Logique pure.
 */
import { createNoise, nextNoise } from './synth.ts';

export interface Room {
  /** Durée de la queue, en secondes. */
  readonly seconds: number;
  /** Vitesse de décroissance (plus grand : plus sec). */
  readonly decay: number;
  /** Part de son réverbéré dans le mélange (0 à 1). */
  readonly wet: number;
  /** Fréquence de coupure de départ, en hertz : plus bas, plus sombre. */
  readonly tone: number;
  /** Réflexions précoces : délai (secondes) et gain de chacune. */
  readonly early: readonly (readonly [number, number])[];
}

/** Lieux des stages : terrasse ouverte, lagon, rue au bord de l'eau, vallée. */
export const ROOMS: Readonly<Record<string, Room>> = {
  belvedere: { seconds: 1.5, decay: 3.2, wet: 0.16, tone: 6000, early: [[0.03, 0.3]] },
  recif: {
    seconds: 2.6,
    decay: 2.1,
    wet: 0.22,
    tone: 3200,
    early: [
      [0.05, 0.25],
      [0.11, 0.18],
    ],
  },
  canal: {
    seconds: 1.9,
    decay: 2.7,
    wet: 0.2,
    tone: 4500,
    early: [
      [0.018, 0.4],
      [0.037, 0.3],
      [0.061, 0.22],
    ],
  },
  geysers: {
    seconds: 2.9,
    decay: 1.9,
    wet: 0.22,
    tone: 3800,
    early: [
      [0.08, 0.3],
      [0.19, 0.2],
    ],
  },
  arena: { seconds: 0.8, decay: 4.5, wet: 0.1, tone: 7000, early: [] },
};

/** Réponse impulsionnelle stéréo (canaux décorrélés) de `room`. */
export function impulseResponse(
  room: Room,
  sampleRate: number,
): [left: Float32Array, right: Float32Array] {
  const length = Math.max(1, Math.round(room.seconds * sampleRate));
  const channels: [Float32Array, Float32Array] = [
    new Float32Array(length),
    new Float32Array(length),
  ];
  channels.forEach((out, c) => {
    const noise = createNoise(101 + c * 17);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      // Coupure qui descend avec le temps : la queue s'assombrit.
      const cutoff = room.tone * Math.exp(-t * 1.4);
      const k = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
      low += (nextNoise(noise) - low) * k;
      // Montée de 5 ms (pas de clic), puis décroissance exponentielle.
      const env = Math.min(1, t / 0.005) * Math.exp(-t * room.decay);
      out[i] = low * env;
    }
    for (const [delay, gain] of room.early) {
      const at = Math.round((delay + c * 0.0037) * sampleRate);
      if (at < length) out[at] = out[at]! + gain * (c === 0 ? 1 : -1);
    }
    // Normalisation par l'énergie : toutes les salles ont le même niveau avant le mélange.
    let energy = 0;
    for (let i = 0; i < length; i++) energy += out[i]! * out[i]!;
    const scale = 1 / Math.sqrt(Math.max(energy, 1e-12));
    for (let i = 0; i < length; i++) out[i] = out[i]! * scale;
  });
  return channels;
}
