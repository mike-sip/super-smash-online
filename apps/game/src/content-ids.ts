/**
 * Identifiants du contenu proposé en ligne, partagés par le serveur de jeu (greffon de
 * développement, configuration de production) et la page. Un test vérifie qu'ils sont exactement
 * ceux de `fighters` et `stages-items`.
 */
export const CONTENT_IDS = {
  fighters: ['sorel', 'zephine', 'ferroc', 'nacre'],
  stages: ['belvedere', 'recif', 'canal', 'geysers'],
} as const;
