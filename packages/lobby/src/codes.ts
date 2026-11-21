/**
 * Codes de salon (SPEC-lobby.md, « Salons privés ») : 6 caractères dans un alphabet de 30
 * symboles sans ambiguïté, soit 729 millions de codes. Le tirage reçoit sa source d'aléa
 * (`crypto.randomInt` côté serveur) : ce fichier n'importe rien et sert aussi au navigateur.
 */

/** Ni `0`/`O`, ni `1`/`I`/`L`, ni `U`. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export const CODE_LENGTH = 6;

/** Tire un code ; `random(max)` renvoie un entier uniforme dans `[0, max)`. */
export function drawCode(random: (max: number) => number): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[random(CODE_ALPHABET.length)];
  return code;
}

/** Code saisi par un joueur (minuscules, espaces et tirets tolérés), ou `null` s'il est invalide. */
export function normalizeCode(input: string): string | null {
  if (typeof input !== 'string' || input.length > 32) return null;
  const code = input.replace(/[\s-]/g, '').toUpperCase();
  if (code.length !== CODE_LENGTH) return null;
  for (const c of code) if (!CODE_ALPHABET.includes(c)) return null;
  return code;
}

/** `ABCDEF` → `ABC-DEF`, plus facile à dicter. */
export function formatCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}
