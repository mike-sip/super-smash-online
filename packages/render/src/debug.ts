/**
 * Vue technique : hitbox, hurtbox, rebords, zones limites et état de chaque combattant.
 *
 * La première moitié du fichier calcule quoi montrer (logique pure, testée contre la simulation) ;
 * la seconde le dessine sur un canvas 2D superposé au jeu. Le rendu n'a pas accès aux calculs
 * internes de `sim-core` : il refait les mêmes à partir des mêmes données (`FighterDef`,
 * `StageDef`), et les tests vérifient que les deux coïncident.
 */
import {
  A_ATTACK,
  A_GRAB,
  A_ITEM_SWING,
  A_THROW,
  fxToFloat,
  type CapsuleDef,
  type EntityDef,
  type FighterDef,
  type MoveDef,
  type FighterView,
  type StageDef,
} from '@game/sim-core';
import { projectX, projectY, type CameraBounds, type Framing } from './camera.ts';

export const SHAPE_HURT = 0;
export const SHAPE_HIT = 1;
export const SHAPE_GRAB = 2;
export const SHAPE_ENTITY = 3;

/** Capsules à dessiner, en unités de jeu. Tampon réutilisé d'une image à l'autre. */
export interface Shapes {
  count: number;
  readonly capacity: number;
  readonly kind: Uint8Array;
  readonly x1: Float64Array;
  readonly y1: Float64Array;
  readonly x2: Float64Array;
  readonly y2: Float64Array;
  readonly radius: Float64Array;
}

export function createShapes(capacity: number): Shapes {
  return {
    count: 0,
    capacity,
    kind: new Uint8Array(capacity),
    x1: new Float64Array(capacity),
    y1: new Float64Array(capacity),
    x2: new Float64Array(capacity),
    y2: new Float64Array(capacity),
    radius: new Float64Array(capacity),
  };
}

function push(
  out: Shapes,
  kind: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  radius: number,
): void {
  const n = out.count;
  if (n >= out.capacity) return;
  out.kind[n] = kind;
  out.x1[n] = x1;
  out.y1[n] = y1;
  out.x2[n] = x2;
  out.y2[n] = y2;
  out.radius[n] = radius;
  out.count = n + 1;
}

/** Capsule d'un combattant : relative à ses pieds, l'axe x inversé quand il regarde à gauche. */
function pushCapsule(
  out: Shapes,
  kind: number,
  capsule: CapsuleDef,
  x: number,
  y: number,
  facing: number,
): void {
  push(
    out,
    kind,
    x + facing * fxToFloat(capsule.x1),
    y + fxToFloat(capsule.y1),
    x + facing * fxToFloat(capsule.x2),
    y + fxToFloat(capsule.y2),
    fxToFloat(capsule.radius),
  );
}

/**
 * Vrai si l'attaque est tenue en charge : son compteur de charge vient d'augmenter. `prevCharge`
 * est la charge lue à la frame précédente.
 */
export function isCharging(view: FighterView, prevCharge: number): boolean {
  return view.charge > prevCharge;
}

/**
 * Frame de l'attaque que le dernier `step` a testée contre les hurtbox adverses ; les fenêtres
 * `start`–`end` de `HitDef` et de `GrabDef` s'y comparent directement.
 *
 * `actionFrame`, lu après un `step`, vaut exactement cette frame : la simulation teste la frame
 * suivante puis avance son compteur. Seule exception, une attaque tenue en charge : le compteur
 * n'avance pas, et la frame testée est la suivante. Pendant le hitlag il n'avance pas non plus,
 * mais rien n'est testé : la dernière frame testée reste affichée.
 */
export function testedFrame(view: FighterView, charging: boolean): number {
  return view.actionFrame + (charging ? 1 : 0);
}

/** Ajoute à `out` les hurtbox du combattant et ses hitbox actives, autour de la position (x, y). */
export function fighterShapes(
  def: FighterDef,
  view: FighterView,
  x: number,
  y: number,
  charging: boolean,
  out: Shapes,
  swing?: MoveDef,
): void {
  const facing = view.facing;
  for (let h = 0; h < def.hurtboxes.length; h++) {
    pushCapsule(out, SHAPE_HURT, def.hurtboxes[h]!, x, y, facing);
  }
  const frame = testedFrame(view, charging);
  if (view.action === A_ATTACK || view.action === A_ITEM_SWING) {
    // Coup d'objet : la hitbox est celle de l'objet tenu (module stages-items).
    const move = view.action === A_ITEM_SWING ? swing : def.moves[view.move];
    if (move === undefined) return;
    for (let h = 0; h < move.hits.length; h++) {
      const hit = move.hits[h]!;
      if (frame >= hit.start && frame <= hit.end) pushCapsule(out, SHAPE_HIT, hit, x, y, facing);
    }
  } else if (view.action === A_GRAB) {
    const grab = def.grab;
    if (frame >= grab.start && frame <= grab.end) {
      pushCapsule(out, SHAPE_GRAB, grab.box, x, y, facing);
    }
  }
}

