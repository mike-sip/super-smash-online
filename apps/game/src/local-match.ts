/**
 * Combat local et entraînement : boucle à pas fixe (60 Hz, au plus 5 pas par image), rendu
 * interpolé, son, HUD de match, pause, et fin vers l'écran de résultats.
 *
 * Les joueurs humains lisent leur périphérique par `input` (emplacements 0 à 3 déjà attribués
 * par l'écran de sélection) ; les mannequins de l'entraînement ne décident rien.
 */
import {
  createMatchDomSink,
  createMatchHud,
  createRenderer,
  distinctPalettes,
  SND_FINALE,
  type MatchHud,
  type Renderer,
} from '@game/render';
import {
  createMatchView,
  matchResult,
  readMatch,
  type MatchConfig,
  type MatchResult,
} from '@game/match-rules';
import {
  A_DEAD,
  checksum,
  createFighterView,
  createSim,
  frame,
  knockOut,
  readFighter,
  respawn,
  step,
  type Sim,
} from '@game/sim-core';
import type { ItemFrequency } from '@game/stages-items';
import type { App, Screen } from './app.ts';
import { portraitUrl } from './portraits.ts';
import { isFinalKo, musicTension } from './finale.ts';
import { stageMusic } from './music.ts';
import { buildFreeConfig, buildSimConfig, fighterName, fighterVisuals, lookOf } from './content.ts';
import { createDummyInputs, type DummyMode } from './dummies.ts';
import { createBot, type Bot } from '@game/cpu';
import { createMenuPad, readGamepads } from './menu-pad.ts';
import { button, menu } from './ui/components.ts';
import { el } from './ui/dom.ts';

const STEP_MS = 1000 / 60;
const MAX_STEPS_PER_DRAW = 5;
/** Frames entre un KO et la réapparition, à l'entraînement. */
const RESPAWN_FRAMES = 60;
/** Pause entre la fin du match et l'écran de résultats, en millisecondes. */
const END_DELAY_MS = 1800;

export interface LocalMatchOptions {
  /** Règles ; `null` : entraînement sans fin. */
  readonly match: MatchConfig | null;
  readonly stage: string;
  readonly hazards: boolean;
  /** Un personnage par joueur de la simulation. */
  readonly fighters: readonly string[];
  /** Couleur alternative voulue par joueur ; deux joueurs sur le même personnage diffèrent toujours. */
  readonly palettes?: readonly number[];
  /** Pour chaque joueur de la simulation, l'emplacement `input` qui le pilote, ou -1 (mannequin). */
  readonly controllers: readonly number[];
  readonly dummyMode?: DummyMode;
  /**
   * Adversaires ordinateur (SPEC-finition.md, phase 6) : niveau de 1 à 9 pour chaque joueur
   * piloté par l'ordinateur, `null` sinon. Prioritaire sur les mannequins.
   */
  readonly cpu?: readonly (number | null)[];
  /** Objets à l'entraînement. */
  readonly trainingItems?: ItemFrequency;
  readonly seed?: number;
  readonly onEnd: (result: MatchResult) => void;
  readonly onQuit: () => void;
}

export interface LocalMatch extends Screen {
  readonly sim: () => Sim;
}

