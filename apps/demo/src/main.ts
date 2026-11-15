/** Démo jouable : boucle à pas fixe, assemblage de la simulation, du rendu et du son. */
import { KEYBOARD_ID, MAX_LOCAL_PLAYERS, createInput, type Device } from '@game/input';
import { createGameAudio, createRenderer, type Renderer } from '@game/render';
import {
  A_DEAD,
  checksum,
  createFighterView,
  createSim,
  frame,
  readFighter,
  respawn,
  step,
  type Sim,
  type SimConfig,
} from '@game/sim-core';
import { testConfig } from '@game/sim-core/testing';
import { createControls } from './controls.ts';
import { createDummies, type Dummies, type DummyMode } from './dummies.ts';
import { createEntityFeeder, createPerfProbe, type EntityFeeder } from './perf.ts';
import { createRemap, type Remap } from './remap.ts';
import { createSoundPanel, loadAudioSettings } from './sound.ts';
import { createTuning } from './tuning.ts';

const STEP_MS = 1000 / 60;
/** Au-delà, le retard est abandonné : un onglet resté inactif ne rattrape pas des minutes de jeu. */
const MAX_STEPS_PER_DRAW = 5;
/** Frames entre un KO et la réapparition. */
const RESPAWN_FRAMES = 60;

/** `localStorage`, ou rien si le navigateur l'interdit (navigation privée, réglages stricts). */
function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Élément #${id} introuvable.`);
  return found as T;
}

function intParam(params: URLSearchParams, name: string, min: number, max: number, def: number) {
  const value = Number.parseInt(params.get(name) ?? '', 10);
  return Number.isNaN(value) ? def : Math.max(min, Math.min(max, value));
}

const params = new URLSearchParams(location.search);
const dummyCount = intParam(params, 'dummies', 1, 7, 1);
const mode: DummyMode = params.get('mode') === 'random' ? 'random' : 'idle';
const seed = intParam(params, 'seed', 1, 0x7fffffff, 1);
/** Nombre d'entités maintenues en vie, pour le scénario de performance. */
const entityTarget = intParam(params, 'entities', 0, 32, 0);

const players = 1 + dummyCount;
const baseConfig = testConfig(players, seed);
/** Configuration en cours : celle d'origine, ou la copie produite par le panneau de réglage. */
let config: SimConfig = baseConfig;
const canvas = element<HTMLCanvasElement>('game');
const overlay = element('overlay');

// Joueurs locaux : le clavier tient J1 au départ ; chaque périphérique actionné ensuite prend le
// premier emplacement libre, à la place d'un adversaire automatique.
const localPlayers = Math.min(MAX_LOCAL_PLAYERS, players);
const input = createInput({ target: window, players: localPlayers, storage: safeStorage() });
input.assign(0, KEYBOARD_ID);
const localInputs = new Uint32Array(localPlayers);
/** Vrai dès qu'une touche du jeu a servi : le clavier a bien un joueur derrière lui. */
let keyboardUsed = false;
// Créé plus bas, une fois les contrôles de la démo en place.
const remap: { screen: Remap | undefined } = { screen: undefined };

const status = element('status');
let statusTimer = 0;
function announce(message: string): void {
  status.textContent = message;
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => (status.textContent = ''), 5000);
}

function playerOf(device: Device): number {
  for (let p = 0; p < localPlayers; p++) if (input.assigned(p)?.id === device.id) return p;
  return -1;
}

function describe(device: Device): string {
  return device.standard ? device.label : `${device.label} (disposition non standard)`;
}

input.onJoinRequest((device) => {
  // Première manette alors que personne n'a touché au clavier : le joueur est seul et veut
  // jouer à la manette. Elle prend J1 ; le clavier pourra rejoindre ensuite.
  let slot = -1;
  if (device.kind === 'gamepad' && !keyboardUsed && input.assigned(0)?.id === KEYBOARD_ID) {
    slot = 0;
  } else {
    for (let p = 0; p < localPlayers && slot < 0; p++) if (input.assigned(p) === null) slot = p;
  }
  if (slot < 0) {
    announce(`Plus de place pour ${describe(device)}.`);
    return;
  }
  input.assign(slot, device.id);
  announce(`J${slot + 1} : ${describe(device)}`);
  remap.screen?.refresh();
});

input.onDeviceChange((device) => {
  const player = playerOf(device);
  const who = player < 0 ? describe(device) : `J${player + 1} (${describe(device)})`;
  announce(device.connected ? `${who} : manette branchée.` : `${who} : manette débranchée.`);
  remap.screen?.refresh();
});

const inputs = new Uint32Array(players);
const view = createFighterView();
const deadFrames = new Int32Array(players);

// Recréés ensemble à chaque réinitialisation : une simulation neuve repart de la frame 0, et le
// renderer ne rejoue pas les événements d'une frame qu'il croit avoir déjà vue.
let sim: Sim;
let renderer: Renderer;
let dummies: Dummies;
let feeder: EntityFeeder;
const probe = createPerfProbe();

// Le son vit aussi longtemps que la page : le navigateur ne l'autorise qu'après une action de
// l'utilisateur, une seule fois. Une nouvelle simulation est reconnue d'elle-même.
const MUSIC = 'arena';
const audio = createGameAudio({ settings: loadAudioSettings(safeStorage()) });
audio.playMusic(MUSIC);
const unlockAudio = (): void => audio.unlock();
window.addEventListener('pointerdown', unlockAudio, { capture: true });
window.addEventListener('keydown', unlockAudio, { capture: true });
const soundPanel = createSoundPanel({
  panel: element('sound'),
  audio,
  storage: safeStorage(),
  track: MUSIC,
});

