/**
 * Contrat « Rendu et rollback » de SPEC-netcode.md, vérifié contre le renderer réel (backend
 * sans GPU). Le netcode ne signale que les frames nouvelles, une fois les re-simulations faites :
 * l'application n'appelle `capture` que pour elles. Ce fichier appartient au module `netcode`.
 */
import { describe, expect, it } from 'vitest';
import {
  BTN_ATTACK,
  STATE_BYTES,
  createSim,
  encodeInput,
  fx,
  loadState,
  saveState,
  step,
} from '@game/sim-core';
import { testConfig } from '@game/sim-core/testing';
import { createRendererWith } from '../src/renderer.ts';
import { fakeBackend } from './helpers.ts';

const RUN_RIGHT = encodeInput(127, 0, 0);

function setup() {
  const config = testConfig(2);
  const sim = createSim(config);
  // Le joueur 1 à portée de jab du joueur 0, comme dans events.test.ts.
  sim.state.posX[1] = fx(-27);
  const backend = fakeBackend();
  const renderer = createRendererWith(config, backend);
  const inputs = new Uint32Array(2);
  return {
    sim,
    renderer,
    inputs,
    /** Position horizontale de la caméra dessinée à `alpha`. */
    cameraX(alpha: number): number {
      renderer.draw(alpha);
      return backend.camera!.position.x;
    },
    /** Avance d'une frame avec l'input donné pour le joueur 0, et capture si demandé. */
    advance(input: number, capture: boolean): void {
      inputs[0] = input;
      step(sim, inputs);
      if (capture) renderer.capture(sim);
    },
  };
}

/** Le joueur 0 court 30 frames, puis 5 de plus après une sauvegarde (prédiction). */
function runThenPredict(t: ReturnType<typeof setup>): Uint8Array {
  t.renderer.capture(t.sim);
  for (let f = 0; f < 30; f++) t.advance(RUN_RIGHT, true);
  const saved = new Uint8Array(STATE_BYTES);
  saveState(t.sim, saved);
  for (let f = 0; f < 5; f++) t.advance(RUN_RIGHT, true);
  return saved;
}

describe('rendu et rollback', () => {
  it('contrat : seules les frames nouvelles sont capturées, caméra et interpolation restent continues', () => {
    const t = setup();
    const saved = runThenPredict(t);
    const shownBefore = t.cameraX(1);
    // Correction : le joueur 0 s'était en fait arrêté. Re-simulation sans capture.
    loadState(t.sim, saved);
    for (let f = 0; f < 5; f++) t.advance(0, false);
    // Frame nouvelle : capturée.
    t.advance(0, true);
    // L'image affichée part exactement de la précédente et interpole vers la nouvelle.
    expect(t.cameraX(0)).toBe(shownBefore);
    expect(t.cameraX(1)).not.toBe(t.cameraX(0));
  });

  it('raison du contrat : capturer une frame re-simulée remet l’interpolation et la caméra à zéro', () => {
    const t = setup();
    const saved = runThenPredict(t);
    const shownBefore = t.cameraX(1);
    loadState(t.sim, saved);
    t.advance(0, true); // frame 31 capturée après la frame 35 : hors séquence
    // Plus d'interpolation : l'image ne bouge pas entre alpha 0 et 1, et la caméra a sauté.
    expect(t.cameraX(0)).toBe(t.cameraX(1));
    expect(t.cameraX(0)).not.toBe(shownBefore);
  });

  it('limite connue : un coup qui n’apparaît qu’après correction, dans une frame déjà affichée, n’a pas d’effet', () => {
    const t = setup();
    t.renderer.capture(t.sim);
    const saved = new Uint8Array(STATE_BYTES);
    saveState(t.sim, saved);
    // Prédiction : le joueur 0 ne fait rien pendant 10 frames, toutes affichées.
    for (let f = 0; f < 10; f++) t.advance(0, true);
    expect(t.renderer.effectCount()).toBe(0);
    // Correction : il avait attaqué à la première frame ; son coup touche avant la frame 10.
    loadState(t.sim, saved);
    t.advance(encodeInput(0, 0, BTN_ATTACK), false);
    for (let f = 1; f < 10; f++) t.advance(0, false);
    t.advance(0, true);
    // Le coup a bien eu lieu dans la simulation (le joueur 1 a pris des dégâts)…
    expect(t.sim.state.damage[1]).toBeGreaterThan(0);
    // …mais aucun effet n'est montré : sa frame était déjà affichée.
    expect(t.renderer.effectCount()).toBe(0);
  });
});
