import { describe, expect, it } from 'vitest';
import {
  SNAP_MS,
  addClockSample,
  clockOffset,
  clockRtt,
  createClockEstimator,
  createGameClock,
  frameAt,
  frameFraction,
  gameTime,
} from '../src/clock.ts';
import { FRAME_MS } from '../src/constants.ts';
import { Rng } from './helpers.ts';

/**
 * Simule des échanges : le serveur a l'heure `serverAt(t)` à l'instant réel t, le client
 * `localAt(t)`. Renvoie l'estimateur après `count` pings espacés de `every` ms.
 */
function exchange(options: {
  count: number;
  every: number;
  up: (rng: Rng) => number;
  down: (rng: Rng) => number;
  localRate?: number;
  serverOffset: number;
}) {
  const rng = new Rng(7);
  const c = createClockEstimator();
  const rate = options.localRate ?? 1;
  const localAt = (t: number): number => t * rate;
  const serverAt = (t: number): number => t + options.serverOffset;
  let t = 1000;
  for (let i = 0; i < options.count; i++) {
    const sent = t;
    const atServer = sent + options.up(rng);
    const back = atServer + options.down(rng);
    addClockSample(c, localAt(sent), serverAt(atServer), localAt(back));
    t += options.every;
  }
  // Écart réel à l'heure locale courante.
  const now = localAt(t);
  const real = serverAt(t) - now;
  return { c, now, real };
}

describe('estimation de l’horloge du serveur', () => {
  it('sans échange : rien', () => {
    const c = createClockEstimator();
    expect(clockOffset(c, 0)).toBeNaN();
    expect(clockRtt(c, 0)).toBeNaN();
  });

  it('latence symétrique sans gigue : exacte', () => {
    const { c, now, real } = exchange({
      count: 5,
      every: 100,
      up: () => 30,
      down: () => 30,
      serverOffset: 12_345.5,
    });
    expect(clockOffset(c, now)).toBeCloseTo(real, 9);
    expect(clockRtt(c, now)).toBeCloseTo(60, 9);
  });

  it('avec gigue : retient l’échange le plus court, erreur de quelques ms', () => {
    const { c, now, real } = exchange({
      count: 16,
      every: 100,
      up: (rng) => 25 + rng.float() * 30,
      down: (rng) => 25 + rng.float() * 30,
      serverOffset: -50_000,
    });
    expect(Math.abs(clockOffset(c, now) - real)).toBeLessThan(8);
    expect(clockRtt(c, now)).toBeLessThan(80);
  });

  it('latence asymétrique : erreur de la moitié de la différence (limite connue)', () => {
    const { c, now, real } = exchange({
      count: 5,
      every: 100,
      up: () => 50,
      down: () => 10,
      serverOffset: 0,
    });
    expect(clockOffset(c, now) - real).toBeCloseTo(20, 9);
  });

  it('horloge locale qui dérive de 0,1 % : reste juste à quelques ms près sur une minute', () => {
    for (const rate of [1.001, 0.999]) {
      const { c, now, real } = exchange({
        count: 60,
        every: 1000,
        up: (rng) => 20 + rng.float() * 15,
        down: (rng) => 20 + rng.float() * 15,
        localRate: rate,
        serverOffset: 3000,
      });
      expect(Math.abs(clockOffset(c, now) - real)).toBeLessThan(12);
    }
  });

  it('ignore un échange incohérent (aller-retour négatif)', () => {
    const c = createClockEstimator();
    addClockSample(c, 100, 5, 90);
    expect(clockOffset(c, 100)).toBeNaN();
  });
});

describe('horloge de jeu', () => {
  it('prend la première estimation telle quelle', () => {
    const g = createGameClock();
    expect(gameTime(g, 500, 1000)).toBe(1500);
  });

  it('rejoint une nouvelle estimation d’au plus 6 % du temps écoulé', () => {
    const g = createGameClock();
    gameTime(g, 0, 0);
    // 20 ms d'écart, 100 ms écoulées : au plus 6 ms de correction.
    expect(gameTime(g, 20, 100)).toBeCloseTo(106, 9);
    expect(gameTime(g, 20, 200)).toBeCloseTo(212, 9);
    expect(gameTime(g, 20, 300)).toBeCloseTo(318, 9);
    expect(gameTime(g, 20, 400)).toBeCloseTo(420, 9);
    expect(g.offset).toBe(20);
    // Dans l'autre sens aussi.
    expect(gameTime(g, 10, 500)).toBeCloseTo(514, 9);
  });

  it('ne recule jamais d’une frame entière d’un appel à l’autre lors d’une petite correction', () => {
    const g = createGameClock();
    let previous = gameTime(g, 0, 0);
    for (let t = FRAME_MS; t < 5000; t += FRAME_MS) {
      const now = gameTime(g, -200, t);
      expect(now).toBeGreaterThan(previous);
      previous = now;
    }
    expect(g.offset).toBe(-200);
  });

  it('se recale d’un coup au-delà de 250 ms d’écart', () => {
    const g = createGameClock();
    gameTime(g, 0, 0);
    expect(gameTime(g, SNAP_MS + 1, 16)).toBe(16 + SNAP_MS + 1);
  });
});

describe('frames et fractions', () => {
  it('numérote les frames depuis le départ', () => {
    expect(frameAt(1000, 1000)).toBe(0);
    expect(frameAt(1000 + FRAME_MS * 10.5, 1000)).toBe(10);
    expect(frameAt(999, 1000)).toBe(-1);
    expect(frameFraction(1000 + FRAME_MS * 10.25, 1000)).toBeCloseTo(0.25, 9);
  });
});
