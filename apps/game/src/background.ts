/**
 * Scène de fond des menus : un stage et des combattants au repos, derrière l'interface. Elle
 * libère le canvas quand un combat le prend (`release`), et revient d'elle-même ensuite. En
 * « mouvements réduits », une seule image est dessinée.
 *
 * Les écrans peuvent lui demander ce qu'elle montre (SPEC-finition.md, phase 4) : les personnages
 * choisis, dans leurs couleurs, à la sélection ; le stage survolé, à la sélection du stage. La
 * scène est reconstruite après un court délai, pour ne pas la refaire à chaque appui de touche.
 */
import { createRenderer, type Renderer } from '@game/render';
import { createSim, fx, step, type Sim } from '@game/sim-core';
import type { App } from './app.ts';
import { buildFreeConfig, fighterVisuals } from './content.ts';

/** Ce que montre la scène de fond. */
export interface BackgroundScene {
  readonly stage: string;
  readonly fighters: readonly string[];
  readonly palettes?: readonly number[];
}

export const DEFAULT_SCENE: BackgroundScene = { stage: 'belvedere', fighters: ['sorel', 'nacre'] };

/** Délai avant de reconstruire la scène après une demande, en millisecondes. */
const SETTLE_MS = 260;
/** Vitrine : position du premier personnage choisi et écart entre eux, en unités de jeu. */
const SHOWCASE_X = 8;
const SHOWCASE_GAP = 17;

export interface Background {
  /** Rend le canvas au combat qui va commencer. */
  release(): void;
  /** Montre ce stage et ces personnages (au plus 4) ; `null` : la scène par défaut. */
  show(scene: BackgroundScene | null): void;
}

const sameScene = (a: BackgroundScene, b: BackgroundScene): boolean =>
  a.stage === b.stage &&
  a.fighters.join() === b.fighters.join() &&
  (a.palettes ?? []).join() === (b.palettes ?? []).join();

export function createBackground(app: App, inMatch: () => boolean): Background {
  let renderer: Renderer | null = null;
  let sim: Sim | null = null;
  let drawnStill = false;
  let shown: BackgroundScene = DEFAULT_SCENE;
  let wanted: BackgroundScene = DEFAULT_SCENE;
  let wantedAt = 0;
  let idle = new Uint32Array(DEFAULT_SCENE.fighters.length);
  const canvas = app.elements.canvas;

  function create(scene: BackgroundScene): void {
    renderer?.dispose();
    shown = scene;
    // Au moins deux combattants (la simulation l'exige) : un seul choisi, la scène par défaut
    // complète.
    const fighters = scene.fighters.slice(0, 4);
    const palettes = [...(scene.palettes ?? [])];
    for (const extra of DEFAULT_SCENE.fighters) {
      if (fighters.length >= 2) break;
      if (!fighters.includes(extra)) {
        fighters.push(extra);
        palettes.push(0);
      }
    }
    idle = new Uint32Array(fighters.length);
    sim = createSim(buildFreeConfig({ stage: scene.stage, fighters, seed: 7 }));
    if (scene !== DEFAULT_SCENE) {
      // Vitrine : les personnages choisis côte à côte sur la moitié droite, tournés vers
      // l'interface (à gauche). Simulation d'affichage seulement, propre à la scène de fond.
      fighters.forEach((_, p) => {
        sim!.state.posX[p] = fx(SHOWCASE_X + p * SHOWCASE_GAP);
        sim!.state.facing[p] = -1;
      });
    }
    renderer = createRenderer({
      canvas,
      overlay: app.elements.overlay,
      config: sim.config,
      fighterVisuals: fighterVisuals(fighters, palettes),
      ...app.qualityOptions(),
    });
    // Le HUD du renderer (pourcentages) n'a pas de sens derrière les menus.
    app.elements.overlay.hidden = true;
    resize();
    renderer.capture(sim);
    drawnStill = false;
  }

  function resize(): void {
    app.syncQuality(renderer);
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
  app.onFrame((now) => {
    if (inMatch()) return;
    if (renderer === null) create(wanted);
    else if (!sameScene(wanted, shown) && now - wantedAt >= SETTLE_MS) create(wanted);
    if (app.reducedMotion()) {
      if (!drawnStill) renderer!.draw(1);
      drawnStill = true;
      return;
    }
    step(sim!, idle);
    renderer!.capture(sim!);
    app.timeDraw(() => renderer!.draw(1));
  });

  return {
    release,
    show(scene) {
      const next = scene ?? DEFAULT_SCENE;
      if (sameScene(next, wanted)) return;
      wanted = next;
      wantedAt = performance.now();
    },
  };
}
