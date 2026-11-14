import {
  ITEM_MODE_HELD,
  checksum,
  createSim,
  encodeInput,
  fx,
  readPlatform,
  spawnEntity,
  step,
  type SimConfig,
} from '@game/sim-core';
import { TEST_STAGE, testConfig } from '@game/sim-core/testing';
import { STAGES, applyItems, applyStage, itemOf, type ItemId } from '@game/stages-items';
import { Mesh, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { createRendererWith } from '../src/renderer.ts';
import { createStageVisuals, themeFor } from '../src/stages/decor.ts';
import { hazardLevel } from '../src/stages/lowpoly.ts';
import { createItemVisuals } from '../src/stages/items.ts';
import { fakeBackend } from './helpers.ts';

function meshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) out.push(o);
  });
  return out;
}

const withItems = (players: number, id: (typeof STAGES)[number]['id']): SimConfig =>
  applyItems(applyStage(testConfig(players), id), { frequency: 'high' });

describe('décor des stages', () => {
  it('choisit le thème d’après le stage, le décor neutre pour un stage inconnu', () => {
    for (const stage of STAGES) expect(themeFor(stage.def).id).toBe(stage.id);
    expect(themeFor(TEST_STAGE).id).toBe('neutral');
  });

  it('tient le décor de chaque stage en peu de pièces à dessiner', () => {
    for (const stage of STAGES) {
      const visuals = createStageVisuals(applyStage(testConfig(2), stage.id).stage);
      const count = meshes(visuals.root).length;
      // Décor fusionné (éclairé, lumineux), ciel, eau, éléments animés, plateformes mobiles.
      expect(count, stage.id).toBeLessThanOrEqual(8);
      expect(count, stage.id).toBeGreaterThanOrEqual(2);
    }
    // Le décor neutre : une seule géométrie fusionnée pour les blocs et les plateformes.
    expect(meshes(createStageVisuals(TEST_STAGE).root)).toHaveLength(1);
  });

  it('place les plateformes mobiles là où la simulation les a mises, interpolées', () => {
    const config = applyStage(testConfig(2), 'canal');
    const sim = createSim(config);
    const visuals = createStageVisuals(config.stage);
    expect(visuals.movers.map((m) => m.index)).toEqual([0, 1, 2]);
    const inputs = new Uint32Array(2);
    const view = { x1: 0, x2: 0, y: 0 };
    for (let f = 0; f < 100; f++) step(sim, inputs);
    visuals.capture(sim, false);
    readPlatform(sim, 0, view);
    const before = (view.x1 + view.x2) / 2;
    step(sim, inputs);
    visuals.capture(sim, true);
    readPlatform(sim, 0, view);
    const after = (view.x1 + view.x2) / 2;
    expect(after).not.toBe(before);
    const barge = visuals.movers[0]!.mesh;
    visuals.update(101, 1);
    expect(barge.position.x).toBeCloseTo(after, 6);
    visuals.update(101, 0.5);
    expect(barge.position.x).toBeCloseTo((before + after) / 2, 6);
    readPlatform(sim, 1, view);
    visuals.update(101, 1);
    expect(visuals.movers[1]!.mesh.position.y).toBeCloseTo(view.y, 6);
  });

  it('ajoute la vapeur des évents seulement si les dangers sont actifs', () => {
    const steam = (hazards: boolean): number =>
      meshes(
        createStageVisuals(applyStage(testConfig(2), 'geysers', { hazards }).stage).root,
      ).filter((m) => m.name === 'steam').length;
    expect(steam(true)).toBe(2);
    expect(steam(false)).toBe(0);
  });

  it('suit le cycle des dangers : repos, annonce, jet', () => {
    const hazard = { period: 720, phase: 330, duration: 50, warning: 90 };
    expect(hazardLevel(hazard, 100)).toBe(0);
    expect(hazardLevel(hazard, 330 - 45)).toBeCloseTo(0.5, 6);
    expect(hazardLevel(hazard, 330)).toBe(1);
    expect(hazardLevel(hazard, 379)).toBe(1);
    expect(hazardLevel(hazard, 380)).toBe(0);
    expect(hazardLevel(hazard, 330 + 720)).toBe(1);
  });
});

describe('objets', () => {
  function kindOf(config: SimConfig, id: ItemId): number {
    return config.entities!.findIndex((_, k) => itemOf(config, k + 1) === id) + 1;
  }

  it('dessine chaque objet sous sa forme, et laisse les projectiles à entities.ts', () => {
    const config = withItems(2, 'recif');
    const sim = createSim({ ...config, items: undefined });
    const visuals = createItemVisuals(config);
    expect(visuals.handles(1)).toBe(false);
    const galet = kindOf(config, 'galet');
    expect(visuals.handles(galet)).toBe(true);
    const slot = spawnEntity(sim, galet, -1, fx(20), fx(2), 0, 0);
    spawnEntity(sim, kindOf(config, 'baie'), -1, fx(-20), fx(2), 0, 0);
    visuals.capture(sim);
    visuals.begin();
    for (let s = 0; s < 32; s++) visuals.set(s, 0, 0, 0);
    visuals.end();
    expect(visuals.count('galet')).toBe(1);
    expect(visuals.count('baie')).toBe(1);
    expect(visuals.count('baton')).toBe(0);
    expect(slot).toBeGreaterThanOrEqual(0);
  });

  it('fait clignoter un objet libre qui va disparaître', () => {
    const config = withItems(2, 'recif');
    const sim = createSim({ ...config, items: undefined });
    const visuals = createItemVisuals(config);
    const slot = spawnEntity(sim, kindOf(config, 'galet'), -1, fx(20), fx(2), 0, 0);
    const shownAt = (life: number): number => {
      sim.state.eLife[slot] = life;
      visuals.capture(sim);
      visuals.begin();
      visuals.set(slot, 0, 0, 0);
      visuals.end();
      return visuals.count('galet');
    };
    expect(shownAt(600)).toBe(1);
    // Dans les 2 dernières secondes : caché une période de 6 frames sur deux.
    expect(shownAt(6 * 3)).toBe(0);
    expect(shownAt(6 * 4)).toBe(1);
    // Tenu, il ne clignote pas.
    sim.state.eMode[slot] = ITEM_MODE_HELD;
    expect(shownAt(6 * 3)).toBe(1);
  });

  it('dessine le jet de geyser et l’explosion', () => {
    const config = withItems(2, 'geysers');
    const visuals = createItemVisuals(config);
    const jet = config.stage.hazards![0]!.kind;
    const petard = config.entities![kindOf(config, 'petard') - 1]!;
    expect(visuals.handles(jet)).toBe(true);
    expect(visuals.handles(petard.item!.burst!)).toBe(true);
  });
});

describe('non-ingérence sur les vrais stages', () => {
  it('laisse le checksum intact sur chaque stage, objets à « high »', () => {
    for (const stage of STAGES) {
      const config = withItems(4, stage.id);
      const sim = createSim(config);
      const renderer = createRendererWith(config, fakeBackend());
      renderer.resize(1280, 720, 1);
      renderer.setDebug(false);
      const inputs = new Uint32Array(4);
      for (let f = 0; f < 900; f++) {
        inputs[0] = encodeInput(f % 120 < 60 ? 127 : -127, 0, f % 7 === 0 ? 1 << 0 : 0);
        step(sim, inputs);
        const before = checksum(sim);
        renderer.capture(sim);
        renderer.draw(0.5);
        expect(checksum(sim), stage.id).toBe(before);
      }
      renderer.dispose();
    }
  });
});
