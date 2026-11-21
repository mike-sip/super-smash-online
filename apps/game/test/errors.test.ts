import { describe, expect, it } from 'vitest';
import {
  UNEXPECTED,
  accountsProblem,
  lobbyProblem,
  lobbyStatusBanner,
  matchEndNote,
  rankingProblem,
  relayProblem,
} from '../src/errors.ts';

const ACCOUNTS_CODES = [
  'network',
  'bad_request',
  'unsupported_media_type',
  'payload_too_large',
  'forbidden_origin',
  'not_found',
  'method_not_allowed',
  'unauthenticated',
  'not_a_guest',
  'guest_not_allowed',
  'invalid_pseudo',
  'pseudo_taken',
  'invalid_password',
  'invalid_credentials',
  'invalid_fighter',
  'invalid_audience',
  'rate_limited',
  'server_busy',
  'internal',
];

const LOBBY_CODES = [
  'network',
  'replaced',
  'bad_request',
  'version',
  'unauthenticated',
  'ticket',
  'rate_limited',
  'server_full',
  'not_found',
  'full',
  'locked',
  'banned',
  'already_in_room',
  'not_in_room',
  'not_host',
  'wrong_phase',
  'not_ready',
  'invalid_rules',
  'invalid_fighter',
  'invalid_stage',
  'invalid_region',
  'high_latency',
  'not_in_match',
] as const;

describe('erreurs visibles', () => {
  const SERVER_WORDED = ['invalid_pseudo', 'pseudo_taken', 'invalid_password'];
  it.each(ACCOUNTS_CODES.filter((c) => !SERVER_WORDED.includes(c)))(
    'comptes, %s : message français, jamais le texte technique du serveur',
    (code) => {
      const p = accountsProblem({ code, message: 'internal: stack trace' });
      expect(p.message.length).toBeGreaterThan(5);
      expect(p.message).not.toMatch(/stack|internal:/);
      expect(p.actions.length).toBeGreaterThan(0);
    },
  );

  it('comptes : réseau → réessayer ; session expirée → se connecter', () => {
    expect(accountsProblem({ code: 'network', message: '' }).actions).toContain('retry');
    expect(accountsProblem({ code: 'unauthenticated', message: '' }).actions).toContain('login');
  });

  it('comptes : le message de validation du serveur est repris tel quel', () => {
    const msg = 'Le pseudo doit faire de 3 à 16 caractères.';
    expect(accountsProblem({ code: 'invalid_pseudo', message: msg }).message).toBe(msg);
  });

  it('comptes : code inconnu → message générique', () => {
    expect(accountsProblem({ code: 'nouveau', message: 'x' }).actions).toContain('retry');
  });

  it.each(LOBBY_CODES)('lobby, %s : message et issue', (code) => {
    const p = lobbyProblem({ code, message: '' });
    expect(p.message.length).toBeGreaterThan(5);
    expect(p.actions.length).toBeGreaterThan(0);
  });

  it('lobby : onglet remplacé → recharger ; règles refusées → message du serveur', () => {
    expect(lobbyProblem({ code: 'replaced', message: '' }).actions).toContain('reload');
    expect(
      lobbyProblem({ code: 'invalid_rules', message: 'Temps : de 30 à 3600 s.' }).message,
    ).toBe('Temps : de 30 à 3600 s.');
  });

  it('bandeau du lobby : connexion, reconnexion, hors ligne, rien en ligne', () => {
    expect(lobbyStatusBanner('online', true)).toBeNull();
    expect(lobbyStatusBanner('closed', true)).toBeNull();
    expect(lobbyStatusBanner('connecting', false)!.message).toMatch(/Connexion/);
    expect(lobbyStatusBanner('connecting', true)!.message).toMatch(/Reconnexion/);
    expect(lobbyStatusBanner('offline', true)!.severity).toBe('error');
  });

  it('relais, fins de match, classement, imprévu', () => {
    expect(relayProblem('Ticket refusé.').message).toContain('Ticket refusé.');
    expect(relayProblem(null).actions).toEqual(['menu']);
    expect(matchEndNote('agreed')).toBeNull();
    for (const s of ['contested', 'abandoned', 'cancelled'] as const) {
      expect(matchEndNote(s)!.length).toBeGreaterThan(10);
    }
    expect(rankingProblem({ code: 'network' }).actions).toContain('retry');
    expect(rankingProblem({ code: 'unauthenticated' }).actions).toContain('login');
    expect(UNEXPECTED.actions).toEqual(['reload']);
  });
});