export function entityShape(def: EntityDef, x: number, y: number, out: Shapes): void {
  // Une entité qui a une hauteur (jet de geyser) frappe sur une capsule verticale.
  const top = def.height === undefined ? y : y + fxToFloat(def.height);
  push(out, SHAPE_ENTITY, x, y, x, top, fxToFloat(def.radius));
}

export interface Ledges {
  readonly count: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** -1 pour un rebord gauche, 1 pour un rebord droit : le côté où l'on s'y suspend. */
  readonly side: Int8Array;
}

/**
 * Rebords du stage : les deux coins supérieurs de chaque bloc plein, le gauche d'abord. C'est la
 * règle et l'ordre de `sim-core`, dont l'événement `EV_LEDGE` donne l'index dans cette liste.
 */
export function stageLedges(stage: StageDef): Ledges {
  const count = stage.solids.length * 2;
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  const side = new Int8Array(count);
  for (let k = 0; k < stage.solids.length; k++) {
    const solid = stage.solids[k]!;
    x[k * 2] = fxToFloat(solid.x1);
    y[k * 2] = fxToFloat(solid.y2);
    side[k * 2] = -1;
    x[k * 2 + 1] = fxToFloat(solid.x2);
    y[k * 2 + 1] = fxToFloat(solid.y2);
    side[k * 2 + 1] = 1;
  }
  return { count, x, y, side };
}

/** Noms des actions, dans l'ordre de leurs valeurs `A_*`. */
export const ACTION_NAMES: readonly string[] = [
  'IDLE',
  'WALK',
  'DASH',
  'RUN',
  'BRAKE',
  'TURN',
  'CROUCH',
  'JUMPSQUAT',
  'AIR',
  'LAND',
  'DEAD',
  'ATTACK',
  'HITSTUN',
  'TUMBLE',
  'TECH',
  'DOWN',
  'SHIELD',
  'SHIELDSTUN',
  'SHIELD_DROP',
  'SHIELD_BREAK',
  'SPOTDODGE',
  'ROLL',
  'AIRDODGE',
  'GRAB',
  'GRABBING',
  'GRABBED',
  'THROW',
  'GRAB_RELEASE',
  'LEDGE',
  'LEDGE_GETUP',
  'LEDGE_ROLL',
];

const THROW_NAMES = ['avant', 'arrière', 'haut', 'bas'];
const signed = (value: number): string => (value < 0 ? '' : '+') + value.toFixed(2);

/**
 * Ligne d'état d'un combattant. Crée une chaîne à chaque appel : réservé à la vue technique, qui
 * n'est pas soumise à la règle « aucune allocation par image ».
 */
export function describeFighter(def: FighterDef, player: number, view: FighterView): string {
  let action = ACTION_NAMES[view.action] ?? `#${view.action}`;
  if (view.action === A_ATTACK) action += ` ${def.moves[view.move]?.name ?? view.move}`;
  else if (view.action === A_THROW) action += ` ${THROW_NAMES[view.move & 3]}`;
  const flags =
    (view.grounded ? ' sol' : ' air') +
    (view.hitlag > 0 ? ` gel${view.hitlag}` : '') +
    (view.intangible ? ' intangible' : '') +
    (view.charge > 0 ? ` charge${view.charge}` : '');
  return (
    `J${player + 1}  ${action}  f${view.actionFrame}  ` +
    `v(${signed(view.velX)}, ${signed(view.velY)})  ${view.damage.toFixed(1)}%${flags}`
  );
}

/** Ce que la vue technique dessine pour une image. */
export interface DebugFrame {
  readonly shapes: Shapes;
  readonly ledges: Ledges;
  readonly framing: Framing;
  readonly bounds: CameraBounds;
  /** Lignes de texte : état de chaque combattant, puis mesures du rendu. */
  readonly lines: string[];
}

export interface DebugLayer {
  setEnabled(enabled: boolean): void;
  resize(width: number, height: number, pixelRatio: number): void;
  draw(frame: DebugFrame): void;
  dispose(): void;
}