const tuning = createTuning(element('tuning'), baseConfig, (tuned) => {
  config = tuned;
  start();
});

const controls = createControls(window, element('toolbar'), {
  onReset: () => start(),
  onTuning: () => tuning.toggle(),
  onRemap: () => remap.screen?.toggle(),
  onSound: () => soundPanel.toggle(),
  onDebug: (enabled) => renderer.setDebug(enabled),
});

remap.screen = createRemap({
  panel: element('remap'),
  input,
  players: localPlayers,
  reservedKeys: controls.keys,
});

function resize(): void {
  renderer.resize(canvas.clientWidth, canvas.clientHeight, Math.min(window.devicePixelRatio, 2));
}
window.addEventListener('resize', resize);

function start(): void {
  // À la première création `renderer` n'existe pas encore.
  (renderer as Renderer | undefined)?.dispose();
  sim = createSim(config);
  renderer = createRenderer({ canvas, overlay, config });
  dummies = createDummies(mode, dummyCount, seed);
  feeder = createEntityFeeder(entityTarget, seed);
  deadFrames.fill(0);
  inputs.fill(0);
  renderer.setDebug(controls.debug);
  resize();
  renderer.capture(sim);
  audio.capture(sim);
}
start();

function simulateFrame(): void {
  input.sample(localInputs);
  dummies.fill(inputs);
  // Un emplacement tenu par un joueur local n'est plus piloté par son adversaire automatique.
  inputs[0] = localInputs[0]!;
  for (let p = 1; p < localPlayers; p++) {
    if (input.assigned(p) !== null) inputs[p] = localInputs[p]!;
  }
  if (localInputs[0] !== 0 && input.assigned(0)?.id === KEYBOARD_ID) keyboardUsed = true;
  feeder.feed(sim);
  step(sim, inputs);

  // Réapparition automatique : la démo n'a pas de règles de match.
  for (let i = 0; i < players; i++) {
    readFighter(sim, i, view);
    const waited = view.action === A_DEAD ? deadFrames[i]! + 1 : 0;
    if (waited >= RESPAWN_FRAMES) {
      deadFrames[i] = 0;
      respawn(sim, i);
    } else {
      deadFrames[i] = waited;
    }
  }
  renderer.capture(sim);
  audio.capture(sim);
}

let last = performance.now();
let accumulator = 0;

function tick(now: number): void {
  const elapsed = now - last;
  last = now;
  const began = performance.now();
  let alpha = 1;
  if (controls.paused) {
    // À l'arrêt, on montre exactement la dernière frame simulée.
    accumulator = 0;
    if (controls.consumeStep()) simulateFrame();
    // Lu même à l'arrêt : c'est ce qui fait avancer le remappage d'une manette et la détection
    // des branchements. Le résultat n'est pas utilisé.
    else input.sample(localInputs);
  } else {
    accumulator += elapsed * controls.speed;
    if (accumulator > MAX_STEPS_PER_DRAW * STEP_MS) accumulator = MAX_STEPS_PER_DRAW * STEP_MS;
    while (accumulator >= STEP_MS) {
      simulateFrame();
      accumulator -= STEP_MS;
    }
    alpha = accumulator / STEP_MS;
  }
  const simulated = performance.now();
  audio.setPaused(controls.paused);
  soundPanel.refresh();
  renderer.draw(alpha);
  probe.record(now, simulated - began, performance.now() - simulated);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

/** Prise pour les tests automatiques de la démo. Aucun code de jeu ne doit s'en servir. */
const testHook = {
  frame: () => frame(sim),
  players,
  paused: () => controls.paused,
  speed: () => controls.speed,
  /** Périphérique de chaque joueur local, ou `null`. */
  devices: () => Array.from({ length: localPlayers }, (_, p) => input.assigned(p)?.id ?? null),
  status: () => status.textContent ?? '',
  perfStart: () => probe.start(),
  perfStop: () => probe.stop(),
  /** État du son et nombre d'effets lancés. */
  audio: () => ({ state: audio.state, played: audio.soundsPlayed }),
  fighter(player: number) {
    const v = createFighterView();
    readFighter(sim, player, v);
    return v;
  },
  /** Checksum de la simulation avant et après un dessin réel, pour le test de non-ingérence. */
  checksumAroundDraw(): [before: number, after: number] {
    const before = checksum(sim);
    renderer.draw(0.5);
    return [before, checksum(sim)];
  },
  /** Nombre de couleurs distinctes sur une grille de pixels du canvas, juste après un dessin. */
  distinctColors(): number {
    renderer.draw(1);
    const gl = canvas.getContext('webgl2');
    if (gl === null) return 0;
    const pixel = new Uint8Array(4);
    const colors = new Set<number>();
    for (let gy = 1; gy < 16; gy++) {
      for (let gx = 1; gx < 16; gx++) {
        const x = Math.floor((gl.drawingBufferWidth * gx) / 16);
        const y = Math.floor((gl.drawingBufferHeight * gy) / 16);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        colors.add((pixel[0]! << 16) | (pixel[1]! << 8) | pixel[2]!);
      }
    }
    return colors.size;
  },
};
export type DemoTestHook = typeof testHook;
(window as unknown as { __demo: DemoTestHook }).__demo = testHook;
