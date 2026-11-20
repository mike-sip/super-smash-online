import { it } from 'vitest';
import { runDuel } from './harness.ts';

it.skipIf(process.env.CPU_DIAG !== '1')('diagnostic', () => {
  const rows: string[] = [];
  const fighter = (process.env.CPU_FIGHTER ?? 'sorel') as string;
  const pairs = (process.env.CPU_PAIRS ?? '9-1').split(',').map((p) => p.split('-').map(Number));
  for (const [a, b] of pairs) {
    let wins = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const r = runDuel({ fighters: [fighter, fighter], levels: [a!, b!], seed });
      const res = r.result;
      if (res?.winners.length === 1 && res.winners[0] === 0) wins++;
      rows.push(
        `L${a} vs L${b} s${seed}: f${r.frames} win ${res?.winners.join(',')} ` +
          `falls ${res?.players.map((p) => p.falls).join('/')} sd ${r.selfDestructs.join('/')} ` +
          `dmg ${res?.players.map((p) => Math.round(p.damageDealt)).join('/')}`,
      );
    }
    rows.push(`== L${a} vs L${b}: ${wins}/8`);
  }
  console.log(rows.join('\n'));
});
