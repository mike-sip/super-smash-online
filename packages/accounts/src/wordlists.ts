/**
 * Listes de mots : pseudos interdits et mots de passe trop courants. Données seules, sans logique.
 *
 * Les mots sont écrits sous forme de clé : minuscules, sans accent, sans séparateur. La liste des
 * pseudos interdits est volontairement courte (voir SPEC-accounts.md) ; complétez-la ici.
 */

/**
 * Interdits n'importe où dans le pseudo. Seulement des mots assez longs pour ne pas apparaître
 * par hasard dans un nom ordinaire (« con » est dans « Constance » : il va dans `FORBIDDEN_WHOLE`).
 */
export const FORBIDDEN_ANYWHERE: readonly string[] = [
  // Rôles qu'un joueur ne doit pas pouvoir usurper.
  'admin',
  'moderat',
  'support',
  'systeme',
  'system',
  'officiel',
  'official',
  'staff',
  // Insultes et haine, en français et en anglais.
  'connard',
  'connasse',
  'salope',
  'encule',
  'putain',
  'batard',
  'bougnoul',
  'negre',
  'nazi',
  'hitler',
  'pedophile',
  'nigger',
  'nigga',
  'faggot',
  'fuck',
  'bitch',
  'whore',
];

/** Interdits au début du pseudo : préfixes réservés (les invités s'appellent « Invité-… »). */
export const FORBIDDEN_PREFIX: readonly string[] = ['invite', 'guest', 'modo'];

/**
 * Interdits comme pseudo entier, chiffres finaux mis à part (« con », « Con_123 ») : mots trop
 * courts pour être cherchés à l'intérieur d'un nom.
 */
export const FORBIDDEN_WHOLE: readonly string[] = [
  'con',
  'pute',
  'pd',
  'cunt',
  'pedo',
  'negro',
  'retard',
  'root',
  'owner',
  'mod',
  'gm',
  'anonymous',
  'anonyme',
];

/**
 * Mots de passe parmi les plus utilisés, d'au moins 8 caractères (les plus courts sont déjà
 * refusés par la longueur). Comparés sans tenir compte de la casse.
 */
export const COMMON_PASSWORDS: readonly string[] = [
  '12345678',
  '123456789',
  '1234567890',
  '0123456789',
  '11111111',
  '00000000',
  '12341234',
  '87654321',
  '11223344',
  '12121212',
  '123123123',
  '1q2w3e4r',
  '1qaz2wsx',
  'qwertyuiop',
  'azertyuiop',
  'qwerty123',
  'azerty123',
  'azertyui',
  'qwertyui',
  'password',
  'password1',
  'password12',
  'password123',
  'passw0rd',
  'p@ssw0rd',
  'motdepasse',
  'motdepasse1',
  'motdepasse123',
  'iloveyou',
  'jetaime1',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'superman',
  'starwars',
  'whatever',
  'trustno1',
  'letmein1',
  'welcome1',
  'abc12345',
  'abcd1234',
  'aaaaaaaa',
  'zzzzzzzz',
  'doudou123',
  'soleil123',
  'chouchou',
  'bienvenue',
  'nicolas1',
  'marseille',
  'portugal',
  'liverpool',
  'chocolat',
  'dragon123',
  'pokemon1',
  'minecraft',
  'fortnite',
];
