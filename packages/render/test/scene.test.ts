/** Ce que le renderer met dans la scène : caméra, mannequins, entités, HUD. Sans WebGL. */
import { describe, expect, it } from 'vitest';
import {
  A_DEAD,
  BTN_SPECIAL,
  MAX_ENTITIES,
  createSim,
  encodeInput,
  fx,
  spawnEntity,
  step,
} from '@game/sim-core';
import { E_BALL, E_SHOT, testConfig } from '@game/sim-core/testing';
import { InstancedMesh, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { isNewEntity } from '../src/entities.ts';
import type { HudSink } from '../src/hud.ts';
import { createRendererWith } from '../src/renderer.ts';
import { fakeBackend } from './helpers.ts';

function setup(players: number, sink?: HudSink) {
  const config = testConfig(players);
  const sim = createSim(config);
  const backend = fakeBackend();
  const renderer = createRendererWith(config, backend, sink);
  renderer.resize(1280, 720, 1);
  const inputs = new Uint32Array(players);
  const advance = (frames = 1): void => {
    for (let f = 0; f < frames; f++) {
      step(sim, inputs);
      renderer.capture(sim);
    }
  };
  const camera = (): PerspectiveCamera => backend.camera as PerspectiveCamera;
  /** Position à l'écran, de -1 à 1 sur chaque axe, d'un point du plan de jeu. */
  const onScreen = (x: number, y: number): Vector3 => {
    camera().updateMatrixWorld();
    return new Vector3(x, y, 0).project(camera());
  };
  const instances = (name: string): InstancedMesh => {
    const found = backend.scene?.getObjectByName(name);
    if (!(found instanceof InstancedMesh)) throw new Error(`Instances ${name} absentes.`);
    return found;
  };
  return { sim, renderer, backend, inputs, advance, onScreen, instances };
}

const posX = (sim: ReturnType<typeof createSim>, i: number): number => sim.state.posX[i]! / fx(1);
const posY = (sim: ReturnType<typeof createSim>, i: number): number => sim.state.posY[i]! / fx(1);

describe('caméra du renderer', () => {
  it('garde les huit combattants à l’écran pendant un combat désordonné', () => {
    const t = setup(8);
    let seed = 12345;
    const random = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 4294967296;
    };
    for (let f = 0; f < 600; f++) {
      if (f % 12 === 0) {
        for (let p = 0; p < 8; p++) {
          t.inputs[p] = encodeInput(
            Math.floor(random() * 255) - 127,
            Math.floor(random() * 255) - 127,
            Math.floor(random() * 32),
          );
        }
      }
      t.advance();
      t.renderer.draw(1);
      for (let p = 0; p < 8; p++) {
        if (t.sim.state.action[p] === A_DEAD) continue;
        const at = t.onScreen(posX(t.sim, p), posY(t.sim, p));
        if (Math.abs(at.x) > 1 || Math.abs(at.y) > 1) {
          throw new Error(`Frame ${f} : le joueur ${p} est hors de l'écran.`);
        }
      }
    }
  });

  it('suit un combattant qui s’éloigne, en douceur', () => {
    const t = setup(2);
    t.advance();
    t.renderer.draw(1);
    const startX = t.backend.camera!.position.x;
    t.inputs[0] = encodeInput(-127, 0, 0);
    let previous = startX;
    for (let f = 0; f < 40; f++) {
      t.advance();
      t.renderer.draw(1);
      const x = t.backend.camera!.position.x;
      // Jamais d'à-coup : la caméra bouge de moins que le combattant le plus rapide.
      expect(Math.abs(x - previous)).toBeLessThan(2);
      previous = x;
    }
    expect(previous).toBeLessThan(startX);
  });

  it('ne cadre plus un combattant KO', () => {
    const t = setup(2);
    t.advance(30);
    // En chute sous le stage, encore vivant : la caméra recule pour le garder à vue.
    t.sim.state.grounded[0] = 0;
    t.sim.state.surface[0] = 0;
    t.sim.state.posY[0] = fx(-55);
    t.advance(2);
    t.renderer.draw(1);
    expect(t.sim.state.action[0]).not.toBe(A_DEAD);
    const wide = t.backend.camera!.position.z;
    t.advance(240);
    t.renderer.draw(1);
    expect(t.sim.state.action[0]).toBe(A_DEAD);
    expect(t.backend.camera!.position.z).toBeLessThan(wide);
    expect(t.backend.camera!.position.x).toBeCloseTo(posX(t.sim, 1), 0);
  });

  it('interpole son déplacement entre deux frames', () => {
    const t = setup(2);
    t.advance();
    t.inputs[0] = encodeInput(-127, 0, 0);
    t.advance(20);
    t.renderer.draw(0);
    const a = t.backend.camera!.position.x;
    t.renderer.draw(1);
    const b = t.backend.camera!.position.x;
    t.renderer.draw(0.5);
    expect(t.backend.camera!.position.x).toBeCloseTo((a + b) / 2, 9);
    expect(a).not.toBe(b);
  });
});

