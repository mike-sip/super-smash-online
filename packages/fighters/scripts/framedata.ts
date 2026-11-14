/**
 * Régénère FRAMEDATA.md à partir des données du roster.
 *
 *   pnpm --filter @game/fighters framedata
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROSTER, frameDataMarkdown } from '../src/index.ts';

const path = fileURLToPath(new URL('../FRAMEDATA.md', import.meta.url));
writeFileSync(path, frameDataMarkdown(ROSTER));
console.log(`FRAMEDATA.md régénéré : ${ROSTER.length} personnage(s).`);
