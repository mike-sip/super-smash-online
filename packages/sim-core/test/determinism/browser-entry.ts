/** Point d'entrée empaqueté et injecté dans la page du navigateur par `browser.test.ts`. */
import { CASES, runCase } from './cases.ts';

(globalThis as { __runDeterminismCases?: () => number[] }).__runDeterminismCases = () =>
  CASES.map((c) => runCase(c).checksum);
