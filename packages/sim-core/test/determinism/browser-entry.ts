/** Point d'entrée empaqueté et injecté dans la page du navigateur par `browser.test.ts`. */
import { REFERENCE_CASES, runCase } from './cases.ts';

(globalThis as { __runReferenceCases?: () => number[] }).__runReferenceCases = () =>
  REFERENCE_CASES.map((c) => runCase(c).checksum);