export function localMatch(app: App, options: LocalMatchOptions): LocalMatch {
  app.releaseCanvas();
  const players = options.fighters.length;
  const palettes = distinctPalettes(options.fighters, options.palettes ?? []);
  const canvas = app.elements.canvas;
  const overlay = app.elements.overlay;
  const local = new Uint32Array(4);
  const inputs = new Uint32Array(players);
  const deadFrames = new Int32Array(players);
  const view = createFighterView();
  const matchView = createMatchView();
  const pausePad = createMenuPad();

  let sim: Sim;
  let renderer: Renderer;
  let hud: MatchHud | null = null;
  let dummy = createDummyInputs(options.dummyMode ?? 'idle', options.seed ?? 1);
  let bots: (Bot | null)[] = [];
  let paused = false;
  let endedAt: number | null = null;
  /** Le grondement du coup final a déjà été joué pour ce ralenti. */
  let finaleHeard = false;
  let finished = false;
  let last = performance.now();
  let accumulator = 0;

  const pauseMenu = el(
    'div',
    {
      className: 'dialog',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pause-title' },
      data: {},
    },
    [],
  );
  pauseMenu.hidden = true;
  const root = el('section', { className: 'screen clear', attrs: { 'aria-label': 'Combat' } }, [
    pauseMenu,
  ]);

  function start(): void {
    (renderer as Renderer | undefined)?.dispose();
    hud?.dispose();
    hud = null;
    const seed = options.seed ?? (Math.floor(performance.now()) % 0x7fffffff) + 1;
    const choice = {
      stage: options.stage,
      fighters: options.fighters,
      seed,
      hazards: options.hazards,
    };
    sim = createSim(
      options.match === null
        ? buildFreeConfig(choice, options.trainingItems ?? 'off')
        : buildSimConfig(options.match, choice),
    );
    dummy = createDummyInputs(options.dummyMode ?? 'idle', seed);
    // Un bot par joueur ordinateur, recréé à chaque nouvelle simulation (revanche comprise).
    bots = options.fighters.map((id, p) => {
      const level = options.cpu?.[p] ?? null;
      return level === null ? null : createBot(sim, p, { level, fighter: id, seed: seed * 97 + p });
    });
    renderer = createRenderer({
      canvas,
      overlay,
      config: sim.config,
      fighterVisuals: fighterVisuals(options.fighters, palettes),
      ...app.qualityOptions(),
      // Coup final : gros plan et ralenti d'affichage (match avec règles seulement).
      ...(options.match === null
        ? {}
        : {
            isFinal: (p: number) => {
              readMatch(sim, matchView);
              return isFinalKo(matchView, p);
            },
          }),
    });
    if (options.match !== null) {
      const icons = options.fighters.map((id, p) => portraitUrl(id, palettes[p] ?? 0, 'stock', 72));
      hud = createMatchHud(players, createMatchDomSink(overlay, players, icons));
    }
    resize();
    renderer.capture(sim);
    // Son du stage : son thème, sa réverbération, et les touches propres à chaque personnage.
    app.audio.playMusic(stageMusic(options.stage));
    app.audio.setRoom(options.stage);
    app.audio.setThemes(options.fighters.map((id) => lookOf(id)?.vfx));
    app.audio.capture(sim);
    finaleHeard = false;
    deadFrames.fill(0);
    endedAt = null;
    finished = false;
    accumulator = 0;
    last = performance.now();
  }

  function resize(): void {
    app.syncQuality(renderer);
    renderer?.resize(canvas.clientWidth, canvas.clientHeight, app.pixelRatio());
  }

  function simulate(): void {
    app.input.sample(local);
    const f = frame(sim);
    for (let p = 0; p < players; p++) {
      const c = options.controllers[p] ?? -1;
      const bot = bots[p];
      inputs[p] = c >= 0 ? local[c]! : bot != null ? bot.next(sim) : dummy(f, p);
    }
    step(sim, inputs);
    if (options.match === null) {
      for (let p = 0; p < players; p++) {
        readFighter(sim, p, view);
        const waited = view.action === A_DEAD ? deadFrames[p]! + 1 : 0;
        if (waited >= RESPAWN_FRAMES) {
          deadFrames[p] = 0;
          respawn(sim, p);
        } else deadFrames[p] = waited;
      }
    }
    renderer.capture(sim);
    app.audio.capture(sim);
  }

  function setPaused(on: boolean): void {
    if (paused === on) return;
    paused = on;
    app.audio.setPaused(on);
    if (on) {
      const resume = button('Reprendre', () => setPaused(false), {
        primary: true,
        id: 'pause-resume',
      });
      pauseMenu.replaceChildren(
        el('div', { className: 'panel' }, [
          el('h2', { id: 'pause-title', text: 'Pause' }),
          menu('Pause', [
            resume,
            button(
              options.match === null ? 'Remettre à zéro' : 'Recommencer',
              () => {
                setPaused(false);
                start();
              },
              { id: 'pause-restart' },
            ),
            button(
              'Quitter le combat',
              () => {
                setPaused(false);
                finished = true;
                options.onQuit();
              },
              { id: 'pause-quit' },
            ),
          ]),
          el('p', { className: 'muted', text: 'Échap ou Start pour reprendre.' }),
        ]),
      );
      pauseMenu.hidden = false;
      resume.focus();
      app.announce('Pause');
    } else {
      pauseMenu.hidden = true;
      pauseMenu.replaceChildren();
      // Ce qui a servi à fermer la pause ne doit pas jouer.
      app.input.sample(local);
      last = performance.now();
      accumulator = 0;
    }
  }

  window.addEventListener('resize', resize);
  start();

  const screen: LocalMatch = {
    id: options.match === null ? 'training' : 'match-local',
    back: 'pop',
    root,
    get capturesInput() {
      return !paused;
    },
    sim: () => sim,
    onBack: () => setPaused(!paused),
    onKey(event) {
      if (event.key === 'Escape' && !event.repeat) {
        setPaused(!paused);
        return true;
      }
      return false;
    },
    onPad(action) {
      if (action.type === 'start' || (paused && action.type === 'back')) {
        setPaused(false);
        return true;
      }
      return false;
    },
    frame(now) {
      if (finished) return;
      // Start sur une manette pendant le combat : pause.
      if (!paused) {
        for (const action of pausePad.update(
          readGamepads(() => navigator.getGamepads()),
          now,
        )) {
          if (action.type === 'start') {
            setPaused(true);
            return;
          }
        }
      }
      const elapsed = now - last;
      last = now;
      let alpha = 1;
      if (!paused && endedAt === null) {
        // Ralenti du coup final : le temps simulé avance moins vite que le temps réel.
        const scale = renderer.timeScale();
        // Coup final : le grondement part avec le ralenti.
        if (scale < 1 && !finaleHeard) {
          finaleHeard = true;
          app.audio.play(SND_FINALE);
        }
        if (scale >= 1) finaleHeard = false;
        accumulator = Math.min(accumulator + elapsed * scale, MAX_STEPS_PER_DRAW * STEP_MS);
        while (accumulator >= STEP_MS) {
          simulate();
          accumulator -= STEP_MS;
        }
        alpha = accumulator / STEP_MS;
      }
      if (hud !== null) {
        readMatch(sim, matchView);
        hud.update(matchView);
        app.audio.setIntensity(musicTension(matchView));
        if (matchView.phase === 'over' && endedAt === null) {
          endedAt = now;
          app.announce('Fin du match !');
        }
      }
      app.timeDraw(() => renderer.draw(alpha));
      if (endedAt !== null && now - endedAt >= END_DELAY_MS) {
        finished = true;
        options.onEnd(matchResult(sim)!);
      }
    },
    hidden() {
      app.audio.setPaused(false);
    },
    dispose() {
      window.removeEventListener('resize', resize);
      hud?.dispose();
      app.rememberQuality(renderer);
      renderer.dispose();
      hud = null;
    },
  };

  app.test.match = () => {
    if (options.match !== null) readMatch(sim, matchView);
    return {
      frame: frame(sim),
      phase: matchView.phase,
      paused,
      players,
      fighters: options.fighters.map((id) => fighterName(id)),
      stocks: Array.from(matchView.stocks.subarray(0, players)),
    };
  };
  app.test.knockOut = (player: number) => {
    knockOut(sim, player);
    simulate();
  };
  app.test.fastForward = (frames: number) => {
    for (let i = 0; i < frames; i++) simulate();
  };
  app.test.checksumAroundDraw = (): [number, number] => {
    const before = checksum(sim);
    renderer.draw(0.5);
    return [before, checksum(sim)];
  };
  app.test.matchChecksum = () => checksum(sim);

  return screen;
}
