/**
 * Démo en ligne : session de compte (invité créé au besoin), lobby (salons privés par code,
 * partie rapide), partie en ligne lancée par le lobby, résultats, retour au salon. Les écrans
 * sont minimaux ; les définitifs appartiendront à `app-shell`.
 *
 * Le serveur de développement (greffon `dev-plugin.ts`) héberge sur le même port les comptes
 * (`/api/accounts`), le lobby (`/lobby`) et le relais réservé (`/net`).
 */
import { createAccountsClient } from '@game/accounts-client';
import { KEYBOARD_ID, createInput, type Input } from '@game/input';
import { createLobbyClient, type LobbyState } from '@game/lobby/client';
import type { MatchStartInfo } from '@game/lobby/protocol';
import type { MatchResult } from '@game/match-rules';
import type { NetStats, NetStatus } from '@game/netcode';
import { checksum, createFighterView, readFighter, type FighterView } from '@game/sim-core';
import { createLobbyUi } from './lobby-ui.ts';
import { startOnlineMatch, type OnlineMatch } from './match.ts';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Élément #${id} introuvable.`);
  return found as T;
}

/** `localStorage`, ou rien si le navigateur l'interdit. */
function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

const canvas = element<HTMLCanvasElement>('game');
const overlay = element('overlay');
const panel = element('lobby');
const status = element('status');
const banner = element('banner');
const diagnostics = element('diagnostics');

const accounts = createAccountsClient();

/** Session existante, sinon invité : on peut jouer tout de suite. */
async function ensureSession(): Promise<boolean> {
  const session = await accounts.session();
  if (session.ok && session.value !== null) return true;
  const guest = await accounts.guest();
  if (!guest.ok) {
    banner.textContent = `Compte : ${guest.error.message}`;
    return false;
  }
  return true;
}

async function ticket(aud: 'lobby' | 'relay'): Promise<string | null> {
  const t = await accounts.ticket(aud);
  if (t.ok) return t.value.ticket;
  // Session perdue (serveur redémarré) : nouvel invité, puis nouvel essai.
  if (t.error.code === 'unauthenticated' && (await ensureSession())) {
    const again = await accounts.ticket(aud);
    return again.ok ? again.value.ticket : null;
  }
  return null;
}

const input: Input = createInput({ target: window, players: 1, storage: safeStorage() });
input.assign(0, KEYBOARD_ID);

const lobby = createLobbyClient({
  url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/lobby`,
  getTicket: async () => ((await ensureSession()) ? ticket('lobby') : null),
  now: () => performance.now(),
});
const ui = createLobbyUi(panel, lobby);

let match: OnlineMatch | null = null;
let debug = false;
let desyncs = 0;
const results: { gameId: string; result: MatchResult }[] = [];

function stopMatch(): void {
  if (match === null) return;
  const r = match.result();
  if (r !== null) results.push({ gameId: match.info.gameId, result: r });
  match.stop();
  match = null;
  status.textContent = '';
  banner.textContent = '';
  ui.show(true);
}

lobby.onMatchStart((info: MatchStartInfo) => {
  // Même partie déjà en cours (`matchStart` renvoyé après une reconnexion du lobby) : rien à faire.
  if (match !== null && match.info.gameId === info.gameId && match.net.status !== 'closed') return;
  stopMatch();
  ui.setMatchPlayers(info.players.map((p) => p.name));
  void ticket('relay').then((relayTicket) => {
    if (relayTicket === null) {
      banner.textContent = 'Impossible d’obtenir un ticket pour rejoindre la partie.';
      return;
    }
    if (lobby.state.match?.gameId !== info.gameId) return;
    banner.textContent = '';
    ui.show(false);
    match = startOnlineMatch({
      info,
      ticket: relayTicket,
      canvas,
      overlay,
      input,
      lobby,
      debug,
      onStatus: (text) => {
        if (text.startsWith('Désynchronisation')) desyncs++;
        banner.textContent = text;
      },
    });
  });
});

lobby.onChange((state: LobbyState) => {
  // Fin du match (ou salon quitté) : retour aux écrans du lobby.
  if (match !== null && state.match === null) stopMatch();
  ui.render(state);
});
ui.render(lobby.state);

window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  if (event.code === 'F2') {
    event.preventDefault();
    diagnostics.hidden = !diagnostics.hidden;
  } else if (event.code === 'KeyH' && !(event.target instanceof HTMLInputElement)) {
    debug = !debug;
  }
});

function describe(s: NetStatus): string {
  switch (s) {
    case 'connecting':
      return 'Connexion au relais…';
    case 'waiting':
      return 'En attente des autres joueurs…';
    case 'starting':
      return 'Tout le monde est là : la partie commence…';
    case 'running':
      return '';
    case 'closed':
      return '';
  }
}

let lastDiagnostics = 0;
const idle = new Uint32Array(1);
function tick(now: number): void {
  if (match !== null) {
    match.frame();
    const s = describe(match.net.status);
    if (s !== '' || status.textContent !== '') status.textContent = s;
  } else {
    // Hors partie, la lecture des manettes continue : c'est ce qui détecte leur arrivée.
    input.sample(idle);
  }
  if (!diagnostics.hidden && now - lastDiagnostics > 250) {
    lastDiagnostics = now;
    if (match === null) {
      diagnostics.textContent = `lobby : ${lobby.state.status}, aller-retour ${lobby.state.rttMs ?? '—'} ms`;
    } else {
      const s = match.net.stats();
      diagnostics.textContent =
        `partie ${match.info.gameId}, vous : J${match.info.slot + 1}\n` +
        `frame ${s.frame} (horloge ${s.targetFrame}), confirmée ${s.confirmedFrame}\n` +
        `aller-retour ${Number.isNaN(s.rttMs) ? '—' : s.rttMs.toFixed(0)} ms\n` +
        `rollbacks ${s.rollbacks} (moyenne ${s.meanRollback.toFixed(1)}, max ${s.maxRollback})\n` +
        `attentes ${s.stalls}, inputs remplacés ${s.lateInputs}, désyncs ${desyncs}`;
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

/** Prise pour les tests automatiques. Aucun code de jeu ne doit s'en servir. */
const testHook = {
  lobby: () => lobby.state,
  status: (): NetStatus | 'lobby' => match?.net.status ?? 'lobby',
  error: () => match?.net.error ?? null,
  stats: (): NetStats | null => match?.net.stats() ?? null,
  localSlots: () => (match === null ? [] : [match.info.slot]),
  desyncs: () => desyncs,
  /** Empreintes envoyées au relais, `[frame, valeur]`, des plus anciennes aux plus récentes. */
  checksums: () => match?.checksums() ?? [],
  fighter(player: number): FighterView | null {
    const sim = match?.sim() ?? null;
    if (sim === null) return null;
    const view = createFighterView();
    readFighter(sim, player, view);
    return view;
  },
  checksum: () => {
    const sim = match?.sim() ?? null;
    return sim === null ? 0 : checksum(sim);
  },
  /** Résultats calculés par cette page, un par match terminé. */
  results: () => [
    ...results,
    ...(match?.result() ? [{ gameId: match.info.gameId, result: match.result()! }] : []),
  ],
};
(window as unknown as { __online: typeof testHook }).__online = testHook;

export type OnlineTestHook = typeof testHook;
