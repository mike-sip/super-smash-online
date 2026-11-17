/**
 * Scène de fond des menus : un stage et deux combattants au repos, derrière l'interface. Elle
 * libère le canvas quand un combat le prend (`release`), et revient d'elle-même ensuite. En
 * « mouvements réduits », une seule image est dessinée.
 */
import { createRenderer, createStyledMannequins, type Renderer } from '@game/render';
import { createSim, step, type Sim } from '@game/sim-core';
import type { App } from './app.ts';
import { buildFreeConfig, lookOf } from './content.ts';

const FIGHTERS = ['sorel', 'nacre'];

export interface Background {
  /** Rend le canvas au combat qui va commencer. */
  release(): void;
}

export function createBackground(app: App, inMatch: () => boolean): Background {
  let renderer: Renderer | null = null;
  let sim: Sim | null = null;
  let drawnStill = false;
  const idle = new Uint32Array(FIGHTERS.length);
  const canvas = app.elements.canvas;

  function create(): void {
    sim = createSim(buildFreeConfig({ stage: 'belvedere', fighters: FIGHTERS, seed: 7 }));
    renderer = createRenderer({
      canvas,
      overlay: app.elements.overlay,
      config: sim.config,
      fighterVisuals: createStyledMannequins((p) => lookOf(FIGHTERS[p] ?? '')),
    });
    // Le HUD du renderer (pourcentages) n'a pas de sens derrière les menus.
    app.elements.overlay.hidden = true;
    resize();
    renderer.capture(sim);
    drawnStill = false;
  }

  function resize(): void {
    renderer?.resize(canvas.clientWidth, canvas.clientHeight, app.pixelRatio());
    drawnStill = false;
  }

  function release(): void {
    renderer?.dispose();
    renderer = null;
    sim = null;
    app.elements.overlay.hidden = false;
  }

  window.addEventListener('resize', resize);
  app.onFrame(() => {
    if (inMatch()) return;
    if (renderer === null) create();
    if (app.reducedMotion()) {
      if (!drawnStill) renderer!.draw(1);
      drawnStill = true;
      return;
    }
    step(sim!, idle);
    renderer!.capture(sim!);
    app.timeDraw(() => renderer!.draw(1));
  });

  return { release };
}
