/**
 * HUD de match : chronomètre, vies ou points de vie, score, jauge d'ultime et équipe.
 *
 * `render` ne dépend pas de `match-rules` : ce HUD reçoit des données de forme simple
 * (`MatchHudData`), que `MatchView` de `match-rules` respecte telle quelle. Comme le HUD de
 * combat, il ne touche au DOM que lorsqu'une valeur affichée change.
 */

/** Données lues à chaque image. Tableaux indexés par joueur. */
export interface MatchHudData {
  readonly players: number;
  readonly phase: string;
  /** Secondes restantes, ou -1 sans limite. */
  readonly timeLeft: number;
  readonly showScore: boolean;
  readonly meterEnabled: boolean;
  /** Vies, ou -1 si elles ne sont pas comptées. */
  readonly stocks: ArrayLike<number>;
  /** Points de vie, ou -1 hors Endurance. */
  readonly hp: ArrayLike<number>;
  readonly score: ArrayLike<number>;
  /** Jauge d'ultime, de 0 à 1. */
  readonly meter: ArrayLike<number>;
  readonly ultimateReady: ArrayLike<number>;
  /** Équipe de 0 à 3, ou -1. */
  readonly team: ArrayLike<number>;
  readonly eliminated: ArrayLike<number>;
}

/** Sortie du HUD de match : le DOM en jeu, un enregistreur dans les tests. */
export interface MatchHudSink {
  /** Texte vide : chronomètre masqué. */
  setClock(text: string): void;
  /** -1 : vies masquées. */
  setStocks(player: number, stocks: number): void;
  /** -1 : points de vie masqués. */
  setHp(player: number, hp: number): void;
  /** `null` : score masqué. */
  setScore(player: number, score: number | null): void;
  /** `percent` entier de 0 à 100, ou -1 : jauge masquée. */
  setMeter(player: number, percent: number, ready: boolean): void;
  setTeam(player: number, team: number): void;
  setEliminated(player: number, eliminated: boolean): void;
  dispose(): void;
}

export interface MatchHud {
  update(data: MatchHudData): void;
  dispose(): void;
}

