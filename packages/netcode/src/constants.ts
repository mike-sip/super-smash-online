/**
 * Réglages par défaut du netcode, validés avec la spec (SPEC-netcode.md, « Décisions prises à la
 * validation »). Les changer demande un accord explicite.
 */

/** Durée d'une frame de simulation, en millisecondes (60 Hz). */
export const FRAME_MS = 1000 / 60;

/** Délai d'input `D` : l'input lu à la frame `n` s'applique à la frame `n + D`. */
export const DEFAULT_INPUT_DELAY = 2;
/** Fenêtre de prédiction `P` : frames simulées au plus au-delà de la frontière confirmée. */
export const DEFAULT_MAX_PREDICTION = 15;
/** Tolérance `G` du serveur : retard, en frames, au-delà duquel il remplace un input. */
export const DEFAULT_LATE_TOLERANCE = 8;
/** Une empreinte d'état confirmé est échangée toutes les `n` frames. */
export const DEFAULT_CHECKSUM_INTERVAL = 15;

/** Bornes acceptées par le protocole. */
export const MAX_INPUT_DELAY = 8;
export const MAX_PREDICTION_LIMIT = 30;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const MAX_LOCAL_PLAYERS = 4;

/**
 * Capacité, en frames, des anneaux d'historique des inputs. Puissance de deux. Elle doit couvrir
 * la fenêtre de prédiction, le délai d'input et la redondance des envois, avec de la marge.
 */
export const HISTORY_FRAMES = 128;
/** Frames d'inputs au plus par joueur et par message (redondance jusqu'à accusé). */
export const MAX_FRAMES_PER_MESSAGE = 32;

/** Délai entre l'arrivée du dernier joueur et le départ de la partie. */
export const START_DELAY_MS = 2000;
/** Rattrapage : frames simulées au plus par appel à `update` (onglet resté masqué). */
export const MAX_CATCH_UP_FRAMES = 240;
