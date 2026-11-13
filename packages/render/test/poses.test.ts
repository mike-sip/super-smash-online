import { describe, expect, it } from 'vitest';
import {
  A_AIR,
  A_ATTACK,
  A_CROUCH,
  A_DEAD,
  A_GRAB,
  A_IDLE,
  A_LEDGE,
  A_LEDGE_GETUP,
  A_LEDGE_ROLL,
  A_ROLL,
  A_RUN,
  A_SHIELD,
  A_THROW,
  A_WALK,
  M_FSMASH,
  M_DAIR,
  M_JAB,
  M_NAIR,
  M_NSPECIAL,
  MOVE_SLOTS,
} from '@game/sim-core';
import { TEST_FIGHTER, TEST_HEAVY } from '@game/sim-core/testing';
import {
  POSE_KEYS,
  SHIN,
  THIGH,
  actionTiming,
  computePose,
  createPose,
  createPoseInput,
  displayFrame,
  unwindPose,
  type Pose,
  type PoseInput,
} from '../src/fighters/poses.ts';

const ACTION_COUNT = A_LEDGE_ROLL + 1;
const OFFSET_KEYS = new Set<keyof Pose>(['hipY', 'offsetX', 'offsetY', 'offsetZ']);

function input(action: number, frame: number, move = 0): PoseInput {
  const inp = createPoseInput();
  inp.action = action;
  inp.move = move;
  inp.frame = frame;
  // Les attaques aériennes ne se lancent qu'en l'air.
  const aerial = action === A_ATTACK && move >= M_NAIR && move <= M_DAIR;
  inp.grounded = action !== A_AIR && !aerial;
  actionTiming(TEST_FIGHTER, action, move, inp);
  return inp;
}

function pose(action: number, frame: number, move = 0): Pose {
  const out = createPose();
  computePose(input(action, frame, move), out);
  return out;
}

/** Plus grand écart entre deux poses, toutes articulations confondues. */
function distance(a: Pose, b: Pose): number {
  let max = 0;
  for (const key of POSE_KEYS) max = Math.max(max, Math.abs(a[key] - b[key]));
  return max;
}

/** Durée sur laquelle examiner une action : la sienne si elle est connue, deux secondes sinon. */
const span = (action: number, move = 0): number => input(action, 0, move).total || 120;

const usedMoves: number[] = [];
for (let m = 0; m < MOVE_SLOTS; m++) if (TEST_FIGHTER.moves[m] !== undefined) usedMoves.push(m);

describe('actionTiming', () => {
  it("lit les phases d'une attaque dans MoveDef", () => {
    const jab = input(A_ATTACK, 0, M_JAB);
    expect([jab.start, jab.end, jab.total]).toEqual([3, 4, 16]);
    // Sans hitbox, l'instant fort est celui où le projectile part.
    const shot = input(A_ATTACK, 0, M_NSPECIAL);
    expect([shot.start, shot.end, shot.total]).toEqual([12, 12, 40]);
  });

  it('lit la saisie, les projections et les esquives dans FighterDef', () => {
    const grab = input(A_GRAB, 0);
    expect([grab.start, grab.end, grab.total]).toEqual([6, 8, 34]);
    const backThrow = input(A_THROW, 0, 1);
    expect([backThrow.start, backThrow.end, backThrow.total]).toEqual([16, 16, 34]);
    const roll = input(A_ROLL, 0);
    expect([roll.start, roll.end, roll.total]).toEqual([4, 15, 30]);
  });

  it('donne la distance des remontées de rebord en hauteurs de combattant', () => {
    expect(input(A_LEDGE_GETUP, 0).travel).toBeCloseTo(6 / 12, 6);
    expect(input(A_LEDGE_ROLL, 0).travel).toBeCloseTo(23 / 12, 6);
    const heavy = createPoseInput();
    actionTiming(TEST_HEAVY, A_LEDGE_GETUP, 0, heavy);
    expect(heavy.travel).toBeCloseTo(10 / 18, 6);
  });

  it('remet à zéro les champs d’une action sans durée propre', () => {
    const inp = input(A_ROLL, 0);
    actionTiming(TEST_FIGHTER, A_IDLE, 0, inp);
    expect([inp.start, inp.end, inp.total, inp.travel]).toEqual([0, 0, 0, 0]);
  });
});

