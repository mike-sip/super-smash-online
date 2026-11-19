/**
 * Combat en ligne lancé par le lobby : client netcode authentifié par un ticket « relay »,
 * simulation construite par `buildSimConfig` (même configuration chez tous), rendu, son, HUD,
 * puis déclaration du résultat au lobby sur un état confirmé. Pas de pause en ligne : Échap
 * propose de quitter, sans arrêter le jeu.
 */
import type { LobbyClient } from '@game/lobby/client';
import type { MatchStartInfo } from '@game/lobby/protocol';
import { createMatchView, matchResult, readMatch, type MatchResult } from '@game/match-rules';
import {
  createNetClient,
  simGame,
  webSocketTransport,
  type NetClient,
  type NetStatus,
} from '@game/netcode';
import {
  createMatchDomSink,
  createMatchHud,
  createRenderer,
  createFigurines,
  distinctPalettes,
  type MatchHud,
  type Renderer,
} from '@game/render';
import { STICK_MAX, checksum, createSim, encodeInput, type Sim } from '@game/sim-core';
import type { App, Screen } from './app.ts';
import { buildSimConfig, lookOf } from './content.ts';
import { portraitUrl } from './portraits.ts';
import { el } from './ui/dom.ts';

export interface OnlineMatch extends Screen {
  readonly info: MatchStartInfo;
  readonly net: NetClient;
  /** Résultat calculé par cette page, une fois le match fini sur un état confirmé. */
  result(): MatchResult | null;
  /** Ferme la connexion au relais (fin du match, ou abandon). */
  stop(): void;
}

const STATUS_TEXT: Readonly<Record<NetStatus, string>> = {
  connecting: 'Connexion à la partie…',
  waiting: 'En attente des autres joueurs…',
  starting: 'La partie commence…',
  running: '',
  closed: '',
};

export function onlineMatch(
  app: App,
  options: {
    info: MatchStartInfo;
    ticket: string;
    lobby: LobbyClient;
    /** Le joueur a choisi de quitter. */
    onQuit: () => void;
    /** Le relais a fermé la partie avant sa fin (erreur, serveur arrêté). */
    onLost: (error: string | null) => void;
  },
): OnlineMatch {
  const { info, lobby } = options;
  app.releaseCanvas();
  const canvas = app.elements.canvas;
  const overlay = app.elements.overlay;
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const net = createNetClient({
    transport: webSocketTransport(`${scheme}://${location.host}${info.relayPath}`),
    gameId: info.gameId,
    players: info.players.length,
    localPlayers: 1,
    ticket: options.ticket,
    now: () => performance.now(),
  });

  let sim: Sim | null = null;
  let renderer: Renderer | null = null;
  let hud: MatchHud | null = null;
  let reported: MatchResult | null = null;
  let stopped = false;
  let lostNotified = false;
  /** Prise de test : pousser le stick à fond vers la gauche (sortir du stage). */
  let forceLeft = false;
  const view = createMatchView();
  const local = new Uint32Array(4);
  const idle = new Uint32Array(4);

  const status = el('p', { className: 'banner-inline', attrs: { role: 'status' } });
  const root = el(
    'section',
    { className: 'screen clear', attrs: { 'aria-label': 'Combat en ligne' } },
    [status],
  );

  function resize(): void {
    app.syncQuality(renderer);
    renderer?.resize(canvas.clientWidth, canvas.clientHeight, app.pixelRatio());
  }
  window.addEventListener('resize', resize);

  net.onStatus((s) => {
    status.textContent = STATUS_TEXT[s];
    if (s === 'starting' && sim === null) {
      sim = createSim(
        buildSimConfig(info.config, {
          stage: info.stage,
          fighters: info.players.map((p) => p.fighter),
          seed: net.match!.seed,
        }),
      );
      renderer = createRenderer({
        canvas,
        overlay,
        config: sim.config,
        fighterVisuals: createFigurines(
          (p) => lookOf(info.players[p]?.fighter ?? ''),
          (p) => distinctPalettes(info.players.map((q) => q.fighter))[p] ?? 0,
        ),
        ...app.qualityOptions(),
      });
      const ids = info.players.map((q) => q.fighter);
      const colors = distinctPalettes(ids);
      const icons = ids.map((id, p) => portraitUrl(id, colors[p] ?? 0, 'stock', 72));
      hud = createMatchHud(
        info.players.length,
        createMatchDomSink(overlay, info.players.length, icons),
      );
      resize();
      renderer.capture(sim);
      app.audio.capture(sim);
      net.begin(simGame(sim));
      app.announce('La partie commence');
    }
    if (s === 'closed' && !stopped && !lostNotified && reported === null) {
      lostNotified = true;
      options.onLost(net.error);
    }
  });
  net.onPlayerLeft((slot) => app.toast(`${info.players[slot]?.name ?? '?'} a quitté la partie.`));
  net.onPlayerRejoined((slot) => app.toast(`${info.players[slot]?.name ?? '?'} est revenu.`));
  net.onDesync(() => app.toast('Désynchronisation détectée : ce match ne sera pas compté.'));

  function askQuit(): void {
    app.confirm('Quitter la partie ? Elle continue sans vous et compte comme une défaite.', [
      { label: 'Quitter', action: () => options.onQuit() },
      { label: 'Continuer à jouer', action: () => {}, primary: true },
    ]);
  }

  const screen: OnlineMatch = {
    id: 'match-online',
    back: 'confirm',
    root,
    info,
    net,
    get capturesInput() {
      return !app.dialogOpen();
    },
    result: () => reported,
    onBack: askQuit,
    onKey(event) {
      if (event.key === 'Escape' && !event.repeat) {
        askQuit();
        return true;
      }
      return false;
    },
    frame() {
      if (stopped) return;
      const alpha = net.update(
        (out) => {
          app.input.sample(local);
          // Dialogue ouvert : le combattant ne bouge pas pendant qu'on choisit.
          out[0] = app.dialogOpen() ? 0 : forceLeft ? encodeInput(-STICK_MAX, 0, 0) : local[0]!;
        },
        () => {
          renderer!.capture(sim!);
          app.audio.capture(sim!);
        },
      );
      if (net.status !== 'running') app.input.sample(idle);
      if (sim !== null && hud !== null) {
        readMatch(sim, view);
        hud.update(view);
        if (reported === null) {
          const result = matchResult(sim);
          // Déclaré sur un état confirmé : toutes les frames jusqu'à la fin ont leurs inputs définitifs.
          if (result !== null && net.stats().confirmedFrame > result.endFrame) {
            reported = result;
            lobby.reportResult(info.gameId, result);
            status.textContent = 'Match terminé : en attente des autres joueurs…';
            app.announce('Match terminé');
          }
        }
      }
      if (renderer !== null) app.timeDraw(() => renderer!.draw(alpha));
    },
    stop() {
      if (stopped) return;
      stopped = true;
      net.close();
    },
    dispose() {
      screen.stop();
      window.removeEventListener('resize', resize);
      hud?.dispose();
      app.rememberQuality(renderer);
      renderer?.dispose();
      hud = null;
      renderer = null;
    },
  };

  app.test.online = () => ({
    status: net.status,
    slot: info.slot,
    gameId: info.gameId,
    frame: net.stats().frame,
    confirmed: net.stats().confirmedFrame,
    checksum: sim === null ? 0 : checksum(sim),
    result: reported,
  });
  app.test.forceLeft = (on: boolean) => {
    forceLeft = on;
  };
  return screen;
}
