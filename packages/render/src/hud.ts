/**
 * HUD de combat : pourcentage de dégâts par joueur et étiquette au-dessus de chaque combattant.
 *
 * Le HUD est en HTML, superposé au canvas. Écrire dans le DOM coûte cher : `createHud` ne
 * transmet à sa sortie que ce qui change réellement à l'affichage.
 */
import { PLAYER_COLORS } from './fighters/visual.ts';

/** Sortie du HUD : le DOM en jeu, un enregistreur dans les tests. */
export interface HudSink {
  /** `percent` est un entier. */
  setDamage(player: number, percent: number): void;
  /** Position du bas de l'étiquette, en pixels depuis le coin haut gauche, au demi-pixel. */
  setTag(player: number, x: number, y: number): void;
  setTagVisible(player: number, visible: boolean): void;
  dispose(): void;
}

export interface Hud {
  damage(player: number, value: number): void;
  tag(player: number, x: number, y: number, visible: boolean): void;
  dispose(): void;
}

export function createHud(players: number, sink: HudSink): Hud {
  const percent = new Int32Array(players).fill(-1);
  // Positions mémorisées en demi-pixels ; -1 dans `visible` : jamais écrit.
  const tagX = new Int32Array(players).fill(-(2 ** 30));
  const tagY = new Int32Array(players).fill(-(2 ** 30));
  const visible = new Int8Array(players).fill(-1);

  return {
    damage(player, value) {
      const shown = Math.floor(value);
      if (percent[player] === shown) return;
      percent[player] = shown;
      sink.setDamage(player, shown);
    },
    tag(player, x, y, show) {
      const flag = show ? 1 : 0;
      if (visible[player] !== flag) {
        visible[player] = flag;
        sink.setTagVisible(player, show);
      }
      if (!show) return;
      const hx = Math.round(x * 2);
      const hy = Math.round(y * 2);
      if (tagX[player] === hx && tagY[player] === hy) return;
      tagX[player] = hx;
      tagY[player] = hy;
      sink.setTag(player, hx / 2, hy / 2);
    },
    dispose() {
      sink.dispose();
    },
  };
}

const cssColor = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

/** Dégâts à partir desquels le pourcentage est affiché en rouge franc. */
const DAMAGE_RED = 150;

/**
 * Couleur du pourcentage (SPEC-finition.md, phase 4) : blanc, puis jaune, orange, rouge, et rouge
 * sombre au-delà de 150 %. Logique pure.
 */
export function heatColor(percent: number): string {
  const stops: readonly (readonly [number, number, number, number])[] = [
    [0, 255, 255, 255],
    [40, 255, 236, 120],
    [80, 255, 160, 60],
    [120, 255, 72, 48],
    [DAMAGE_RED, 200, 24, 36],
  ];
  const p = Math.max(0, percent);
  for (let i = 1; i < stops.length; i++) {
    const [b, r1, g1, b1] = stops[i]!;
    if (p <= b) {
      const [a, r0, g0, b0] = stops[i - 1]!;
      const t = (p - a) / (b - a);
      const mix = (x: number, y: number): number => Math.round(x + (y - x) * t);
      return `rgb(${mix(r0, r1)},${mix(g0, g1)},${mix(b0, b1)})`;
    }
  }
  const last = stops[stops.length - 1]!;
  return `rgb(${last[1]},${last[2]},${last[3]})`;
}

/** Mouvements réduits (réglage du jeu ou préférence du système) : pas de secousse du HUD. */
function calm(doc: Document): boolean {
  return (
    doc.documentElement.dataset.motion === 'reduced' ||
    (doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  );
}

/** Construit le HUD dans `overlay` et renvoie la sortie qui l'alimente. */
export function createDomSink(overlay: HTMLElement, players: number): HudSink {
  const doc = overlay.ownerDocument;
  const root = doc.createElement('div');
  root.style.cssText =
    'position:absolute;inset:0;overflow:hidden;pointer-events:none;' +
    "font-family:'Lilita One','Arial Black',system-ui,sans-serif;font-variant-numeric:tabular-nums;";

  const bar = doc.createElement('div');
  bar.style.cssText =
    'position:absolute;left:0;right:0;top:10px;display:flex;justify-content:center;gap:12px;';
  root.append(bar);

  const values: HTMLElement[] = [];
  const tags: HTMLElement[] = [];
  for (let i = 0; i < players; i++) {
    const color = cssColor(PLAYER_COLORS[i % PLAYER_COLORS.length]!);
    const name = `J${i + 1}`;

    const panel = doc.createElement('div');
    // Carte du joueur : bandeau à sa couleur, grand pourcentage cerné de sombre.
    panel.style.cssText =
      'width:104px;box-sizing:border-box;padding:2px 8px 4px;border-radius:10px 10px 4px 4px;' +
      `background:linear-gradient(180deg,rgba(15,23,42,0.55),rgba(15,23,42,0.85));` +
      `border-bottom:5px solid ${color};box-shadow:0 6px 16px rgba(0,0,0,0.45),inset 0 -14px 18px -12px ${color};` +
      'text-align:center;';
    const label = doc.createElement('div');
    label.textContent = name;
    label.style.cssText = `font-size:13px;letter-spacing:1px;color:${color};text-shadow:0 1px 0 #000;`;
    const value = doc.createElement('div');
    value.dataset.hud = `damage-${i}`;
    value.style.cssText =
      'font-size:38px;line-height:1;color:#fff;-webkit-text-stroke:2px #0b0e18;paint-order:stroke fill;' +
      'text-shadow:0 3px 0 #0b0e18,0 6px 12px rgba(0,0,0,0.5);display:inline-block;';
    panel.append(label, value);
    bar.append(panel);
    values.push(value);

    const tag = doc.createElement('div');
    tag.dataset.hud = `tag-${i}`;
    tag.textContent = name;
    tag.style.cssText =
      'position:absolute;left:0;top:0;display:none;padding:0 6px;border-radius:5px;' +
      `font-size:13px;line-height:17px;color:#0f172a;background:${color};will-change:transform;` +
      'box-shadow:0 2px 0 rgba(0,0,0,0.4);';
    root.append(tag);
    tags.push(tag);
  }
  overlay.append(root);

  const shown = new Int32Array(players);
  return {
    setDamage(player, percent) {
      const value = values[player]!;
      value.textContent = `${percent}%`;
      // Du blanc au rouge sombre à mesure que les dégâts montent.
      value.style.color = heatColor(percent);
      // Touché : le chiffre grossit et tremble, d'autant plus que le coup est fort.
      const gain = percent - shown[player]!;
      shown[player] = percent;
      if (gain > 0 && typeof value.animate === 'function' && !calm(doc)) {
        const k = Math.min(1, gain / 20);
        const s = 1 + 0.25 + 0.35 * k;
        const d = 3 + 6 * k;
        value.animate(
          [
            { transform: `scale(${s}) translate(${d}px,0)` },
            { transform: `scale(${(s + 1) / 2}) translate(${-d}px,0)` },
            { transform: `scale(1.05) translate(${d / 2}px,0)` },
            { transform: 'scale(1) translate(0,0)' },
          ],
          { duration: 260 + 120 * k, easing: 'ease-out' },
        );
      }
    },
    setTag(player, x, y) {
      // Le point donné est le bas de l'étiquette, centré.
      tags[player]!.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`;
    },
    setTagVisible(player, visible) {
      tags[player]!.style.display = visible ? 'block' : 'none';
    },
    dispose() {
      root.remove();
    },
  };
}