describe('computePose', () => {
  it('ne produit que des valeurs finies, pour toute action, toute attaque et toute frame', () => {
    const out = createPose();
    for (let action = 0; action < ACTION_COUNT; action++) {
      const moves = action === A_ATTACK ? usedMoves : action === A_THROW ? [0, 1, 2, 3] : [0];
      for (const move of moves) {
        for (const grounded of [true, false]) {
          for (const velY of [-2.5, 0, 2.5]) {
            const inp = input(action, 0, move);
            inp.grounded = grounded;
            inp.velY = velY;
            inp.forward = velY;
            inp.charge = velY > 0 ? 30 : 0;
            for (let frame = 0; frame <= 200; frame += 0.5) {
              inp.frame = frame;
              computePose(inp, out);
              for (const key of POSE_KEYS) {
                if (!Number.isFinite(out[key])) {
                  throw new Error(`action ${action}, attaque ${move}, frame ${frame} : ${key}`);
                }
              }
            }
          }
        }
      }
    }
  });

  it('donne une pose distincte à chaque action', () => {
    const poses: Pose[] = [];
    for (let action = 0; action < ACTION_COUNT; action++) {
      poses.push(pose(action, Math.floor(span(action) / 2), action === A_ATTACK ? M_JAB : 0));
    }
    for (let a = 0; a < ACTION_COUNT; a++) {
      for (let b = a + 1; b < ACTION_COUNT; b++) {
        if (a === A_DEAD || b === A_DEAD) continue;
        if (distance(poses[a]!, poses[b]!) < 0.15) {
          throw new Error(`Les actions ${a} et ${b} ont la même pose.`);
        }
      }
    }
  });

  it('donne une pose distincte à chaque attaque et à chaque projection, au moment du coup', () => {
    const strikes = usedMoves.map((m) => pose(A_ATTACK, input(A_ATTACK, 0, m).start, m));
    for (let a = 0; a < strikes.length; a++) {
      for (let b = a + 1; b < strikes.length; b++) {
        if (distance(strikes[a]!, strikes[b]!) < 0.15) {
          throw new Error(`Les attaques ${usedMoves[a]} et ${usedMoves[b]} se confondent.`);
        }
      }
    }
    const throws = [0, 1, 2, 3].map((m) => pose(A_THROW, input(A_THROW, 0, m).start, m));
    for (let a = 0; a < 4; a++) {
      for (let b = a + 1; b < 4; b++) {
        expect(distance(throws[a]!, throws[b]!)).toBeGreaterThan(0.15);
      }
    }
  });

  it('reste continue d’une frame à la suivante au sein d’une action', () => {
    for (let action = 0; action < ACTION_COUNT; action++) {
      const moves = action === A_ATTACK ? usedMoves : action === A_THROW ? [0, 1, 2, 3] : [0];
      // Une attaque part en deux ou trois frames : ses membres vont légitimement plus vite.
      const maxAngle = action === A_ATTACK || action === A_THROW || action === A_GRAB ? 2.6 : 1;
      for (const move of moves) {
        const last = span(action, move);
        let before = pose(action, 0, move);
        for (let frame = 1; frame <= last; frame++) {
          const now = pose(action, frame, move);
          for (const key of POSE_KEYS) {
            const limit = OFFSET_KEYS.has(key) ? 0.3 : maxAngle;
            if (Math.abs(now[key] - before[key]) > limit) {
              throw new Error(`action ${action}, attaque ${move}, frame ${frame} : saut de ${key}`);
            }
          }
          before = now;
        }
      }
    }
  });

  it('suit les phases d’une attaque : préparation, coup tenu, retour au repos', () => {
    const jab = input(A_ATTACK, 0, M_JAB);
    const windup = pose(A_ATTACK, 1.5, M_JAB);
    const strike = pose(A_ATTACK, jab.start, M_JAB);
    const held = pose(A_ATTACK, jab.end, M_JAB);
    const done = pose(A_ATTACK, jab.total, M_JAB);
    expect(distance(strike, held)).toBeLessThan(1e-9);
    expect(distance(windup, strike)).toBeGreaterThan(0.5);
    // Bras tendu vers l'avant au moment du coup.
    expect(strike.armF).toBeGreaterThan(1.2);
    expect(Math.abs(strike.foreF)).toBeLessThan(0.3);
    expect(distance(done, pose(A_IDLE, 0))).toBeLessThan(0.1);
  });

  it('fait trembler une attaque en charge sans changer sa pose', () => {
    const still = input(A_ATTACK, 5, M_FSMASH);
    const charging = input(A_ATTACK, 5, M_FSMASH);
    charging.charge = 17;
    const a = createPose();
    const b = createPose();
    computePose(still, a);
    computePose(charging, b);
    expect(distance(a, b)).toBeGreaterThan(0.001);
    expect(distance(a, b)).toBeLessThan(0.2);
  });

  it('garde un pied au sol pour les actions debout', () => {
    for (const action of [A_IDLE, A_WALK, A_RUN, A_CROUCH, A_SHIELD]) {
      for (let frame = 0; frame < 60; frame += 3) {
        const p = pose(action, frame);
        const reach = (leg: number, shin: number): number =>
          THIGH * Math.cos(leg) + SHIN * Math.cos(leg + shin);
        const lowest =
          p.hipY + p.offsetY - Math.max(reach(p.legF, p.shinF), reach(p.legB, p.shinB));
        expect(lowest).toBeCloseTo(0, 6);
      }
    }
  });

  it('accroupit plus bas que debout', () => {
    expect(pose(A_CROUCH, 10).hipY).toBeLessThan(pose(A_IDLE, 10).hipY - 0.1);
  });

  it('amène la remontée de rebord là où la simulation posera le combattant', () => {
    for (const action of [A_LEDGE_GETUP, A_LEDGE_ROLL]) {
      const timing = input(action, 0);
      const start = pose(action, 0);
      const end = pose(action, timing.total);
      expect(start.offsetX).toBeCloseTo(0, 6);
      expect(start.offsetY).toBeCloseTo(0, 6);
      expect(distance(start, pose(A_LEDGE, 0))).toBeLessThan(0.1);
      // Une hauteur de combattant plus haut, et `travel` plus loin sur le stage.
      expect(end.offsetX).toBeCloseTo(timing.travel, 6);
      expect(end.offsetY).toBeCloseTo(1, 6);
      // Debout à l'arrivée : la pose de repos prend le relais sans à-coup.
      end.offsetX = 0;
      end.offsetY = 0;
      unwindPose(end);
      expect(distance(end, pose(A_IDLE, 0))).toBeLessThan(0.1);
    }
  });

  it('monte les bras en montée et les écarte en chute', () => {
    const rising = input(A_AIR, 5);
    rising.velY = 2;
    const falling = input(A_AIR, 5);
    falling.velY = -2;
    const up = createPose();
    const down = createPose();
    computePose(rising, up);
    computePose(falling, down);
    expect(distance(up, down)).toBeGreaterThan(0.5);
  });
});