describe('mannequins du renderer', () => {
  it('dessine tous les combattants en deux objets, pas un par membre', () => {
    const t = setup(8);
    t.advance();
    t.renderer.draw(1);
    let meshes = 0;
    t.backend.scene!.getObjectByName('fighters')!.traverse((object) => {
      if (object instanceof InstancedMesh) meshes++;
    });
    expect(meshes).toBe(2);
  });

  it('place le torse d’un combattant debout au-dessus de ses pieds, à sa taille', () => {
    const t = setup(2);
    t.advance();
    t.renderer.draw(1);
    const boxes = t.backend.scene!.getObjectByName('fighters')!.children[0] as InstancedMesh;
    const matrix = new Matrix4();
    const at = new Vector3();
    // Première boîte du joueur 0 : le torse.
    boxes.getMatrixAt(0, matrix);
    at.setFromMatrixPosition(matrix);
    expect(at.x).toBeCloseTo(-35, 0);
    expect(at.y).toBeGreaterThan(12 * 0.45);
    expect(at.y).toBeLessThan(12 * 0.8);
  });

  it('efface un combattant KO', () => {
    const t = setup(2);
    t.advance();
    t.sim.state.grounded[0] = 0;
    t.sim.state.surface[0] = 0;
    t.sim.state.posY[0] = fx(-200);
    t.advance(3);
    t.renderer.draw(1);
    const boxes = t.backend.scene!.getObjectByName('fighters')!.children[0] as InstancedMesh;
    const matrix = new Matrix4();
    boxes.getMatrixAt(0, matrix);
    expect(matrix.determinant()).toBe(0);
    boxes.getMatrixAt(10, matrix);
    expect(matrix.determinant()).not.toBe(0);
  });
});

describe('entités du renderer', () => {
  const visible = (mesh: InstancedMesh): { slot: number; at: Vector3; scale: number }[] => {
    const matrix = new Matrix4();
    const found = [];
    for (let slot = 0; slot < MAX_ENTITIES; slot++) {
      mesh.getMatrixAt(slot, matrix);
      const scale = matrix.getMaxScaleOnAxis();
      if (scale > 0) found.push({ slot, at: new Vector3().setFromMatrixPosition(matrix), scale });
    }
    return found;
  };

  it('affiche chaque entité à sa position, avec le rayon de son type', () => {
    const t = setup(2);
    spawnEntity(t.sim, E_BALL, -1, fx(4), fx(30), 0, 0);
    spawnEntity(t.sim, E_SHOT, 0, fx(-10), fx(7), fx(2.5), 0);
    t.advance();
    t.renderer.draw(1);
    const shown = visible(t.instances('entities'));
    expect(shown.length).toBe(2);
    expect(shown.map((e) => e.scale).sort()).toEqual([1.5, 2]);
  });

  it('interpole un projectile et ne laisse pas de traînée à un nouveau venu', () => {
    const t = setup(2);
    const slot = spawnEntity(t.sim, E_SHOT, 0, fx(-10), fx(7), fx(2.5), 0);
    t.advance();
    t.renderer.draw(0.5);
    // Première frame vue : pas de position précédente à mélanger.
    const first = visible(t.instances('entities'))[0]!;
    expect(first.slot).toBe(slot);
    expect(first.at.x).toBeCloseTo(-7.5, 6);
    t.advance();
    t.renderer.draw(0.5);
    expect(visible(t.instances('entities'))[0]!.at.x).toBeCloseTo(-6.25, 6);
  });

  it('cache une entité disparue', () => {
    const t = setup(2);
    t.inputs[0] = encodeInput(0, 0, BTN_SPECIAL);
    t.advance(1);
    t.inputs[0] = 0;
    t.advance(20);
    t.renderer.draw(1);
    expect(visible(t.instances('entities')).length).toBe(1);
    t.advance(120);
    t.renderer.draw(1);
    expect(visible(t.instances('entities')).length).toBe(0);
  });

  it('reconnaît un emplacement réutilisé', () => {
    expect(isNewEntity(0, 0, 1, 60)).toBe(true);
    expect(isNewEntity(1, 12, 2, 300)).toBe(true);
    expect(isNewEntity(1, 3, 1, 60)).toBe(true);
    expect(isNewEntity(1, 60, 1, 59)).toBe(false);
  });
});

describe('HUD du renderer', () => {
  function recorder(): HudSink & { damage: number[]; tags: Map<number, [number, number]> } {
    const damage: number[] = [];
    const tags = new Map<number, [number, number]>();
    return {
      damage,
      tags,
      setDamage: (player, percent) => (damage[player] = percent),
      setTag: (player, x, y) => tags.set(player, [x, y]),
      setTagVisible() {},
      dispose() {},
    };
  }

  it('affiche les dégâts lus dans la simulation', () => {
    const sink = recorder();
    const t = setup(2, sink);
    t.sim.state.damage[1] = fx(37.5);
    t.advance();
    expect(sink.damage).toEqual([0, 37]);
  });

  it('pose l’étiquette au-dessus de la tête du combattant, à l’écran', () => {
    const sink = recorder();
    const t = setup(2, sink);
    t.advance();
    t.renderer.draw(1);
    const [x, y] = sink.tags.get(0)!;
    const feet = t.onScreen(-35, 0);
    const head = t.onScreen(-35, 12);
    expect(x).toBeCloseTo((feet.x + 1) * 640, 0);
    // Au-dessus de la tête : plus haut à l'écran, donc une ordonnée plus petite.
    expect(y).toBeLessThan((1 - head.y) * 360);
    expect(y).toBeGreaterThan((1 - head.y) * 360 - 40);
  });
});
