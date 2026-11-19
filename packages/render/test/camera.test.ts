import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  approachFraming,
  copyFraming,
  ensureVisible,
  frameFighters,
  addShake,
  applyCloseUp,
  cameraPosition,
  closeUpWeight,
  createCloseUp,
  createShake,
  projectX,
  shakeLevel,
  shakeOffset,
  startCloseUp,
  projectY,
  type CameraBounds,
  type Framing,
} from '../src/camera.ts';

const TAN = Math.tan((35 * Math.PI) / 360);

function bounds(aspect = 16 / 9, tilt = 0): CameraBounds {
  return {
    minX: -150,
    maxX: 150,
    minY: -80,
    maxY: 120,
    marginX: 22,
    marginTop: 30,
    marginBottom: 14,
    minViewHeight: 80,
    tanHalfFov: TAN,
    tilt,
    aspect,
  };
}

const framing = (): Framing => ({ centerX: 0, centerY: 0, distance: 0 });

function points(list: [number, number][]): { xs: Float32Array; ys: Float32Array } {
  return {
    xs: Float32Array.from(list.map((p) => p[0])),
    ys: Float32Array.from(list.map((p) => p[1])),
  };
}

/** Demi-étendues de la vue sur le plan de jeu. */
const halfHeight = (f: Framing, b: CameraBounds): number => f.distance * b.tanHalfFov;
const halfWidth = (f: Framing, b: CameraBounds): number => halfHeight(f, b) * b.aspect;

function expectVisible(f: Framing, b: CameraBounds, list: [number, number][]): void {
  for (const [x, y] of list) {
    expect(Math.abs(x - f.centerX)).toBeLessThanOrEqual(halfWidth(f, b) + 1e-6);
    expect(Math.abs(y - f.centerY)).toBeLessThanOrEqual(halfHeight(f, b) + 1e-6);
  }
}

describe('frameFighters', () => {
  it('cadre un combattant seul sans zoomer en dessous de la vue minimale', () => {
    const b = bounds();
    const f = framing();
    const p = points([[10, 0]]);
    frameFighters(p.xs, p.ys, 1, b, f);
    expect(halfHeight(f, b) * 2).toBeCloseTo(80, 6);
    expect(f.centerX).toBeCloseTo(10, 6);
    // La marge haute dépasse la marge basse : la vue est centrée au-dessus des pieds.
    expect(f.centerY).toBeCloseTo(8, 6);
  });

  it('cadre deux combattants éloignés, marges comprises', () => {
    const b = bounds();
    const f = framing();
    const list: [number, number][] = [
      [-50, 0],
      [50, 20],
    ];
    const p = points(list);
    frameFighters(p.xs, p.ys, 2, b, f);
    expect(f.centerX).toBeCloseTo(0, 6);
    expect(halfWidth(f, b)).toBeGreaterThanOrEqual(50 + 22 - 1e-6);
    expectVisible(f, b, list);
    // Les marges sont visibles elles aussi.
    expectVisible(f, b, [
      [-72, -14],
      [72, 50],
    ]);
  });

  it('garde huit combattants à vue', () => {
    const b = bounds();
    const f = framing();
    const list: [number, number][] = [
      [-55, 0],
      [55, 0],
      [-25, 20],
      [25, 20],
      [0, 40],
      [-10, 0],
      [10, 60],
      [40, -30],
    ];
    const p = points(list);
    frameFighters(p.xs, p.ys, 8, b, f);
    expectVisible(f, b, list);
  });

  it('garde à vue des combattants aux quatre coins des zones limites', () => {
    for (const aspect of [16 / 9, 4 / 3, 21 / 9, 1]) {
      const b = bounds(aspect);
      const f = framing();
      const list: [number, number][] = [
        [-150, -80],
        [150, -80],
        [-150, 120],
        [150, 120],
      ];
      const p = points(list);
      frameFighters(p.xs, p.ys, 4, b, f);
      expectVisible(f, b, list);
      expect(f.centerX).toBeCloseTo(0, 6);
      expect(f.centerY).toBeCloseTo(20, 6);
    }
  });

  it('ne recule pas au-delà de ce qui montre toutes les zones limites', () => {
    const b = bounds();
    const f = framing();
    const p = points([
      [-150, -80],
      [150, 120],
    ]);
    frameFighters(p.xs, p.ys, 2, b, f);
    const whole = Math.max(100 / TAN, 150 / (TAN * b.aspect));
    expect(f.distance).toBeCloseTo(whole, 6);
  });

  it('ne montre pas ce qui se trouve au-delà des zones limites quand la vue y tient', () => {
    const b = bounds();
    const f = framing();
    const p = points([[-145, -75]]);
    frameFighters(p.xs, p.ys, 1, b, f);
    expect(f.centerX - halfWidth(f, b)).toBeGreaterThanOrEqual(-150 - 1e-6);
    expect(f.centerY - halfHeight(f, b)).toBeGreaterThanOrEqual(-80 - 1e-6);
    expectVisible(f, b, [[-145, -75]]);
  });

  it('ignore les combattants au-delà de count et ne touche à rien sans combattant', () => {
    const b = bounds();
    const a = framing();
    const c = framing();
    const p = points([
      [0, 0],
      [140, 100],
    ]);
    frameFighters(p.xs, p.ys, 1, b, a);
    const q = points([[0, 0]]);
    frameFighters(q.xs, q.ys, 1, b, c);
    expect(a).toEqual(c);

    const kept: Framing = { centerX: 3, centerY: 4, distance: 5 };
    frameFighters(p.xs, p.ys, 0, b, kept);
    expect(kept).toEqual({ centerX: 3, centerY: 4, distance: 5 });
  });
});

