import tseslint from 'typescript-eslint';

/** API dont le résultat peut différer d'un moteur JavaScript ou d'une exécution à l'autre. */
const NON_DETERMINISTIC_MATH = [
  'random',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'pow',
  'exp',
  'log',
  'log2',
  'log10',
  'hypot',
  'cbrt',
  'sinh',
  'cosh',
  'tanh',
];

export default tseslint.config(
  { ignores: ['**/dist/**', '**/dist-e2e/**', '**/coverage/**', '**/node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    // La simulation doit être reproductible au bit près : voir SPEC-sim-core.md, « Limites ».
    // Même exigence pour les règles de match, qui tournent dans `step` (SPEC-match-rules.md).
    files: ['packages/sim-core/src/**/*.ts', 'packages/match-rules/src/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...NON_DETERMINISTIC_MATH.map((property) => ({
          object: 'Math',
          property,
          message: 'Non déterministe entre moteurs : utiliser fixed.ts.',
        })),
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: "La simulation ne lit pas l'horloge." },
        { name: 'performance', message: "La simulation ne lit pas l'horloge." },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "BinaryExpression[operator='**']", message: 'Utiliser fixed.ts.' },
      ],
    },
  },
);
