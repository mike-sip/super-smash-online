/**
 * Pipeline des modèles glTF animés (assets/fighters/README.md) : contrat des clips, lecture d'un
 * `.glb` réel (la figurine de Sorel exportée par tools/bake-figurine.ts), pilotage par l'état de
 * la simulation et repli sur la figurine.
 */
import { readFileSync } from 'node:fs';
import {
  A_AIR,
  A_ATTACK,
  A_DEAD,
  A_IDLE,
  A_RUN,
  M_JAB,
  M_JAB3,
  createFighterView,
  createSim,
  encodeInput,
  step,
  type FighterView,
} from '@game/sim-core';
import { testConfig } from '@game/sim-core/testing';
import { AnimationClip, Object3D, Quaternion, VectorKeyframeTrack, type Bone } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  AIR_FALL,
  AIR_RISE,
  ALL_CLIPS,
  MOVE_CLIPS,
  clipCandidates,
} from '../src/fighters/clips.ts';
import { createFigurines } from '../src/fighters/figurine.ts';
import { createGltfFighters } from '../src/fighters/gltf-fighters.ts';
import {
  createFighterModel,
  fighterModel,
  parseFighterModel,
  registerFighterModel,
  type FighterModel,
} from '../src/fighters/model.ts';
import type { FighterVisuals } from '../src/fighters/visual.ts';
import { createRendererWith } from '../src/renderer.ts';
import { fakeBackend } from './helpers.ts';

const GLB = new URL('../../../assets/fighters/sorel/model.glb', import.meta.url);

