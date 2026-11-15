/**
 * Démo en ligne : connexion minimale par identifiant de partie, boucle de jeu en ligne, rendu,
 * diagnostic réseau. Les salons, le matchmaking et le choix du personnage viendront du module
 * `lobby`, qui remplacera le formulaire.
 *
 * Adresse : `?game=salon&players=2` rejoint directement ; `&local=2` pour deux joueurs sur la
 * machine ; `&server=ws://hôte:port/net` pour un relais autonome au lieu de celui de Vite.
 */
import { KEYBOARD_ID, createInput, type Input } from '@game/input';
import {
  createNetClient,
  simGame,
  stepWithRespawn,
  webSocketTransport,
  type NetClient,
  type NetStatus,
  type Transport,
} from '@game/netcode';
import { createRenderer, type Renderer } from '@game/render';
import {
  checksum,
  createFighterView,
  createSim,
  readFighter,
  type FighterView,
  type Sim,
} from '@game/sim-core';
import { testConfig } from '@game/sim-core/testing';

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
const form = element<HTMLFormElement>('join');
const status = element('status');
const banner = element('banner');
const diagnostics = element('diagnostics');

const params = new URLSearchParams(location.search);
const gameId = params.get('game');
const players = Number.parseInt(params.get('players') ?? '', 10);
const localPlayers = Math.max(1, Math.min(4, Number.parseInt(params.get('local') ?? '1', 10) || 1));

if (gameId === null || !(players >= 2 && players <= 8)) {
  // Pas de partie dans l'adresse : formulaire ; il recharge la page avec les paramètres.
  form.hidden = false;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const next = new URLSearchParams();
    next.set('game', String(data.get('game')));
    next.set('players', String(data.get('players')));
    next.set('local', String(data.get('local')));
    location.search = next.toString();
  });
} else {
  play(gameId, players, localPlayers);
}

function play(id: string, expected: number, local: number): void {
  const server =
    params.get('server') ??
    `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/net`;

  // Empreintes envoyées au relais, lues au passage : pour le diagnostic et les tests.
  const sentChecksums = new Map<number, number>();
  const inner = webSocketTransport(server);
  const transport: Transport = {
    ...inner,
    send(data) {
      // CHECKSUM : type 8, frame et valeur sur 32 bits petit-boutistes.
      if (data[0] === 8 && data.length === 9) {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        sentChecksums.set(view.getUint32(1, true), view.getUint32(5, true));
        if (sentChecksums.size > 400) sentChecksums.delete(sentChecksums.keys().next().value!);
      }
      inner.send(data);
    },
  };

  const client: NetClient = createNetClient({
    transport,
    gameId: id,
    players: expected,
    localPlayers: local,
    now: () => performance.now(),
  });

  const input: Input = createInput({ target: window, players: local, storage: safeStorage() });
  input.assign(0, KEYBOARD_ID);
  // Les autres joueurs locaux prennent une manette en appuyant sur un bouton.
  input.onJoinRequest((device) => {
    for (let p = 0; p < local; p++) {
      if (input.assigned(p) === null) {
        input.assign(p, device.id);
        return;
      }
    }
  });

  let sim: Sim | null = null;
  let renderer: Renderer | null = null;
  let debug = false;
  let desyncs = 0;
  const left: string[] = [];

  const describe = (s: NetStatus): string => {
    switch (s) {
      case 'connecting':
        return `Connexion à ${server}…`;
      case 'waiting':
        return `Partie « ${id} » : ${client.joined} joueur(s) sur ${expected}. En attente des autres…`;
      case 'starting':
        return 'Tout le monde est là : la partie commence…';
      case 'running':
        return '';
      case 'closed':
        return `Connexion fermée : ${client.error ?? 'raison inconnue'}`;
    }
  };

  client.onStatus((s) => {
    if (s === 'starting' && sim === null) {
      const match = client.match!;
      const config = testConfig(match.players, match.seed);
      sim = createSim(config);
      renderer = createRenderer({ canvas, overlay, config });
      renderer.setDebug(debug);
      resize();
      renderer.capture(sim);
      client.begin(simGame(sim, stepWithRespawn));
    }
  });
  client.onDesync((frame) => {
    desyncs++;
    banner.textContent = `Désynchronisation détectée à la frame ${frame} : les écrans ne montrent plus la même partie.`;
  });
  client.onPlayerLeft((slot, frame) => {
    left.push(`J${slot + 1}`);
    banner.textContent = `${left.join(', ')} parti(s) (frame ${frame}) : leur combattant reste immobile.`;
  });

  function resize(): void {
    renderer?.resize(canvas.clientWidth, canvas.clientHeight, Math.min(window.devicePixelRatio, 2));
  }
  window.addEventListener('resize', resize);
  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.code === 'F2') {
      event.preventDefault();
      diagnostics.hidden = !diagnostics.hidden;
    } else if (event.code === 'KeyH') {
      debug = !debug;
      renderer?.setDebug(debug);
    }
  });

  let lastDiagnostics = 0;
  const idle = new Uint32Array(local);
  function tick(now: number): void {
    const alpha = client.update(
      (out) => input.sample(out),
      () => renderer!.capture(sim!),
    );
    // Hors partie, la lecture des manettes continue : c'est ce qui détecte leur arrivée.
    if (client.status !== 'running') input.sample(idle);
    renderer?.draw(alpha);
    status.textContent = describe(client.status);
    if (!diagnostics.hidden && now - lastDiagnostics > 250) {
      lastDiagnostics = now;
      const s = client.stats();
      const slots = client.match?.localSlots.map((p) => `J${p + 1}`).join(', ') ?? '—';
      diagnostics.textContent =
        `partie ${id}, vous : ${slots}\n` +
        `frame ${s.frame} (horloge ${s.targetFrame}), confirmée ${s.confirmedFrame}\n` +
        `aller-retour ${Number.isNaN(s.rttMs) ? '—' : s.rttMs.toFixed(0)} ms\n` +
        `rollbacks ${s.rollbacks} (moyenne ${s.meanRollback.toFixed(1)}, max ${s.maxRollback})\n` +
        `attentes ${s.stalls}, inputs remplacés ${s.lateInputs}, désyncs ${desyncs}`;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  /** Prise pour les tests automatiques. Aucun code de jeu ne doit s'en servir. */
  const testHook = {
    status: () => client.status,
    error: () => client.error,
    stats: () => client.stats(),
    localSlots: () => client.match?.localSlots ?? [],
    desyncs: () => desyncs,
    /** Empreintes envoyées au relais, `[frame, valeur]`, des plus anciennes aux plus récentes. */
    checksums: () => [...sentChecksums.entries()],
    fighter(player: number): FighterView | null {
      if (sim === null) return null;
      const view = createFighterView();
      readFighter(sim, player, view);
      return view;
    },
    /** Empreinte de l'état affiché (pas forcément confirmé). */
    checksum: () => (sim === null ? 0 : checksum(sim)),
  };
  (window as unknown as { __online: typeof testHook }).__online = testHook;
}

export type OnlineTestHook = {
  status(): NetStatus;
  error(): string | null;
  stats(): ReturnType<NetClient['stats']>;
  localSlots(): readonly number[];
  desyncs(): number;
  checksums(): [number, number][];
  fighter(player: number): FighterView | null;
  checksum(): number;
};
