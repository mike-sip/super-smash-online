import { describe, expect, it } from 'vitest';
import { A_HITSTUN, A_SHIELD } from '../../src/actions.ts';
import type { EntityDef, HazardDef, StageDef } from '../../src/defs.ts';
import { fx } from '../../src/fixed.ts';
import {
  BTN_SHIELD,
  ENTITY_PASS,
  EV_HIT,
  EV_SHIELD,
  MAX_ENTITIES,
  createEntityView,
  createSim,
  readEntity,
  type Sim,
} from '../../src/index.ts';
import { TEST_ENTITIES, TEST_STAGE, testConfig } from '../../src/testing/fixtures.ts';
import { NEUTRAL, countEvents, hold, place, press } from './helpers.ts';

const JET: EntityDef = {
  name: 'jet',
  radius: fx(4),
  height: fx(30),
  gravity: fx(0),
  lifetime: 1,
  stageCollision: ENTITY_PASS,
  hit: { damage: fx(14), angle: 90, baseKnockback: fx(40), knockbackGrowth: fx(0.9) },
  destroyOnHit: false,
};
const JET_KIND = TEST_ENTITIES.length + 1;

const VENT: HazardDef = {
  x: fx(30),
  y: fx(0),
  kind: JET_KIND,
  period: 200,
  phase: 50,
  duration: 40,
  warning: 30,
};

function hazardSim(hazard: HazardDef = VENT): Sim {
  const stage: StageDef = { ...TEST_STAGE, name: 'hazard', hazards: [hazard] };
  const config = testConfig(2);
  return createSim({ ...config, stage, entities: [...TEST_ENTITIES, JET] });
}

const view = createEntityView();
function jets(sim: Sim): number {
  let n = 0;
  for (let e = 0; e < MAX_ENTITIES; e++)
    if (readEntity(sim, e, view) && view.kind === JET_KIND) n++;
  return n;
}

describe('dangers périodiques', () => {
  it('jaillissent à la phase prévue, pendant `duration` frames, puis à chaque période', () => {
    const sim = hazardSim();
    // Le joueur 1 est déplacé loin de l'évent pour ne pas fausser les comptes.
    place(sim, 1, -50, 1);
    const active: number[] = [];
    for (let f = 0; f < 650; f++) {
      hold(sim, NEUTRAL, 1);
      if (jets(sim) > 0) active.push(f);
    }
    const starts = active.filter((f, i) => i === 0 || active[i - 1] !== f - 1);
    expect(starts).toEqual([50, 250, 450]);
    expect(active.filter((f) => f >= 50 && f < 250)).toHaveLength(40);
    expect(readEntity(sim, 0, view) ? view.owner : -2).toBeLessThan(0);
  });

  it('ne frappent pas pendant l’annonce, puis frappent une seule fois par jet, vers le haut', () => {
    const sim = hazardSim();
    place(sim, 0, 30, 1);
    place(sim, 1, -50, 1);
    hold(sim, NEUTRAL, 50);
    expect(sim.state.damage[0]).toBe(0);
    hold(sim, NEUTRAL, 1);
    expect(countEvents(sim, EV_HIT)).toBe(1);
    expect(sim.events.a[0]).toBe(-1);
    expect(sim.state.damage[0]).toBe(fx(14));
    expect(sim.state.action[0]).toBe(A_HITSTUN);
    let peak = 0;
    for (let f = 0; f < 39; f++) {
      hold(sim, NEUTRAL, 1);
      peak = Math.max(peak, sim.state.posY[0]!);
    }
    expect(sim.state.damage[0]).toBe(fx(14));
    // Éjecté vers le haut, presque à la verticale.
    expect(peak).toBeGreaterThan(fx(20));
    expect(Math.abs(sim.state.posX[0]! - fx(30))).toBeLessThan(fx(5));
  });

  it('touchent sur toute la hauteur de la colonne, pas à côté', () => {
    const high = hazardSim();
    // Plateforme droite du stage de test, à 20 de haut, au-dessus de l'évent.
    high.state.posX[0] = fx(30);
    high.state.posY[0] = fx(20);
    high.state.surface[0] = 1 + TEST_STAGE.solids.length + 1;
    place(high, 1, -50, 1);
    hold(high, NEUTRAL, 51);
    expect(high.state.damage[0]).toBe(fx(14));

    const aside = hazardSim();
    place(aside, 0, 45, 1);
    place(aside, 1, -50, 1);
    hold(aside, NEUTRAL, 60);
    expect(aside.state.damage[0]).toBe(0);
  });

  it('sont bloqués par le bouclier', () => {
    const sim = hazardSim();
    place(sim, 0, 30, 1);
    place(sim, 1, -50, 1);
    hold(sim, press(BTN_SHIELD), 50);
    expect(sim.state.action[0]).toBe(A_SHIELD);
    hold(sim, press(BTN_SHIELD), 1);
    expect(countEvents(sim, EV_SHIELD)).toBe(1);
    expect(sim.state.damage[0]).toBe(0);
  });

  it('restent inactifs sans type d’entité', () => {
    const sim = hazardSim({ ...VENT, kind: 0 });
    place(sim, 0, 30, 1);
    hold(sim, NEUTRAL, 120);
    expect(jets(sim)).toBe(0);
    expect(sim.state.damage[0]).toBe(0);
  });
});
