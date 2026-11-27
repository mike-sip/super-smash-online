/**
 * Reprise en ligne après un rechargement de page. À part du reste du jeu en ligne, chargé à la
 * demande (`online-entry.ts`) : le démarrage n'a besoin que de cet indicateur.
 */
const RESUME_KEY = 'fracas.resume-online';

/** Vrai si la page a été rechargée pendant que le joueur était dans un salon (ou une partie). */
export function shouldResumeOnline(): boolean {
  try {
    return sessionStorage.getItem(RESUME_KEY) === '1';
  } catch {
    return false;
  }
}

/** Retient que le joueur est dans un salon (ou n'y est plus). */
export function rememberRoom(inRoom: boolean): void {
  try {
    if (inRoom) sessionStorage.setItem(RESUME_KEY, '1');
    else sessionStorage.removeItem(RESUME_KEY);
  } catch {
    // Sans stockage de session : pas de reprise automatique après un rechargement.
  }
}