describe('approachFraming', () => {
  it("se rapproche de la cible sans l'atteindre d'un coup, puis converge", () => {
    const current: Framing = { centerX: 0, centerY: 0, distance: 200 };
    const target: Framing = { centerX: 40, centerY: 10, distance: 300 };
    approachFraming(current, target);
    expect(current.centerX).toBeGreaterThan(0);
    expect(current.centerX).toBeLessThan(40);
    expect(current.distance).toBeGreaterThan(200);
    expect(current.distance).toBeLessThan(300);
    for (let f = 0; f < 240; f++) approachFraming(current, target);
    expect(current.centerX).toBeCloseTo(40, 2);
    expect(current.centerY).toBeCloseTo(10, 2);
    expect(current.distance).toBeCloseTo(300, 1);
  });

  it('recule plus vite qu’elle ne se rapproche', () => {
    const out: Framing = { centerX: 0, centerY: 0, distance: 200 };
    approachFraming(out, { centerX: 0, centerY: 0, distance: 300 });
    const backward = out.distance - 200;
    const inward: Framing = { centerX: 0, centerY: 0, distance: 300 };
    approachFraming(inward, { centerX: 0, centerY: 0, distance: 200 });
    expect(backward).toBeGreaterThan(300 - inward.distance);
  });
});

describe('ensureVisible', () => {
  it('recule juste assez pour montrer un combattant qui sort du cadre', () => {
    const b = bounds();
    const f: Framing = { centerX: 0, centerY: 0, distance: 100 };
    const list: [number, number][] = [[120, 0]];
    const p = points(list);
    ensureVisible(f, p.xs, p.ys, 1, b);
    expect(f.distance).toBeGreaterThan(100);
    expectVisible(f, b, list);
    expectVisible(f, b, [[120 + b.marginX / 2, 0]]);
  });

  it('ne change rien quand tout est déjà visible', () => {
    const b = bounds();
    const f: Framing = { centerX: 0, centerY: 10, distance: 250 };
    const p = points([
      [-20, 0],
      [30, 10],
    ]);
    ensureVisible(f, p.xs, p.ys, 2, b);
    expect(f).toEqual({ centerX: 0, centerY: 10, distance: 250 });
  });

  it('garde tout le monde à vue pendant une éjection rapide', () => {
    const b = bounds();
    const xs = new Float32Array(2);
    const ys = new Float32Array(2);
    const target = framing();
    const current = framing();
    frameFighters(xs, ys, 2, b, current);
    for (let frame = 0; frame < 40; frame++) {
      xs[1] = frame * 3.5;
      ys[1] = frame * 2.5;
      frameFighters(xs, ys, 2, b, target);
      approachFraming(current, target);
      ensureVisible(current, xs, ys, 2, b);
      expectVisible(current, b, [
        [xs[0]!, ys[0]!],
        [xs[1]!, ys[1]!],
      ]);
    }
  });
});

