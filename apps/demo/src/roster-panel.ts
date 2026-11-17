/**
 * Choix des personnages et tableau de frame data.
 *
 * Le choix d'un personnage recrée la simulation et le renderer, comme le panneau de réglage : une
 * configuration de `sim-core` est figée pour toute la durée d'un combat.
 */
import {
  ROSTER,
  STANDARD_BUILD,
  defineCharacter,
  frameData,
  movementData,
  type Character,
} from '@game/fighters';
import { TEST_ENTITIES, TEST_FIGHTER } from '@game/sim-core/testing';

/** Le combattant de test de `sim-core`, toujours choisissable pour comparer. */
export const TEST_CHARACTER: Character = defineCharacter({
  id: 'test',
  name: 'Combattant de test',
  archetype: 'polyvalent',
  def: TEST_FIGHTER,
  entities: TEST_ENTITIES,
  // Sans style dans la démo : le mannequin standard, aux couleurs du joueur.
  look: { primary: 0x888888, secondary: 0x888888, build: STANDARD_BUILD, parts: [] },
});

/** Personnages proposés dans la démo, dans l'ordre d'affichage. */
export const DEMO_ROSTER: readonly Character[] = [...ROSTER, TEST_CHARACTER];

export function findCharacter(id: string): Character | undefined {
  return DEMO_ROSTER.find((c) => c.id === id);
}

/**
 * Personnage de chaque joueur d'après l'URL (`?p1=sorel&p2=test`). Par défaut, le premier
 * personnage du roster ; un identifiant inconnu est ignoré.
 */
export function parseSelection(params: URLSearchParams, players: number): string[] {
  const fallback = DEMO_ROSTER[0]!.id;
  return Array.from({ length: players }, (_, p) => {
    const id = params.get(`p${p + 1}`) ?? '';
    return findCharacter(id) === undefined ? fallback : id;
  });
}

export interface Panel {
  toggle(): void;
  dispose(): void;
}

/** Un menu par joueur. `onChange` reçoit la nouvelle sélection complète. */
export function createRosterPanel(
  panel: HTMLElement,
  selection: readonly string[],
  onChange: (selection: string[]) => void,
): Panel {
  const doc = panel.ownerDocument;
  panel.replaceChildren();
  const title = doc.createElement('h2');
  title.textContent = 'Personnages';
  panel.append(title);
  const current = [...selection];
  selection.forEach((id, p) => {
    const label = doc.createElement('label');
    const name = doc.createElement('span');
    name.textContent = `J${p + 1}`;
    const select = doc.createElement('select');
    select.dataset.roster = `p${p + 1}`;
    for (const c of DEMO_ROSTER) {
      const option = doc.createElement('option');
      option.value = c.id;
      option.textContent = c.id === 'test' ? c.name : `${c.name} (${c.archetype})`;
      select.append(option);
    }
    select.value = id;
    select.addEventListener('change', () => {
      current[p] = select.value;
      select.blur();
      onChange([...current]);
    });
    label.append(name, select);
    panel.append(label);
  });
  const note = doc.createElement('p');
  note.textContent = 'Aussi par l’adresse : ?p1=sorel&p2=test';
  panel.append(note);
  return {
    toggle() {
      panel.hidden = !panel.hidden;
    },
    dispose() {
      panel.replaceChildren();
    },
  };
}

/** Tableau de frame data d'un personnage, calculé depuis ses données. */
export function createFrameDataPanel(panel: HTMLElement): Panel & { show(c: Character): void } {
  const doc = panel.ownerDocument;

  function table(
    head: readonly string[],
    rows: readonly (readonly (string | number | null)[])[],
  ): HTMLTableElement {
    const t = doc.createElement('table');
    const tr = doc.createElement('tr');
    for (const h of head) {
      const th = doc.createElement('th');
      th.textContent = h;
      tr.append(th);
    }
    t.append(tr);
    for (const row of rows) {
      const line = doc.createElement('tr');
      for (const value of row) {
        const td = doc.createElement('td');
        td.textContent = value === null ? '—' : String(value);
        line.append(td);
      }
      t.append(line);
    }
    return t;
  }

  return {
    show(c) {
      const title = doc.createElement('h2');
      title.textContent = `Frame data : ${c.name}`;
      const moves = table(
        [
          'Coup',
          'Nom',
          'Démarrage',
          'Actives',
          'Durée',
          'Dégâts',
          'Angle',
          'Éjection',
          'Atterr.',
          'Notes',
        ],
        frameData(c).map((r) => [
          r.label,
          r.name,
          r.startup,
          r.active,
          r.total,
          r.damage,
          r.angle,
          r.knockback,
          r.landingLag,
          r.notes,
        ]),
      );
      moves.dataset.framedata = 'moves';
      const movement = table(['Mouvement', ''], movementData(c.def));
      panel.replaceChildren(title, moves, movement);
    },
    toggle() {
      panel.hidden = !panel.hidden;
    },
    dispose() {
      panel.replaceChildren();
    },
  };
}
