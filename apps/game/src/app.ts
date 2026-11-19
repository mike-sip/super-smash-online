/**
 * L'application : services partagés (commandes, son, réglages), pile d'écrans, navigation au
 * clavier et à la manette, boucle d'images, bandeau, annonces et dialogues.
 *
 * Un seul écran est dans le DOM à la fois (le sommet de la pile) ; les autres sont gardés, avec
 * l'élément qui avait le focus, et reviennent tels quels au retour.
 */
import { KEYBOARD_ID, createInput, type Input } from '@game/input';
import {
  SND_JUMP,
  SND_LEDGE,
  SND_SHIELD,
  createGameAudio,
  type GameAudio,
  type Quality,
  type QualityOptions,
  type QualitySetting,
  type Renderer,
} from '@game/render';
import type { Problem, ErrorAction } from './errors.ts';
import { createMenuPad, readGamepads, type MenuAction } from './menu-pad.ts';
import { nextFocus, type Direction } from './nav.ts';
import { createScreenStack, type BackRule, type ScreenStack } from './screens.ts';
import { loadSettings, saveSettings, type Settings, type StorageLike } from './settings.ts';
import { button } from './ui/components.ts';
import { adjusterOf, el, focusables } from './ui/dom.ts';

export interface Screen {
  readonly id: string;
  readonly back: BackRule;
  readonly root: HTMLElement;
  /** L'écran arrive ou revient au sommet. */
  shown?(): void;
  /** L'écran quitte le sommet (recouvert ou retiré). */
  hidden?(): void;
  /** L'écran est retiré de la pile. */
  dispose?(): void;
  /** « Retour » sur un écran à confirmation, ou à la racine. */
  onBack?(): void;
  /** À chaque image tant que l'écran est au sommet. */
  frame?(now: number): void;
  /** Le combat lit lui-même clavier et manettes : pas de navigation des menus. */
  readonly capturesInput?: boolean;
  /** Touche propre à l'écran ; vrai si traitée. */
  onKey?(event: KeyboardEvent): boolean;
  /** Action de manette propre à l'écran ; vrai si traitée. */
  onPad?(action: MenuAction): boolean;
}

export interface AppElements {
  readonly canvas: HTMLCanvasElement;
  readonly overlay: HTMLElement;
  readonly ui: HTMLElement;
  readonly banner: HTMLElement;
  readonly toast: HTMLElement;
  readonly announce: HTMLElement;
  readonly fps: HTMLElement;
}

export type BannerHandlers = Partial<Record<ErrorAction, () => void>>;

const ACTION_LABELS: Readonly<Record<ErrorAction, string>> = {
  retry: 'Réessayer',
  menu: 'Menu principal',
  login: 'Se connecter',
  dismiss: 'Fermer',
  reload: 'Recharger',
};

