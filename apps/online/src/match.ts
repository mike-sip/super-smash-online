/**
 * Une partie en ligne lancée par le lobby : client netcode authentifié par un ticket « relay »,
 * simulation construite par `match-rules` à partir de la configuration reçue, rendu et HUD de
 * match, puis déclaration du résultat au lobby sur un état confirmé.
 */
import type { Input } from '@game/input';
import type { LobbyClient } from '@game/lobby/client';
import type { MatchStartInfo } from '@game/lobby/protocol';
import {
  createMatchSimConfig,
  createMatchView,
  matchResult,
  readMatch,
  type MatchResult,
} from '@game/match-rules';
import {
  createNetClient,
  simGame,
  webSocketTransport,
  type NetClient,
  type Transport,
} from '@game/netcode';
import {
  createMatchDomSink,
  createMatchHud,
  createRenderer,
  type MatchHud,
  type Renderer,
} from '@game/render';
import { createSim, type Sim } from '@game/sim-core';
import { TEST_ENTITIES } from '@game/sim-core/testing';
import { FIGHTERS, STAGES } from './content.ts';

export interface OnlineMatch {
  readonly info: MatchStartInfo;
  readonly net: NetClient;
  readonly sim: () => Sim | null;
  readonly result: () => MatchResult | null;
  /** Empreintes envoyées au relais, `[frame, valeur]`. */
  readonly checksums: () => [number, number][];
  /** Appelée à chaque image par la boucle de la page. */
  frame(): void;
  stop(): void;
}

export function startOnlineMatch(options: {
  info: MatchStartInfo;
  ticket: string;
  canvas: HTMLCanvasElement;
  overlay: HTMLElement;
  input: Input;
  lobby: LobbyClient;
  onStatus: (text: string) => void;
  debug: boolean;
}): OnlineMatch {
  const { info, canvas, overlay, input, lobby } = options;
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${info.relayPath}`;
  const sent = new Map<number, number>();
  const inner = webSocketTransport(url);
  const transport: Transport = {
    ...inner,
    send(data) {
      // CHECKSUM : type 8, frame et valeur sur 32 bits petit-boutistes (pour les tests).
      if (data[0] === 8 && data.length === 9) {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        sent.set(view.getUint32(1, true), view.getUint32(5, true));
        if (sent.size > 400) sent.delete(sent.keys().next().value!);
      }
      inner.send(data);
    },
  };
  const net = createNetClient({
    transport,
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
  const view = createMatchView();
  const idle = new Uint32Array(1);

  function resize(): void {
    renderer?.resize(canvas.clientWidth, canvas.clientHeight, Math.min(window.devicePixelRatio, 2));
  }
  window.addEventListener('resize', resize);

  net.onStatus((s) => {
    if (s === 'starting' && sim === null) {
      const config = createMatchSimConfig(info.config, {
        stage: STAGES[info.stage]!.def,
        fighters: info.players.map((p) => FIGHTERS[p.fighter]!.def),
        entities: TEST_ENTITIES,
        seed: net.match!.seed,
      });
      sim = createSim(config);
      renderer = createRenderer({ canvas, overlay, config });
      renderer.setDebug(options.debug);
      hud = createMatchHud(info.players.length, createMatchDomSink(overlay, info.players.length));
      resize();
      renderer.capture(sim);
      net.begin(simGame(sim));
    }
  });
  net.onPlayerLeft((slot) =>
    options.onStatus(`${info.players[slot]?.name ?? '?'} a quitté la partie.`),
  );
  net.onPlayerRejoined((slot) =>
    options.onStatus(`${info.players[slot]?.name ?? '?'} est revenu.`),
  );
  net.onDesync((f) => options.onStatus(`Désynchronisation détectée à la frame ${f}.`));

  return {
    info,
    net,
    sim: () => sim,
    result: () => reported,
    checksums: () => [...sent.entries()],
    frame() {
      const alpha = net.update(
        (out) => input.sample(out),
        () => renderer!.capture(sim!),
      );
      if (net.status !== 'running') input.sample(idle);
      if (sim !== null && hud !== null) {
        readMatch(sim, view);
        hud.update(view);
        if (reported === null) {
          // Déclaré sur un état confirmé : toutes les frames jusqu'à la fin ont leurs inputs définitifs.
          const result = matchResult(sim);
          if (result !== null && net.stats().confirmedFrame > result.endFrame) {
            reported = result;
            lobby.reportResult(info.gameId, result);
            options.onStatus('Match terminé : en attente des autres joueurs…');
          }
        }
      }
      renderer?.draw(alpha);
    },
    stop() {
      window.removeEventListener('resize', resize);
      net.close();
      hud?.dispose();
      renderer?.dispose();
      hud = null;
      renderer = null;
    },
  };
}