/** Texte du chronomètre : « m:ss », « Mort subite », « Terminé », ou vide sans limite. */
export function formatClock(timeLeft: number, phase: string): string {
  if (phase === 'over') return 'Terminé';
  if (phase === 'sudden-death') return 'Mort subite';
  if (timeLeft < 0) return '';
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

const UNSET = -0x7fffffff;

export function createMatchHud(players: number, sink: MatchHudSink): MatchHud {
  let clockSeconds = UNSET;
  let clockPhase = '';
  let clockText: string | null = null;
  const stocks = new Int32Array(players).fill(UNSET);
  const hp = new Int32Array(players).fill(UNSET);
  const score = new Int32Array(players).fill(UNSET);
  const meter = new Int32Array(players).fill(UNSET);
  const ready = new Int8Array(players).fill(-1);
  const team = new Int32Array(players).fill(UNSET);
  const out = new Int8Array(players).fill(-1);

  return {
    update(d) {
      // Le texte n'est recalculé (et alloué) que lorsque la seconde ou la phase change.
      if (d.timeLeft !== clockSeconds || d.phase !== clockPhase) {
        clockSeconds = d.timeLeft;
        clockPhase = d.phase;
        const text = formatClock(clockSeconds, clockPhase);
        if (text !== clockText) sink.setClock((clockText = text));
      }
      for (let p = 0; p < players; p++) {
        const s = d.stocks[p]!;
        if (stocks[p] !== s) sink.setStocks(p, (stocks[p] = s));
        const h = d.hp[p]!;
        if (hp[p] !== h) sink.setHp(p, (hp[p] = h));
        // Score masqué : mémorisé comme UNSET + 1, distinct de toute vraie valeur.
        const sc = d.showScore ? d.score[p]! : UNSET + 1;
        if (score[p] !== sc) {
          score[p] = sc;
          sink.setScore(p, d.showScore ? sc : null);
        }
        const m = d.meterEnabled ? Math.floor(d.meter[p]! * 100) : -1;
        const r = d.meterEnabled && d.ultimateReady[p] === 1 ? 1 : 0;
        if (meter[p] !== m || ready[p] !== r) {
          meter[p] = m;
          ready[p] = r;
          sink.setMeter(p, m, r === 1);
        }
        const t = d.team[p]!;
        if (team[p] !== t) sink.setTeam(p, (team[p] = t));
        const o = d.eliminated[p] === 1 ? 1 : 0;
        if (out[p] !== o) {
          out[p] = o;
          sink.setEliminated(p, o === 1);
        }
      }
    },
    dispose() {
      sink.dispose();
    },
  };
}

/** Couleurs des équipes 0 à 3 : rouge, bleu, vert, jaune. */
export const TEAM_COLORS: readonly number[] = [0xe5484d, 0x3e7bfa, 0x30a46c, 0xf5c518];

const cssColor = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;
/** Au-delà, les vies s'affichent en nombre plutôt qu'en pastilles. */
const MAX_STOCK_DOTS = 5;

/** Construit le HUD de match dans `overlay` (bas de l'écran et coin haut droit). */
export function createMatchDomSink(overlay: HTMLElement, players: number): MatchHudSink {
  const doc = overlay.ownerDocument;
  const root = doc.createElement('div');
  root.dataset.hud = 'match';
  root.style.cssText =
    'position:absolute;inset:0;overflow:hidden;pointer-events:none;color:#fff;' +
    'font-family:system-ui,sans-serif;font-weight:700;font-variant-numeric:tabular-nums;';

  const clock = doc.createElement('div');
  clock.dataset.hud = 'clock';
  clock.style.cssText =
    'position:absolute;top:10px;right:12px;padding:4px 12px;border-radius:6px;font-size:22px;' +
    'background:rgba(15,23,42,0.72);display:none;';
  root.append(clock);

  const bar = doc.createElement('div');
  bar.style.cssText =
    'position:absolute;left:0;right:0;bottom:10px;display:flex;justify-content:center;gap:10px;' +
    'flex-wrap:wrap;padding:0 16px;';
  root.append(bar);

  interface Card {
    panel: HTMLElement;
    stocks: HTMLElement;
    hp: HTMLElement;
    score: HTMLElement;
    meter: HTMLElement;
    fill: HTMLElement;
  }
  const cards: Card[] = [];
  for (let i = 0; i < players; i++) {
    const panel = doc.createElement('div');
    panel.dataset.hud = `match-${i}`;
    panel.style.cssText =
      'min-width:76px;padding:4px 8px;border-radius:6px;background:rgba(15,23,42,0.72);' +
      'border-top:4px solid transparent;text-align:center;font-size:12px;';
    const label = doc.createElement('div');
    label.textContent = `J${i + 1}`;
    const stocks = doc.createElement('div');
    stocks.dataset.hud = `stocks-${i}`;
    stocks.style.cssText = 'font-size:14px;letter-spacing:1px;min-height:17px;';
    const hp = doc.createElement('div');
    hp.dataset.hud = `hp-${i}`;
    const score = doc.createElement('div');
    score.dataset.hud = `score-${i}`;
    const meter = doc.createElement('div');
    meter.dataset.hud = `meter-${i}`;
    meter.style.cssText =
      'height:6px;margin-top:3px;border-radius:3px;background:rgba(255,255,255,0.18);overflow:hidden;';
    const fill = doc.createElement('div');
    fill.style.cssText = 'height:100%;width:0;background:#94a3b8;';
    meter.append(fill);
    panel.append(label, stocks, hp, score, meter);
    bar.append(panel);
    cards.push({ panel, stocks, hp, score, meter, fill });
  }
  overlay.append(root);

  return {
    setClock(text) {
      clock.textContent = text;
      clock.style.display = text === '' ? 'none' : 'block';
    },
    setStocks(p, n) {
      const el = cards[p]!.stocks;
      el.style.display = n < 0 ? 'none' : 'block';
      el.textContent = n > MAX_STOCK_DOTS ? `● × ${n}` : '●'.repeat(Math.max(0, n));
    },
    setHp(p, hp) {
      const el = cards[p]!.hp;
      el.style.display = hp < 0 ? 'none' : 'block';
      el.textContent = `${hp} PV`;
    },
    setScore(p, score) {
      const el = cards[p]!.score;
      el.style.display = score === null ? 'none' : 'block';
      el.textContent = score === null ? '' : `${score > 0 ? '+' : ''}${score}`;
    },
    setMeter(p, percent, ready) {
      const card = cards[p]!;
      card.meter.style.display = percent < 0 ? 'none' : 'block';
      card.fill.style.width = `${Math.max(0, percent)}%`;
      card.fill.style.background = ready ? '#fde047' : '#94a3b8';
      card.meter.style.boxShadow = ready ? '0 0 6px #fde047' : 'none';
      card.meter.dataset.ready = ready ? '1' : '0';
    },
    setTeam(p, team) {
      cards[p]!.panel.style.borderTopColor =
        team < 0 ? 'transparent' : cssColor(TEAM_COLORS[team % TEAM_COLORS.length]!);
    },
    setEliminated(p, eliminated) {
      cards[p]!.panel.style.opacity = eliminated ? '0.4' : '1';
    },
    dispose() {
      root.remove();
    },
  };
}
