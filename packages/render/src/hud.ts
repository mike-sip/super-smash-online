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

/** Construit le HUD dans `overlay` et renvoie la sortie qui l'alimente. */
export function createDomSink(overlay: HTMLElement, players: number): HudSink {
  const doc = overlay.ownerDocument;
  const root = doc.createElement('div');
  root.style.cssText =
    'position:absolute;inset:0;overflow:hidden;pointer-events:none;' +
    'font-family:system-ui,sans-serif;font-weight:700;font-variant-numeric:tabular-nums;';

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
    panel.style.cssText =
      `min-width:64px;padding:4px 10px;border-radius:6px;border-bottom:4px solid ${color};` +
      'background:rgba(15,23,42,0.72);text-align:center;';
    const label = doc.createElement('div');
    label.textContent = name;
    label.style.cssText = `font-size:12px;color:${color};`;
    const value = doc.createElement('div');
    value.dataset.hud = `damage-${i}`;
    value.style.cssText = 'font-size:24px;line-height:1.1;color:#fff;';
    panel.append(label, value);
    bar.append(panel);
    values.push(value);

    const tag = doc.createElement('div');
    tag.dataset.hud = `tag-${i}`;
    tag.textContent = name;
    tag.style.cssText =
      'position:absolute;left:0;top:0;display:none;padding:0 5px;border-radius:4px;' +
      `font-size:12px;line-height:16px;color:#0f172a;background:${color};will-change:transform;`;
    root.append(tag);
    tags.push(tag);
  }
  overlay.append(root);

  return {
    setDamage(player, percent) {
      const value = values[player]!;
      value.textContent = `${percent}%`;
      // Du blanc au rouge à mesure que les dégâts montent.
      const heat = Math.min(1, percent / DAMAGE_RED);
      const fade = Math.round(255 * (1 - heat * 0.75));
      value.style.color = `rgb(255,${fade},${fade})`;
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
