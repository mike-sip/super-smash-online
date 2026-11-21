/**
 * Écran minimal de remappage : réassigner les commandes d'un périphérique, régler la zone morte
 * et le saut au stick. L'écran d'options final appartiendra à `app-shell` ; celui-ci sert à
 * essayer l'API du module `input`.
 */
import { ACTIONS, type Action, type Device, type Input } from '@game/input';

const ACTION_LABELS: Readonly<Record<Action, string>> = {
  left: 'Stick ←',
  right: 'Stick →',
  up: 'Stick ↑',
  down: 'Stick ↓',
  attack: 'Attaque',
  special: 'Spécial',
  jump: 'Saut',
  shield: 'Bouclier',
  grab: 'Saisie',
  taunt: 'Provocation',
  cLeft: 'Stick droit ←',
  cRight: 'Stick droit →',
  cUp: 'Stick droit ↑',
  cDown: 'Stick droit ↓',
  walk: 'Marcher (demi-stick)',
};

export interface RemapOptions {
  readonly panel: HTMLElement;
  readonly input: Input;
  /** Nombre d'emplacements de joueurs locaux. */
  readonly players: number;
  /** Touches que la démo garde pour ses propres contrôles : refusées comme commandes de jeu. */
  readonly reservedKeys: ReadonlySet<string>;
}

export interface Remap {
  toggle(): void;
  /** À appeler quand la liste des périphériques ou leur attribution change. */
  refresh(): void;
}

export function createRemap(options: RemapOptions): Remap {
  const { panel, input, players, reservedKeys } = options;
  const doc = panel.ownerDocument;
  let deviceId = input.devices()[0]!.id;
  /** Annule la capture en cours, s'il y en a une. */
  let cancelCapture: (() => void) | null = null;

  const title = doc.createElement('h2');
  title.textContent = 'Commandes';
  const picker = doc.createElement('select');
  picker.dataset.remap = 'device';
  const message = doc.createElement('p');
  message.dataset.remap = 'message';
  message.className = 'message';
  const list = doc.createElement('div');
  const footer = doc.createElement('div');
  panel.append(title, picker, message, list, footer);

  const say = (text: string): void => {
    message.textContent = text;
  };

  function playerLabel(device: Device): string {
    for (let p = 0; p < players; p++) {
      if (input.assigned(p)?.id === device.id) return `J${p + 1} · `;
    }
    return '';
  }

  /** Remplace les commandes d'une action par celle que le joueur actionne ensuite. */
  async function rebind(action: Action, button: HTMLButtonElement): Promise<void> {
    cancelCapture?.();
    const controller = new AbortController();
    cancelCapture = () => controller.abort();
    button.textContent = '…';
    say(`Actionnez la commande pour « ${ACTION_LABELS[action]} » (Échap pour annuler).`);
    try {
      const captured = await input.captureNext(deviceId, controller.signal);
      if (captured.type === 'key' && reservedKeys.has(captured.code)) {
        say(`${input.describe(deviceId, captured)} est une touche de contrôle de la démo.`);
      } else {
        const error = input.setBindings(deviceId, {
          ...input.bindings(deviceId),
          [action]: [captured],
        });
        if (error === null) {
          say('');
        } else if (error.reason === 'conflict') {
          const other = error.action === action ? error.other : error.action;
          say(`${input.describe(deviceId, captured)} sert déjà à « ${ACTION_LABELS[other]} ».`);
        } else {
          say('Cette commande ne convient pas à ce périphérique.');
        }
      }
    } catch {
      say('');
    }
    cancelCapture = null;
    render();
  }

  function render(): void {
    const devices = input.devices().filter((device) => device.connected);
    if (!devices.some((device) => device.id === deviceId)) deviceId = devices[0]!.id;
    picker.replaceChildren(
      ...devices.map((device) => {
        const option = doc.createElement('option');
        option.value = device.id;
        option.textContent = playerLabel(device) + device.label;
        option.selected = device.id === deviceId;
        return option;
      }),
    );

    const bindings = input.bindings(deviceId);
    list.replaceChildren(
      ...ACTIONS.map((action) => {
        const row = doc.createElement('label');
        const name = doc.createElement('span');
        name.textContent = ACTION_LABELS[action];
        const button = doc.createElement('button');
        button.type = 'button';
        button.dataset.remap = action;
        button.textContent =
          bindings[action].map((binding) => input.describe(deviceId, binding)).join(' ou ') || '—';
        button.addEventListener('click', () => {
          button.blur();
          void rebind(action, button);
        });
        row.append(name, button);
        return row;
      }),
    );

    const reset = doc.createElement('button');
    reset.type = 'button';
    reset.dataset.remap = 'reset';
    reset.textContent = 'Commandes par défaut';
    reset.addEventListener('click', () => {
      input.resetBindings(deviceId);
      say('');
      reset.blur();
      render();
    });

    const deadzoneRow = doc.createElement('label');
    const deadzoneName = doc.createElement('span');
    deadzoneName.textContent = 'Zone morte du stick (%)';
    const deadzone = doc.createElement('input');
    deadzone.type = 'number';
    deadzone.min = '0';
    deadzone.max = '60';
    deadzone.step = '1';
    deadzone.dataset.remap = 'deadzone';
    deadzone.value = String(Math.round(input.analog().deadzone * 100));
    deadzone.addEventListener('change', () => {
      const percent = Number(deadzone.value);
      if (Number.isFinite(percent)) {
        input.setAnalog({ ...input.analog(), deadzone: percent / 100 });
      }
      deadzone.value = String(Math.round(input.analog().deadzone * 100));
    });
    deadzoneRow.append(deadzoneName, deadzone);

    const tapRows = Array.from({ length: players }, (_, player) => {
      const row = doc.createElement('label');
      const name = doc.createElement('span');
      name.textContent = `J${player + 1} : saut au stick`;
      const box = doc.createElement('input');
      box.type = 'checkbox';
      box.dataset.remap = `tap-jump-${player}`;
      box.checked = input.tapJump(player);
      box.addEventListener('change', () => {
        input.setTapJump(player, box.checked);
        box.blur();
      });
      row.append(name, box);
      return row;
    });

    footer.replaceChildren(reset, deadzoneRow, ...tapRows);
  }

  picker.addEventListener('change', () => {
    cancelCapture?.();
    deviceId = picker.value;
    say('');
    picker.blur();
    render();
  });

  // Échap annule une capture. Écouté avant le module `input`, qui sinon prendrait la touche Échap
  // elle-même pour la commande à assigner.
  panel.ownerDocument.defaultView?.addEventListener(
    'keydown',
    (event) => {
      if (event.code !== 'Escape' || cancelCapture === null) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      cancelCapture();
    },
    { capture: true },
  );

  render();

  return {
    toggle() {
      panel.hidden = !panel.hidden;
      if (panel.hidden) cancelCapture?.();
      else render();
    },
    refresh() {
      if (!panel.hidden && cancelCapture === null) render();
    },
  };
}
