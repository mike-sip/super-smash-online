/** Contrôles de la démo : pause, image par image, ralenti, réinitialisation, vue technique, son. */

export interface ControlHandlers {
  onReset(): void;
  onTuning(): void;
  onRemap(): void;
  onSound(): void;
  onAccount(): void;
  /** Ouvre ou ferme le panneau Classement. */
  onLeaderboard(): void;
  /** Ouvre ou ferme le choix des règles du match. */
  onRules(): void;
  onDebug(enabled: boolean): void;
}

export interface Controls {
  readonly paused: boolean;
  /** Vitesse de la simulation : 1, 1/4 ou 1/10. */
  readonly speed: number;
  readonly debug: boolean;
  /** Touches prises par ces contrôles : à refuser comme commandes de jeu. */
  readonly keys: ReadonlySet<string>;
  /** Vrai une fois par demande d'avance d'une image ; la demande est alors consommée. */
  consumeStep(): boolean;
  dispose(): void;
}

const SPEEDS: readonly [code: string, label: string, speed: number][] = [
  ['Digit1', '1×', 1],
  ['Digit2', '1/4', 1 / 4],
  ['Digit3', '1/10', 1 / 10],
];

/**
 * Branche les touches et construit les boutons dans `toolbar`. Les touches sont repérées par leur
 * position physique, comme celles du jeu, et n'en reprennent aucune.
 */
export function createControls(
  target: Window,
  toolbar: HTMLElement,
  handlers: ControlHandlers,
): Controls {
  let paused = false;
  let speed = 1;
  let debug = false;
  let stepRequested = false;

  const doc = toolbar.ownerDocument;
  const actions = new Map<string, () => void>();
  const refreshers: (() => void)[] = [];

  function button(code: string, key: string, label: string, run: () => void, on?: () => boolean) {
    const element = doc.createElement('button');
    element.type = 'button';
    element.dataset.control = code;
    element.textContent = `${label} (${key})`;
    element.addEventListener('click', () => {
      run();
      refresh();
      // Sans cela, Entrée ou Espace rejoueraient le bouton en plein combat.
      element.blur();
    });
    toolbar.append(element);
    actions.set(code, run);
    if (on !== undefined) {
      refreshers.push(() => element.setAttribute('aria-pressed', String(on())));
    }
  }

  function refresh(): void {
    for (const update of refreshers) update();
  }

  button(
    'KeyP',
    'P',
    'Pause',
    () => {
      paused = !paused;
    },
    () => paused,
  );
  button('KeyN', 'N', 'Image suivante', () => {
    // Avancer d'une image n'a de sens qu'à l'arrêt.
    paused = true;
    stepRequested = true;
  });
  for (const [code, label, value] of SPEEDS) {
    button(
      code,
      code.slice(-1),
      label,
      () => {
        speed = value;
      },
      () => speed === value,
    );
  }
  button('KeyR', 'R', 'Réinitialiser', () => handlers.onReset());
  button(
    'KeyH',
    'H',
    'Vue technique',
    () => {
      debug = !debug;
      handlers.onDebug(debug);
    },
    () => debug,
  );
  button('KeyT', 'T', 'Réglages', () => handlers.onTuning());
  button('KeyM', 'M', 'Commandes', () => handlers.onRemap());
  button('KeyS', 'S', 'Son', () => handlers.onSound());
  button('KeyU', 'U', 'Compte', () => handlers.onAccount());
  button('KeyO', 'O', 'Classement', () => handlers.onLeaderboard());
  button('KeyG', 'G', 'Règles du match', () => handlers.onRules());
  const keys: ReadonlySet<string> = new Set(actions.keys());
  refresh();

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat && event.code !== 'KeyN') return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    // Une touche tapée dans un champ du panneau de réglage n'est pas une commande.
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement
    ) {
      return;
    }
    const run = actions.get(event.code);
    if (run === undefined) return;
    run();
    refresh();
    event.preventDefault();
  };
  target.addEventListener('keydown', onKeyDown);

  return {
    get paused() {
      return paused;
    },
    get speed() {
      return speed;
    },
    get debug() {
      return debug;
    },
    keys,
    consumeStep() {
      const requested = stepRequested;
      stepRequested = false;
      return requested;
    },
    dispose() {
      target.removeEventListener('keydown', onKeyDown);
      toolbar.replaceChildren();
    },
  };
}