let sorel: FighterModel;
beforeAll(async () => {
  const bytes = readFileSync(GLB);
  sorel = await parseFighterModel(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  registerFighterModel('test/sorel.glb', sorel);
});

function view(action: number, actionFrame: number, extra: Partial<FighterView> = {}): FighterView {
  return Object.assign(
    createFighterView(),
    { action, actionFrame, grounded: true, facing: 1 },
    extra,
  );
}

function find(root: Object3D, name: string): Object3D {
  const o = root.getObjectByName(name);
  if (o === undefined) throw new Error(`« ${name} » introuvable`);
  return o;
}

/** Orientation de l'avant-bras avant du joueur 0, dans le modèle. */
function forearm(visuals: FighterVisuals): Quaternion {
  return (find(find(visuals.root, 'model-0'), 'forearmF') as Bone).quaternion.clone();
}

function gltfVisuals(players = 2): FighterVisuals {
  const factory = createGltfFighters(
    (p) => (p === 0 ? 'test/sorel.glb' : undefined),
    createFigurines(() => undefined),
  );
  return factory(testConfig(players));
}

describe('contrat des clips', () => {
  it('chaque action a des candidats, du plus précis à « idle »', () => {
    for (let action = 0; action <= 41; action++) {
      for (const air of [AIR_RISE, AIR_FALL]) {
        const names = clipCandidates(action, 0, air, false);
        expect(names.length).toBeGreaterThan(0);
        expect(names[names.length - 1]).toBe('idle');
      }
    }
  });

  it('une attaque retombe sur sa voisine, puis sur « attack »', () => {
    expect(clipCandidates(A_ATTACK, M_JAB3, AIR_FALL, false)).toEqual([
      'jab3',
      'jab2',
      'jab1',
      'attack',
      'idle',
    ]);
    expect(clipCandidates(A_ATTACK, 7, AIR_FALL, true)[0]).toBe('fsmash_charge');
    expect(clipCandidates(A_AIR, 0, AIR_RISE, false)[0]).toBe('jump');
    expect(clipCandidates(A_AIR, 0, AIR_FALL, false)[0]).toBe('fall');
  });

  it('la liste de travail des animateurs couvre toutes les attaques nommées', () => {
    for (const name of MOVE_CLIPS) expect(ALL_CLIPS).toContain(name);
    expect(ALL_CLIPS).toContain('fsmash_charge');
    expect(new Set(ALL_CLIPS).size).toBe(ALL_CLIPS.length);
  });
});

describe('modèle glTF', () => {
  it('relit le .glb exporté : clips, hauteur et cycles de pas', () => {
    for (const name of ['idle', 'walk', 'run', 'jump', 'fall', 'jab1', 'fsmash', 'nair']) {
      expect(sorel.clips.has(name), name).toBe(true);
    }
    expect(sorel.height).toBeGreaterThan(0.5);
    expect(sorel.walkCycle).toBeGreaterThan(0);
    expect(sorel.walkCycle).toBeLessThan(sorel.runCycle);
  });

  it('nettoie les noms de clips préfixés par l’armature (export Blender)', () => {
    const root = new Object3D();
    const clip = new AnimationClip('Armature|Idle', 1, [
      new VectorKeyframeTrack('.position', [0, 1], [0, 0, 0, 0, 1, 0]),
    ]);
    const model = createFighterModel(root, [clip]);
    expect(model.names).toEqual(['idle']);
    expect(model.height).toBe(1);
  });
});

describe('combattants glTF', () => {
  it('le joueur avec modèle est dessiné par le modèle, l’autre garde sa figurine', () => {
    const visuals = gltfVisuals();
    visuals.capture(0, view(A_IDLE, 1));
    visuals.capture(1, view(A_IDLE, 1));
    visuals.update(0, 0, 0, view(A_IDLE, 1), 1);
    visuals.update(1, 10, 0, view(A_IDLE, 1), 1);
    const fighters: Object3D[] = [];
    visuals.root.traverse((o) => {
      if (o.name === 'fighter-0') fighters.push(o);
    });
    // Deux repères « fighter-0 » : la figurine (cachée) et le modèle (visible).
    expect(fighters.map((o) => o.visible).sort()).toEqual([false, true]);
    expect(visuals.root.getObjectByName('model-1')).toBeUndefined();
    visuals.dispose();
  });

  it('un modèle introuvable laisse la figurine', () => {
    const factory = createGltfFighters(
      () => 'absent.glb',
      createFigurines(() => undefined),
    );
    const visuals = factory(testConfig(2));
    expect(visuals.root.getObjectByName('model-0')).toBeUndefined();
    expect(fighterModel('absent.glb')).toBeUndefined();
    visuals.dispose();
  });

  it('la pose suit l’action : le jab plie le bras autrement que le repos', () => {
    const visuals = gltfVisuals();
    visuals.capture(0, view(A_IDLE, 1));
    visuals.update(0, 0, 0, view(A_IDLE, 1), 1);
    const rest = forearm(visuals);
    // Assez de frames pour sortir du fondu et atteindre le coup.
    for (let f = 1; f <= 4; f++) visuals.capture(0, view(A_ATTACK, f, { move: M_JAB }));
    visuals.update(0, 0, 0, view(A_ATTACK, 4, { move: M_JAB }), 1);
    expect(forearm(visuals).angleTo(rest)).toBeGreaterThan(0.05);
    visuals.dispose();
  });

  it('même historique, même image ; une pause ne fait pas bouger le modèle', () => {
    const history = [
      view(A_IDLE, 1),
      view(A_RUN, 1, { velX: 1.5 }),
      view(A_RUN, 2, { velX: 1.5 }),
      view(A_RUN, 3, { velX: 1.5 }),
      view(A_ATTACK, 1, { move: M_JAB }),
      view(A_ATTACK, 2, { move: M_JAB }),
    ];
    const poses = [gltfVisuals(), gltfVisuals()].map((visuals) => {
      for (const v of history) visuals.capture(0, v);
      const last = history[history.length - 1]!;
      visuals.update(0, 0, 0, last, 0.5);
      const a = forearm(visuals);
      visuals.update(0, 0, 0, last, 0.5);
      expect(forearm(visuals).angleTo(a)).toBeLessThan(1e-9);
      visuals.dispose();
      return a;
    });
    expect(poses[0]!.angleTo(poses[1]!)).toBeLessThan(1e-9);
  });

  it('le modèle se cache quand le combattant est hors jeu', () => {
    const visuals = gltfVisuals();
    visuals.capture(0, view(A_DEAD, 1));
    visuals.update(0, 0, 0, view(A_DEAD, 1), 1);
    expect(find(visuals.root, 'model-0').parent!.parent!.visible).toBe(false);
    visuals.dispose();
  });

  it('tourne dans le renderer réel avec une vraie simulation', () => {
    const config = testConfig(2);
    const sim = createSim(config);
    const backend = fakeBackend();
    const renderer = createRendererWith(
      config,
      backend,
      undefined,
      undefined,
      createGltfFighters(
        (p) => (p === 0 ? 'test/sorel.glb' : undefined),
        createFigurines(() => undefined),
      ),
    );
    const inputs = new Uint32Array(2);
    renderer.capture(sim);
    inputs[0] = encodeInput(127, 0, 0);
    for (let f = 0; f < 40; f++) {
      step(sim, inputs);
      renderer.capture(sim);
      renderer.draw(0.5);
    }
    expect(backend.draws).toBe(40);
    expect(backend.scene!.getObjectByName('model-0')).toBeDefined();
    renderer.dispose();
  });
});

describe('matières des modèles', () => {
  it('la matière « player » prend la couleur de chaque joueur', () => {
    const factory = createGltfFighters(
      () => 'test/sorel.glb',
      createFigurines(() => undefined),
    );
    const visuals = factory(testConfig(2));
    const colorOf = (player: number): string => {
      let hex = '';
      find(visuals.root, `model-${player}`).traverse((o) => {
        const m = (o as { material?: unknown }).material;
        for (const mat of Array.isArray(m) ? m : [m]) {
          const named = mat as { name?: string; color?: { getHexString(): string } } | undefined;
          if (named?.name === 'player' && named.color !== undefined)
            hex = named.color.getHexString();
        }
      });
      return hex;
    };
    expect(colorOf(0)).not.toBe('');
    expect(colorOf(0)).not.toBe(colorOf(1));
    visuals.dispose();
  });

  it('les couleurs alternatives du personnage sont dans le modèle', () => {
    expect(sorel.variants.length).toBeGreaterThan(1);
    expect(Object.keys(sorel.variants[1]!)).toContain('primary');
  });
});

describe('modèles du roster', () => {
  /** Clips que chaque personnage anime à la main (tools/characters/<id>.ts). */
  const COMMON = [
    'idle',
    'walk',
    'run',
    'dash',
    'brake',
    'turn',
    'crouch',
    'jumpsquat',
    'jump',
    'double_jump',
    'fall',
    'land',
    'shield',
    'shieldstun',
    'shield_drop',
    'shield_break',
    'spotdodge',
    'roll',
    'airdodge',
    'hitstun',
    'tumble',
    'tech',
    'down',
    'helpless',
    'ledge',
    'ledge_getup',
    'ledge_roll',
    'grab',
    'grab_hold',
    'grabbed',
    'grab_release',
    'throw_forward',
    'throw_back',
    'throw_up',
    'throw_down',
    'item_throw',
    'jab1',
    'jab2',
    'jab3',
    'ftilt',
    'utilt',
    'dtilt',
    'dash_attack',
    'fsmash',
    'usmash',
    'dsmash',
    'fsmash_charge',
    'usmash_charge',
    'dsmash_charge',
    'nair',
    'fair',
    'bair',
    'uair',
    'dair',
    'nspecial',
    'sspecial',
    'uspecial',
    'dspecial',
    'ultimate',
    'ledge_attack',
  ];

  for (const id of ['sorel', 'zephine', 'ferroc', 'nacre']) {
    it(`${id} : modèle animé à la main, tous les clips, couleurs et matière du joueur`, async () => {
      const bytes = readFileSync(
        new URL(`../../../assets/fighters/${id}/model.glb`, import.meta.url),
      );
      const model = await parseFighterModel(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      );
      for (const name of COMMON) expect(model.clips.has(name), `${id} : ${name}`).toBe(true);
      expect(model.height).toBeGreaterThan(0.5);
      expect(model.walkCycle).toBeGreaterThan(0);
      expect(model.walkCycle).toBeLessThan(model.runCycle);
      // Huit couleurs : celle du fichier (vide) et sept variantes.
      expect(model.variants.length).toBe(8);
      const materials = new Set<string>();
      model.scene.traverse((o) => {
        const m = (o as { material?: unknown }).material;
        for (const mat of Array.isArray(m) ? m : [m]) {
          const name = (mat as { name?: string } | undefined)?.name;
          if (name !== undefined) materials.add(name);
        }
      });
      expect(materials).toContain('player');
      expect(materials).toContain('primary');
    });
  }
});
