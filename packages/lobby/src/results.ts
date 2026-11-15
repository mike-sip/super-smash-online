/**
 * Fin d'un match (SPEC-lobby.md, « Pendant la partie et fin du match ») : déclarations des
 * clients, concordance, enregistrement transmis au classement. Logique pure.
 *
 * Résultat accepté (`agreed`) : les déclarations de tous les joueurs encore présents au relais
 * sont arrivées, elles sont toutes identiques (celles des partis compris), et le relais n'a
 * signalé aucune désynchronisation. Désaccord ou désync : `contested` tout de suite ; déclarations
 * manquantes `timeoutMs` après la première : `contested` aussi.
 */
import type { MatchConfig, PlayerResult } from '@game/match-rules';
import type { DeclaredResult, MatchPlayerInfo, RoomKind } from './protocol.ts';
import type { Outcome } from './room.ts';

export interface MatchRecord {
  /** UUID tiré à la création de la partie : clé d'idempotence pour `ranking`. */
  readonly matchId: string;
  /** Partie rapide : vrai ; salon privé : faux. */
  readonly ranked: boolean;
  /** Identifiant de la partie sur le relais. */
  readonly gameId: string;
  readonly kind: RoomKind;
  readonly region: string;
  readonly config: MatchConfig;
  readonly stage: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly status: 'agreed' | 'contested' | 'abandoned';
  /** Frame de fin (`MatchResult.endFrame`), ou `null` sans résultat accepté. */
  readonly endFrame: number | null;
  readonly players: readonly {
    readonly accountId: string;
    readonly name: string;
    readonly guest: boolean;
    readonly fighter: string;
    readonly result: PlayerResult | null;
    /** Frame de départ annoncée par le relais si le joueur est parti sans revenir, sinon `null`. */
    readonly leftAtFrame: number | null;
  }[];
  /** Places classées premières ; vide sans résultat accepté. */
  readonly winners: readonly number[];
}

export interface MatchTracker {
  readonly matchId: string;
  readonly gameId: string;
  readonly kind: RoomKind;
  readonly region: string;
  readonly config: MatchConfig;
  readonly stage: string;
  readonly startedAt: number;
  /** Une entrée par place. */
  readonly players: readonly MatchPlayerInfo[];
  /** Déclarations par place. */
  readonly declarations: Map<number, DeclaredResult>;
  firstDeclarationAt: number;
  desynced: boolean;
  /** Par place : frame de départ du relais si le joueur est absent, sinon `null`. */
  readonly leftAt: (number | null)[];
}

export function createTracker(init: {
  matchId: string;
  gameId: string;
  kind: RoomKind;
  region: string;
  config: MatchConfig;
  stage: string;
  startedAt: number;
  players: readonly MatchPlayerInfo[];
}): MatchTracker {
  return {
    ...init,
    declarations: new Map(),
    firstDeclarationAt: Number.NaN,
    desynced: false,
    leftAt: init.players.map(() => null),
  };
}

/** Enregistre la déclaration d'un compte. Une seule par place ; forme cohérente avec la partie. */
export function declare(
  t: MatchTracker,
  accountId: string,
  result: DeclaredResult,
  now: number,
): Outcome {
  const slot = t.players.findIndex((p) => p.id === accountId);
  if (slot < 0) return { ok: false, code: 'not_in_match', message: 'Vous ne jouez pas ce match.' };
  if (t.declarations.has(slot)) {
    return { ok: false, code: 'bad_request', message: 'Résultat déjà déclaré.' };
  }
  if (result.players.length !== t.players.length) {
    return { ok: false, code: 'bad_request', message: 'Nombre de joueurs incohérent.' };
  }
  if (t.config.teams && result.players.some((p, i) => p.team !== t.config.players[i]!.team)) {
    return { ok: false, code: 'bad_request', message: 'Équipes incohérentes.' };
  }
  t.declarations.set(slot, result);
  if (Number.isNaN(t.firstDeclarationAt)) t.firstDeclarationAt = now;
  return { ok: true };
}

export type Settlement =
  | { readonly status: 'agreed'; readonly result: DeclaredResult }
  | { readonly status: 'contested'; readonly message: string }
  | null;

/** Où en est la concordance ; `null` : il faut encore attendre. */
export function settle(t: MatchTracker, now: number, timeoutMs: number): Settlement {
  if (t.desynced) {
    return { status: 'contested', message: 'Les écrans des joueurs se sont désynchronisés.' };
  }
  let reference: string | null = null;
  let result: DeclaredResult | null = null;
  for (const r of t.declarations.values()) {
    // Déclarations construites champ par champ dans le même ordre : le JSON suffit à comparer.
    const s = JSON.stringify(r);
    if (reference === null) {
      reference = s;
      result = r;
    } else if (s !== reference) {
      return { status: 'contested', message: 'Les joueurs ne déclarent pas le même résultat.' };
    }
  }
  if (result === null) return null;
  let missing = 0;
  for (let slot = 0; slot < t.players.length; slot++) {
    if (t.leftAt[slot] === null && !t.declarations.has(slot)) missing++;
  }
  if (missing === 0) return { status: 'agreed', result };
  if (now - t.firstDeclarationAt >= timeoutMs) {
    return { status: 'contested', message: 'Tous les joueurs n’ont pas déclaré le résultat.' };
  }
  return null;
}

/** Enregistrement transmis au classement. */
export function buildRecord(
  t: MatchTracker,
  status: MatchRecord['status'],
  result: DeclaredResult | null,
  endedAt: number,
): MatchRecord {
  const accepted = status === 'agreed' ? result : null;
  return {
    matchId: t.matchId,
    ranked: t.kind === 'quick',
    gameId: t.gameId,
    kind: t.kind,
    region: t.region,
    config: t.config,
    stage: t.stage,
    startedAt: t.startedAt,
    endedAt,
    status,
    endFrame: accepted?.endFrame ?? null,
    players: t.players.map((p, slot) => ({
      accountId: p.id,
      name: p.name,
      guest: p.guest,
      fighter: p.fighter,
      result: accepted?.players[slot] ?? null,
      leftAtFrame: t.leftAt[slot] ?? null,
    })),
    winners: accepted?.winners ?? [],
  };
}
