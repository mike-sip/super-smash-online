import { describe, expect, it } from 'vitest';
import { REPORT_SCHEME, signReport, verifyReportSignature } from '../src/report.ts';

const SECRET = 'cle-de-test-des-rapports-0000000000000000';
const OTHER = 'autre-cle-de-test-des-rapports-00000000000';
const BODY = '{"version":1,"matchId":"00000000-0000-4000-8000-000000000001"}';

describe('signReport', () => {
  it('produit « Report v1.<hmac base64url> », stable pour un même corps', () => {
    const header = signReport(BODY, SECRET);
    expect(header).toMatch(/^Report v1\.[A-Za-z0-9_-]{43}$/);
    expect(header.startsWith(`${REPORT_SCHEME} `)).toBe(true);
    expect(signReport(BODY, SECRET)).toBe(header);
    expect(signReport(BODY, OTHER)).not.toBe(header);
  });

  it('refuse une clé trop courte', () => {
    expect(() => signReport(BODY, 'courte')).toThrow();
  });
});

describe('verifyReportSignature', () => {
  const header = signReport(BODY, SECRET);

  it('accepte la bonne signature', () => {
    expect(verifyReportSignature(header, BODY, [SECRET])).toBe(true);
  });

  it('accepte une ancienne clé encore listée (rotation)', () => {
    expect(verifyReportSignature(header, BODY, [OTHER, SECRET])).toBe(true);
  });

  it('refuse une autre clé, un corps modifié d’un octet, une signature modifiée', () => {
    expect(verifyReportSignature(header, BODY, [OTHER])).toBe(false);
    expect(verifyReportSignature(header, BODY.replace('1"}', '2"}'), [SECRET])).toBe(false);
    expect(verifyReportSignature(`${header.slice(0, -1)}A`, BODY, [SECRET])).toBe(
      header.endsWith('A'),
    );
    expect(verifyReportSignature(header, `${BODY} `, [SECRET])).toBe(false);
  });

  it('accepte le corps en octets comme en texte', () => {
    expect(verifyReportSignature(header, new TextEncoder().encode(BODY), [SECRET])).toBe(true);
  });

  it('refuse sans lever les en-têtes absents ou mal formés et les entrées inattendues', () => {
    const bad: unknown[] = [
      undefined,
      null,
      42,
      '',
      'Report',
      'Report v1.',
      'Bearer v1.abc',
      header.replace('v1.', 'v2.'),
      header.toLowerCase(),
      `${header}=`,
      `${header} extra`,
      `Report v1.${'A'.repeat(500)}`,
      ['Report', 'v1.x'],
      { toString: () => header },
    ];
    for (const value of bad) {
      expect(verifyReportSignature(value, BODY, [SECRET])).toBe(false);
    }
    expect(verifyReportSignature(header, 12 as unknown as string, [SECRET])).toBe(false);
    expect(verifyReportSignature(header, BODY, [])).toBe(false);
    expect(verifyReportSignature(header, BODY, [''])).toBe(false);
  });
});
