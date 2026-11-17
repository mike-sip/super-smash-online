/**
 * Valide les données de tous les personnages du roster et liste les problèmes.
 *
 *   pnpm --filter @game/fighters validate
 */
import { ROSTER, formatIssue, validateCharacter } from '../src/index.ts';

let problems = 0;
for (const c of ROSTER) {
  const issues = validateCharacter(c);
  problems += issues.length;
  console.log(
    issues.length === 0 ? `ok      ${c.name}` : `ÉCHEC   ${c.name} : ${issues.length} problème(s)`,
  );
  for (const issue of issues) console.log(`        ${formatIssue(issue)}`);
}
if (ROSTER.length === 0) console.log('Aucun personnage dans le roster.');
process.exitCode = problems === 0 ? 0 : 1;