describe('projection', () => {
  it('place le centre de la vue au milieu de l’écran et les bords aux bords', () => {
    const b = bounds();
    const f: Framing = { centerX: 10, centerY: 20, distance: 200 };
    expect(projectX(f, b, 10, 20, 1280)).toBeCloseTo(640, 6);
    expect(projectY(f, b, 20, 720)).toBeCloseTo(360, 6);
    expect(projectX(f, b, 10 - halfWidth(f, b), 20, 1280)).toBeCloseTo(0, 6);
    // L'axe vertical de l'écran pointe vers le bas.
    expect(projectY(f, b, 20 + halfHeight(f, b), 720)).toBeCloseTo(0, 6);
  });

  it('caméra inclinée : la projection est celle de la vraie caméra Three.js', () => {
    const tilt = (7 * Math.PI) / 180;
    const b = bounds(16 / 9, tilt);
    const f: Framing = { centerX: 10, centerY: 20, distance: 200 };
    const camera = new PerspectiveCamera((Math.atan(TAN) * 360) / Math.PI, 16 / 9, 1, 5000);
    const at = { x: 0, y: 0, z: 0 };
    cameraPosition(f, b, at);
    camera.position.set(at.x, at.y, at.z);
    camera.rotation.x = -tilt;
    camera.updateMatrixWorld();
    for (const [x, y] of [
      [10, 20],
      [-60, 70],
      [90, -30],
    ] as const) {
      const v = new Vector3(x, y, 0).project(camera);
      expect(projectX(f, b, x, y, 1280)).toBeCloseTo(((v.x + 1) / 2) * 1280, 3);
      expect(projectY(f, b, y, 720)).toBeCloseTo(((1 - v.y) / 2) * 720, 3);
    }
  });

  it('copie un cadrage', () => {
    const to = framing();
    copyFraming({ centerX: 1, centerY: 2, distance: 3 }, to);
    expect(to).toEqual({ centerX: 1, centerY: 2, distance: 3 });
  });
});

describe('secousse', () => {
  it('s’éteint dans sa durée et se fige avec le temps de la simulation', () => {
    const shake = createShake();
    addShake(shake, 0.02, 20, 100);
    expect(shakeLevel(shake, 100)).toBeCloseTo(0.02, 6);
    expect(shakeLevel(shake, 110)).toBeLessThan(0.02);
    expect(shakeLevel(shake, 120)).toBe(0);
    const a = { x: 0, y: 0 };
    const b2 = { x: 0, y: 0 };
    shakeOffset(shake, 105, 200, bounds(), a);
    shakeOffset(shake, 105, 200, bounds(), b2);
    expect(a).toEqual(b2);
    expect(Math.hypot(a.x, a.y)).toBeGreaterThan(0);
  });

  it('une impulsion plus faible que le reste de la précédente est ignorée', () => {
    const shake = createShake();
    addShake(shake, 0.03, 30, 0);
    addShake(shake, 0.005, 30, 2);
    expect(shake.amount).toBe(0.03);
    addShake(shake, 0.04, 10, 3);
    expect(shake.amount).toBe(0.04);
  });
});

describe('gros plan', () => {
  it('se resserre, tient, puis revient à la vue normale', () => {
    const c = createCloseUp();
    startCloseUp(c, 50, 30, 30, 100);
    expect(closeUpWeight(c, 99)).toBe(0);
    expect(closeUpWeight(c, 110)).toBe(1);
    expect(closeUpWeight(c, 125)).toBeGreaterThan(0);
    expect(closeUpWeight(c, 125)).toBeLessThan(1);
    expect(closeUpWeight(c, 130)).toBe(0);
  });

  it('rapproche la vue du point visé sans passer sous le zoom minimal', () => {
    const b = bounds();
    const c = createCloseUp();
    startCloseUp(c, 50, 30, 30, 0);
    const f: Framing = { centerX: 0, centerY: 0, distance: 300 };
    applyCloseUp(c, 10, b, f);
    expect(f.centerX).toBeCloseTo(50, 6);
    expect(f.distance).toBeLessThan(300);
    const close: Framing = { centerX: 0, centerY: 0, distance: 130 };
    applyCloseUp(c, 10, b, close);
    expect(close.distance).toBeGreaterThanOrEqual((b.minViewHeight / 2 / TAN) * 0.8 - 1e-9);
  });
});