describe('unwindPose', () => {
  it('ramène les tours complets à leur angle équivalent le plus proche de zéro', () => {
    const p = createPose();
    p.spin = Math.PI * 2 + 0.25;
    p.yaw = -Math.PI * 4 - 0.5;
    unwindPose(p);
    expect(p.spin).toBeCloseTo(0.25, 9);
    expect(p.yaw).toBeCloseTo(-0.5, 9);
  });
});

describe('displayFrame', () => {
  it('avance avec alpha entre deux frames qui se suivent', () => {
    expect(displayFrame(A_WALK, 6, A_WALK, 7, 0)).toBe(6);
    expect(displayFrame(A_WALK, 6, A_WALK, 7, 0.5)).toBe(6.5);
    expect(displayFrame(A_WALK, 6, A_WALK, 7, 1)).toBe(7);
  });

  it('reste figée pendant le hitlag et la charge', () => {
    expect(displayFrame(A_ATTACK, 4, A_ATTACK, 4, 0)).toBe(4);
    expect(displayFrame(A_ATTACK, 4, A_ATTACK, 4, 0.9)).toBe(4);
  });

  it('repart du début pour une nouvelle action ou une action relancée', () => {
    expect(displayFrame(A_IDLE, 40, A_ATTACK, 1, 0.25)).toBe(0.25);
    expect(displayFrame(A_ATTACK, 9, A_ATTACK, 1, 0.5)).toBe(0.5);
    expect(displayFrame(A_IDLE, 40, A_ATTACK, 0, 0.5)).toBe(0);
  });
});
