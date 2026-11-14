/**
 * Régénère golden.json : `pnpm --filter @game/match-rules golden:update`.
 * À ne lancer que pour un changement de comportement voulu, dans un commit dédié et expliqué.
 */
import { writeFileSync } from 'node:fs';
import { REFERENCE_CASES, runReference } from './harness.ts';

const golden = REFERENCE_CASES.map((c) => {
  const outcome = runReference(c);
  console.log(
    `${c.name} : checksum ${outcome.checksum}, ${outcome.phase}, ` +
      `${outcome.reason ?? 'en cours'} à la frame ${outcome.endFrame}, gagnants ${outcome.winners.join(', ')}`,
  );
  return { name: c.name, ...outcome };
});
writeFileSync(new URL('./golden.json', import.meta.url), JSON.stringify(golden, null, 2) + '\n');