/** `localStorage`, ou rien si le navigateur l'interdit. */
export function safeStorage(): StorageLike | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export class App {
  readonly elements: AppElements;
  readonly storage: StorageLike | undefined;
  readonly input: Input;
  readonly audio: GameAudio;
  settings: Settings;
  /** Écrans et actions de test, remplis seulement quand la prise de test est active. */
  readonly test: Record<string, unknown> = {};
  /** Rend le canvas à un combat (la scène de fond s'y branche). */
  releaseCanvas: () => void = () => {};

  private readonly stack: ScreenStack<Screen>;
  private readonly focusMemory = new WeakMap<Screen, HTMLElement>();
  private readonly pad = createMenuPad();
  private dialog: HTMLElement | null = null;
  private toastTimer = 0;
  private fpsFrames = 0;
  private fpsSince = 0;
  private readonly frameListeners = new Set<(now: number) => void>();
  /** Réglage de qualité appliqué à chaque renderer vivant. */
  private readonly appliedQuality = new WeakMap<Renderer, QualitySetting>();
  /** Niveau retenu par la qualité automatique au dernier match. */
  private autoQuality: Quality | undefined;

  constructor(elements: AppElements, root: (app: App) => Screen) {
    this.elements = elements;
    this.storage = safeStorage();
    this.settings = loadSettings(this.storage);
    this.input = createInput({ target: window, players: 4, storage: this.storage });
    this.input.assign(0, KEYBOARD_ID);
    this.audio = createGameAudio({ settings: this.audioSettings() });
    this.applyDisplay();
    const probe = new Uint32Array(4);
    this.test.sample = () => {
      this.input.sample(probe);
      return probe[0];
    };
    this.test.perfStart = () => {
      this.perf = { frame: [], draw: [], interval: [], last: 0 };
    };
    this.test.perfStop = () => {
      const p = this.perf;
      this.perf = null;
      return p;
    };
    this.test.devices = () => [0, 1, 2, 3].map((p) => this.input.assigned(p)?.id ?? null);

    const unlock = (): void => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    window.addEventListener('keydown', (e) => this.onKeyDown(e));

    const first = root(this);
    this.stack = createScreenStack(first);
    this.attach(first);
    requestAnimationFrame((t) => this.tick(t));
  }

  // --- Pile d'écrans ----------------------------------------------------------------------

  top(): Screen {
    return this.stack.top();
  }

  ids(): string[] {
    return this.stack.ids();
  }

  push(screen: Screen): void {
    this.detach(this.stack.top());
    this.stack.push(screen);
    this.attach(screen);
  }

  replace(screen: Screen): void {
    const old = this.stack.top();
    this.detach(old);
    old.dispose?.();
    this.stack.replace(screen);
    this.attach(screen);
  }

  /** Vide la pile et montre `screen`. */
  reset(screen: Screen): void {
    this.closeDialog(false);
    this.detach(this.stack.top());
    while (this.stack.depth() > 1) {
      this.stack.top().dispose?.();
      this.stack.confirmBack();
    }
    this.stack.top().dispose?.();
    this.stack.reset(screen);
    this.attach(screen);
  }

  /** Revient à l'écran `id` s'il est dans la pile. */
  popTo(id: string): boolean {
    if (!this.stack.ids().includes(id)) return false;
    while (this.stack.top().id !== id) this.pop();
    return true;
  }

  /** « Retour » selon la règle de l'écran au sommet. */
  back(): void {
    if (this.dialog !== null) return;
    const top = this.stack.top();
    switch (this.stack.back()) {
      case 'popped':
        this.detach(top);
        top.dispose?.();
        this.attach(this.stack.top());
        this.sound(SND_SHIELD);
        break;
      case 'confirm':
      case 'root':
        top.onBack?.();
        break;
      case 'blocked':
        break;
    }
  }

  /** Retire l'écran du sommet sans condition (après une confirmation). */
  pop(): void {
    if (this.stack.depth() <= 1) return;
    const top = this.stack.top();
    this.detach(top);
    top.dispose?.();
    this.stack.confirmBack();
    this.attach(this.stack.top());
  }

  private attach(screen: Screen): void {
    this.elements.ui.append(screen.root);
    screen.shown?.();
    const remembered = this.focusMemory.get(screen);
    const target =
      remembered !== undefined && screen.root.contains(remembered)
        ? remembered
        : (screen.root.querySelector<HTMLElement>('[data-autofocus]') ??
          focusables(screen.root)[0]);
    if (target !== undefined) target.focus({ preventScroll: false });
    else {
      // Rien à focaliser (sélection locale…) : le focus va à l'écran lui-même.
      screen.root.tabIndex = -1;
      screen.root.focus();
    }
    if (screen.capturesInput !== true) this.pad.suspend();
  }

  private detach(screen: Screen): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement && screen.root.contains(active)) {
      this.focusMemory.set(screen, active);
    }
    screen.hidden?.();
    screen.root.remove();
  }

  // --- Navigation -------------------------------------------------------------------------

  /** Racine où la navigation se fait : le dialogue ouvert, sinon l'écran au sommet. */
  private navRoot(): HTMLElement {
    return this.dialog ?? this.stack.top().root;
  }

  moveFocus(dir: Direction): boolean {
    const root = this.navRoot();
    const items = focusables(root);
    if (items.length === 0) return false;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !items.includes(active)) {
      items[0]!.focus();
      return true;
    }
    const ids = new Map<string, HTMLElement>();
    const candidates = items.map((e, i) => {
      const id = String(i);
      ids.set(id, e);
      return { id, rect: e.getBoundingClientRect() };
    });
    const next = nextFocus(active.getBoundingClientRect(), candidates, dir);
    if (next === null) return false;
    ids.get(next)!.focus();
    this.sound(SND_LEDGE);
    return true;
  }

  private adjust(delta: number): boolean {
    const adjust = adjusterOf(document.activeElement);
    if (adjust === undefined) return false;
    adjust(delta);
    this.sound(SND_LEDGE);
    return true;
  }

  private onKeyDown(event: KeyboardEvent): void {
    const top = this.stack.top();
    if (this.dialog === null && top.capturesInput !== true && top.onKey?.(event) === true) {
      event.preventDefault();
      return;
    }
    if (this.dialog === null && top.capturesInput === true) {
      if (top.onKey?.(event) === true) event.preventDefault();
      return;
    }
    const target = event.target as HTMLElement | null;
    const typing =
      target instanceof HTMLInputElement && (target.type === 'text' || target.type === 'password');
    switch (event.key) {
      case 'ArrowUp':
        if (this.moveFocus('up')) event.preventDefault();
        break;
      case 'ArrowDown':
        if (this.moveFocus('down')) event.preventDefault();
        break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (typing) return;
        const delta = event.key === 'ArrowLeft' ? -1 : 1;
        if (target instanceof HTMLInputElement && target.type === 'range') {
          event.preventDefault();
          this.adjust(delta);
          return;
        }
        if (this.adjust(delta) || this.moveFocus(delta < 0 ? 'left' : 'right')) {
          event.preventDefault();
        }
        break;
      }
      case 'Escape':
        event.preventDefault();
        if (this.dialog !== null) this.closeDialog(true);
        else this.back();
        break;
      case 'Enter':
        if (target instanceof HTMLButtonElement) this.sound(SND_JUMP);
        break;
    }
  }

  private onPad(action: MenuAction): void {
    const top = this.stack.top();
    if (this.dialog === null && top.onPad?.(action) === true) return;
    switch (action.type) {
      case 'move':
        if (action.dir === 'left' || action.dir === 'right') {
          if (this.adjust(action.dir === 'left' ? -1 : 1)) return;
        }
        this.moveFocus(action.dir);
        break;
      case 'confirm': {
        const active = document.activeElement;
        if (active instanceof HTMLElement && this.navRoot().contains(active)) {
          this.sound(SND_JUMP);
          active.click();
        } else {
          focusables(this.navRoot())[0]?.focus();
        }
        break;
      }
      case 'back':
        if (this.dialog !== null) this.closeDialog(true);
        else this.back();
        break;
      case 'start':
        break;
    }
  }

  // --- Boucle -----------------------------------------------------------------------------

  /** Appelée à chaque image, en plus de l'écran au sommet (scène de fond…). */
  onFrame(listener: (now: number) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  /** Mesure de performance (tests) : durée de chaque image, et du dessin seul. */
  private perf: { frame: number[]; draw: number[]; interval: number[]; last: number } | null = null;

  /** À appeler autour de `renderer.draw` : temps de dessin, pour la mesure de performance. */
  timeDraw(draw: () => void): void {
    if (this.perf === null) {
      draw();
      return;
    }
    const t = performance.now();
    draw();
    this.perf.draw.push(performance.now() - t);
  }

  private tick(now: number): void {
    const began = performance.now();
    try {
      const top = this.stack.top();
      if (top.capturesInput !== true) {
        for (const action of this.pad.update(
          readGamepads(() => navigator.getGamepads()),
          now,
        )) {
          this.onPad(action);
        }
      } else {
        this.pad.suspend();
      }
      for (const listener of this.frameListeners) listener(now);
      top.frame?.(now);
      this.countFps(now);
    } catch (error) {
      this.fail(error);
    }
    if (this.perf !== null) {
      this.perf.frame.push(performance.now() - began);
      if (this.perf.last > 0) this.perf.interval.push(now - this.perf.last);
      this.perf.last = now;
    }
    requestAnimationFrame((t) => this.tick(t));
  }

  private countFps(now: number): void {
    if (!this.settings.display.showFps) return;
    this.fpsFrames++;
    if (now - this.fpsSince >= 500) {
      const fps = (this.fpsFrames * 1000) / (now - this.fpsSince);
      this.elements.fps.textContent = `${fps.toFixed(0)} images/s`;
      this.fpsFrames = 0;
      this.fpsSince = now;
    }
  }

  /** Erreur imprévue : écran d'erreur, la console garde la trace. */
  fail(error: unknown): void {
    console.error(error);
    this.onFatal?.(error);
  }

  onFatal: ((error: unknown) => void) | null = null;

  // --- Réglages ---------------------------------------------------------------------------

  private audioSettings() {
    const a = this.settings.audio;
    return { enabled: a.enabled, music: a.music, effects: a.effects };
  }

  updateSettings(next: Settings): void {
    if (next.display.quality !== this.settings.display.quality) this.autoQuality = undefined;
    this.settings = next;
    saveSettings(this.storage, next);
    this.audio.setSettings(this.audioSettings());
    this.applyDisplay();
    // Résolution du rendu ou taille du texte : les renderers se recalent.
    window.dispatchEvent(new Event('resize'));
  }

  /**
   * Options graphiques d'un nouveau renderer : qualité, et effets d'écran (secousses, gros plans,
   * éclairs) coupés quand les mouvements sont réduits.
   */
  qualityOptions(): QualityOptions & { screenEffects: boolean } {
    return {
      quality: this.settings.display.quality,
      autoStart: this.autoQuality,
      screenEffects: !this.reducedMotion(),
    };
  }

  /**
   * Applique le réglage de qualité à un renderer s'il a changé depuis la dernière fois. À appeler
   * après la création du renderer et à chaque redimensionnement (`updateSettings` en déclenche un).
   */
  syncQuality(renderer: Renderer | null): void {
    if (renderer === null) return;
    const wanted = this.settings.display.quality;
    const applied = this.appliedQuality.get(renderer);
    if (applied === wanted) return;
    if (applied !== undefined) renderer.setQuality(wanted);
    this.appliedQuality.set(renderer, wanted);
  }

  /** Retient le niveau retenu par la qualité automatique en fin de match, pour les suivants. */
  rememberQuality(renderer: Renderer | null): void {
    if (renderer !== null && this.settings.display.quality === 'auto') {
      this.autoQuality = renderer.quality;
    }
  }

  /** Densité de pixels du rendu, plafonnée par le réglage. */
  pixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, this.settings.display.pixelRatio);
  }

  private applyDisplay(): void {
    const d = this.settings.display;
    const root = document.documentElement;
    root.dataset.text = d.largeText ? 'large' : 'normal';
    root.dataset.motion = d.reducedMotion ? 'reduced' : 'full';
    this.elements.fps.hidden = !d.showFps;
  }

  /** Vrai si les animations doivent être réduites (réglage ou système). */
  reducedMotion(): boolean {
    return (
      this.settings.display.reducedMotion ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  sound(id: number): void {
    if (this.settings.audio.menuSounds && this.audio.state === 'running') this.audio.play(id);
  }

  // --- Messages ---------------------------------------------------------------------------

  /** Annonce lue immédiatement par les lecteurs d'écran. */
  announce(text: string): void {
    this.elements.announce.textContent = '';
    // Vidé puis rempli : une même annonce répétée est relue.
    requestAnimationFrame(() => (this.elements.announce.textContent = text));
  }

  /** Message discret, quelques secondes, en bas de l'écran. */
  toast(text: string, ms = 4000): void {
    this.elements.toast.textContent = text;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.elements.toast.textContent = ''), ms);
  }

  /** Bandeau en haut de l'écran ; `null` le retire. */
  banner(problem: Problem | null, handlers: BannerHandlers = {}): void {
    const b = this.elements.banner;
    if (problem === null) {
      b.hidden = true;
      b.replaceChildren();
      return;
    }
    b.hidden = false;
    b.classList.toggle('error', problem.severity === 'error');
    const actions = problem.actions
      .filter((a) => handlers[a] !== undefined)
      .map((a) => button(ACTION_LABELS[a], handlers[a]!));
    b.replaceChildren(el('span', { text: problem.message }), ...actions);
  }

  /**
   * Dialogue modal : la navigation s'y limite jusqu'à sa fermeture. Échap ou B choisit la
   * dernière option (annuler).
   */
  confirm(
    message: string,
    options: readonly { label: string; action: () => void; primary?: boolean }[],
  ): void {
    this.closeDialog(false);
    const buttons = options.map((o) =>
      button(
        o.label,
        () => {
          this.closeDialog(false);
          o.action();
        },
        { primary: o.primary === true },
      ),
    );
    const titleId = `dialog-${Date.now()}`;
    const dialog = el(
      'div',
      {
        className: 'dialog',
        attrs: { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      },
      [
        el('div', { className: 'panel' }, [
          el('p', { id: titleId, text: message }),
          el('div', { className: 'menu' }, buttons),
        ]),
      ],
    );
    this.dialog = dialog;
    this.dialogCancel = options[options.length - 1]?.action ?? null;
    this.stack.top().root.setAttribute('inert', '');
    this.elements.ui.append(dialog);
    buttons[0]?.focus();
  }

  private dialogCancel: (() => void) | null = null;

  private closeDialog(cancel: boolean): void {
    if (this.dialog === null) return;
    this.dialog.remove();
    this.dialog = null;
    this.stack.top().root.removeAttribute('inert');
    const cancelAction = this.dialogCancel;
    this.dialogCancel = null;
    const first = focusables(this.stack.top().root)[0];
    first?.focus();
    if (cancel) cancelAction?.();
  }

  dialogOpen(): boolean {
    return this.dialog !== null;
  }
}
