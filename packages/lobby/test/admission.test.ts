import { signTicket } from '@game/accounts/ticket';
import { describe, expect, it } from 'vitest';
import { lobbyTicketVerifier, relayAuthenticator } from '../src/admission.ts';

const SECRET = 'cle-de-test-de-trente-deux-caracteres-au-moins';
const NOW = 1_800_000_000_000;

function sign(aud: string, now = NOW) {
  return signTicket({ sub: 'u-1', name: 'Élodie', guest: true, aud }, { secret: SECRET, now })
    .ticket;
}

describe('admission', () => {
  it('lobby : accepte un ticket « lobby » et rend l’identité', () => {
    const verify = lobbyTicketVerifier({ secrets: [SECRET], now: () => NOW });
    expect(verify(sign('lobby'))).toMatchObject({ id: 'u-1', name: 'Élodie', guest: true });
  });

  it('lobby : refuse une autre audience, une clé inconnue, un ticket expiré ou falsifié', () => {
    const verify = lobbyTicketVerifier({ secrets: [SECRET], now: () => NOW });
    expect(verify(sign('relay'))).toBeNull();
    expect(
      lobbyTicketVerifier({ secrets: ['x'.repeat(40)], now: () => NOW })(sign('lobby')),
    ).toBeNull();
    expect(verify(sign('lobby', NOW - 120_000))).toBeNull();
    expect(verify(sign('lobby').slice(0, -2) + 'AA')).toBeNull();
    expect(verify('')).toBeNull();
  });

  it('relais : accepte un ticket « relay » une seule fois', () => {
    const auth = relayAuthenticator({ secrets: [SECRET], now: () => NOW });
    const ticket = sign('relay');
    expect(auth(ticket)).toEqual({ id: 'u-1' });
    expect(auth(ticket)).toBeNull();
    expect(auth(sign('lobby'))).toBeNull();
  });
});
