/**
 * Recalcule les checksums de référence. À lancer uniquement quand un changement de comportement
 * est voulu, et à commiter seul, avec l'explication du changement (SPEC-sim-core.md, « Toujours »).
 *
 *   pnpm --filter @game/sim-core golden:update
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REFERENCE_CASES, runCase } from './cases.ts';

const golden = REFERENCE_CASES.map((c) => {
  const stats = runCase(c);
  return { ...c, checksum: stats.checksum, hits: stats.hits, kos: stats.kos };
});

const path = fileURLToPath(new URL('./golden.json', import.meta.url));
writeFileSync(path, JSON.stringify(golden, null, 2) + '\n');
for (const g of golden) {
  console.log(`graine ${g.seed} : checksum ${g.checksum}, ${g.hits} coups, ${g.kos} KO`);
}