const SHAPE_FILL = [
  'rgba(250,204,21,0.30)',
  'rgba(239,68,68,0.50)',
  'rgba(168,85,247,0.50)',
  'rgba(56,189,248,0.45)',
];
const SHAPE_STROKE = ['#facc15', '#ef4444', '#a855f7', '#38bdf8'];
/** Portée de l'accroche dessinée autour d'un rebord, en unités de jeu (indicative). */
const LEDGE_MARK = 3;

/** Crée le canvas de la vue technique dans `overlay`. Caché tant qu'il n'est pas activé. */
export function createDebugLayer(overlay: HTMLElement): DebugLayer {
  const canvas = overlay.ownerDocument.createElement('canvas');
  canvas.dataset.debug = 'layer';
  canvas.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;display:none;pointer-events:none;';
  overlay.append(canvas);
  const context = canvas.getContext('2d');
  let enabled = false;
  let width = 0;
  let height = 0;
  let ratio = 1;

  return {
    setEnabled(value) {
      enabled = value;
      canvas.style.display = value ? 'block' : 'none';
    },
    resize(w, h, pixelRatio) {
      width = w;
      height = h;
      ratio = pixelRatio;
      canvas.width = Math.round(w * pixelRatio);
      canvas.height = Math.round(h * pixelRatio);
    },
    draw(frame) {
      if (!enabled || context === null) return;
      const { shapes, ledges, framing, bounds } = frame;
      const px = (x: number, y: number): number => projectX(framing, bounds, x, y, width);
      const py = (y: number): number => projectY(framing, bounds, y, height);
      // Pixels par unité de jeu, pour les rayons.
      const scale = height / (2 * framing.distance * bounds.tanHalfFov);

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.lineCap = 'round';

      // Zones limites.
      context.setLineDash([8, 6]);
      context.lineWidth = 2;
      context.strokeStyle = '#f97316';
      // Caméra inclinée : le rectangle des zones limites se projette en trapèze.
      context.beginPath();
      context.moveTo(px(bounds.minX, bounds.maxY), py(bounds.maxY));
      context.lineTo(px(bounds.maxX, bounds.maxY), py(bounds.maxY));
      context.lineTo(px(bounds.maxX, bounds.minY), py(bounds.minY));
      context.lineTo(px(bounds.minX, bounds.minY), py(bounds.minY));
      context.closePath();
      context.stroke();
      context.setLineDash([]);

      // Rebords : un repère au coin, et un trait du côté où l'on s'y suspend.
      context.strokeStyle = '#22c55e';
      context.fillStyle = '#22c55e';
      for (let l = 0; l < ledges.count; l++) {
        const x = px(ledges.x[l]!, ledges.y[l]!);
        const y = py(ledges.y[l]!);
        context.beginPath();
        context.arc(x, y, 4, 0, Math.PI * 2);
        context.fill();
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + ledges.side[l]! * LEDGE_MARK * scale, y);
        context.stroke();
      }

      // Capsules : un trait épais aux bouts ronds a exactement la forme d'une capsule.
      for (let s = 0; s < shapes.count; s++) {
        const kind = shapes.kind[s]!;
        const x1 = px(shapes.x1[s]!, shapes.y1[s]!);
        const y1 = py(shapes.y1[s]!);
        const x2 = px(shapes.x2[s]!, shapes.y2[s]!);
        const y2 = py(shapes.y2[s]!);
        const r = shapes.radius[s]! * scale;
        context.beginPath();
        context.moveTo(x1, y1);
        // Un segment de longueur nulle ne dessine rien : un cercle est tracé comme tel.
        if (x1 === x2 && y1 === y2) context.arc(x1, y1, r, 0, Math.PI * 2);
        else context.lineTo(x2, y2);
        if (x1 === x2 && y1 === y2) {
          context.fillStyle = SHAPE_FILL[kind]!;
          context.fill();
          context.lineWidth = 1.5;
          context.strokeStyle = SHAPE_STROKE[kind]!;
          context.stroke();
        } else {
          context.lineWidth = r * 2;
          context.strokeStyle = SHAPE_FILL[kind]!;
          context.stroke();
        }
      }

      // État, en bas à gauche du HUD.
      context.font = '12px ui-monospace, Consolas, monospace';
      context.textBaseline = 'top';
      const lineHeight = 16;
      const top = 70;
      context.fillStyle = 'rgba(15,23,42,0.72)';
      context.fillRect(8, top - 4, 430, frame.lines.length * lineHeight + 8);
      context.fillStyle = '#e2e8f0';
      for (let l = 0; l < frame.lines.length; l++) {
        context.fillText(frame.lines[l]!, 14, top + l * lineHeight);
      }
    },
    dispose() {
      canvas.remove();
    },
  };
}
