/** Fenêtre simulée : les tests du module tournent dans Node, sans navigateur. */

export interface KeyOptions {
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
  /** Élément qui a le focus, par exemple un champ de saisie. */
  target?: object;
}

export interface FakeWindow {
  /** À passer à `createInput` comme fenêtre. */
  readonly window: Window;
  /** Émet un appui ; renvoie l'événement, pour vérifier s'il a été soustrait au navigateur. */
  keyDown(code: string, options?: KeyOptions): Event;
  keyUp(code: string): void;
  blur(): void;
  /** Nombre d'écouteurs encore branchés. */
  listeners(): number;
  /** Manettes vues par `navigator.getGamepads()`, par index ; `null` pour un emplacement vide. */
  readonly pads: (FakePad | null)[];
}

export function fakeWindow(): FakeWindow {
  const target = new EventTarget();
  const pads: (FakePad | null)[] = [];
  Object.assign(target, { navigator: { getGamepads: () => pads } });
  let listeners = 0;
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  target.addEventListener = (...args: Parameters<EventTarget['addEventListener']>) => {
    listeners++;
    add(...args);
  };
  target.removeEventListener = (...args: Parameters<EventTarget['removeEventListener']>) => {
    listeners--;
    remove(...args);
  };

  function keyEvent(type: string, code: string, options: KeyOptions = {}): Event {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, {
      code,
      ctrlKey: options.ctrlKey ?? false,
      altKey: options.altKey ?? false,
      metaKey: options.metaKey ?? false,
      repeat: options.repeat ?? false,
    });
    if (options.target !== undefined) {
      Object.defineProperty(event, 'target', { value: options.target });
    }
    target.dispatchEvent(event);
    return event;
  }

  return {
    window: target as unknown as Window,
    keyDown: (code, options) => keyEvent('keydown', code, options),
    keyUp: (code) => void keyEvent('keyup', code),
    blur: () => void target.dispatchEvent(new Event('blur')),
    listeners: () => listeners,
    pads,
  };
}

export interface FakePadOptions {
  index?: number;
  id?: string;
  connected?: boolean;
  /** `standard` par défaut ; chaîne vide pour une manette que le navigateur ne reconnaît pas. */
  mapping?: string;
  axes?: number[];
  buttonCount?: number;
  /** Index des boutons enfoncés. */
  pressed?: number[];
  /** Valeur analogique de certains boutons (gâchettes), sans les marquer enfoncés. */
  values?: Record<number, number>;
}

export interface FakePad {
  index: number;
  id: string;
  connected: boolean;
  mapping: string;
  axes: number[];
  buttons: { pressed: boolean; value: number }[];
}

/** Manette simulée, à la forme de l'objet `Gamepad` du navigateur. */
export function fakePad(options: FakePadOptions = {}): FakePad {
  const buttons = Array.from({ length: options.buttonCount ?? 17 }, (_, index) => {
    const pressed = options.pressed?.includes(index) ?? false;
    return { pressed, value: pressed ? 1 : (options.values?.[index] ?? 0) };
  });
  return {
    index: options.index ?? 0,
    id: options.id ?? 'Manette de test (STANDARD GAMEPAD)',
    connected: options.connected ?? true,
    mapping: options.mapping ?? 'standard',
    axes: options.axes ?? [0, 0, 0, 0],
    buttons,
  };
}

/** Stockage en mémoire, à la forme de `localStorage`. */
export function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string): string | null => data.get(key) ?? null,
    setItem: (key: string, value: string): void => void data.set(key, value),
  };
}
