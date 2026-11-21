/**
 * Point d'entrée du jeu en ligne et du profil, chargé à la demande par `main.ts` : comptes,
 * salons, netcode et classement ne pèsent pas sur le premier chargement du jeu.
 */
import type { App } from './app.ts';
import { Online } from './online.ts';
import { openOnline } from './ui/online.ts';
import { openProfile } from './ui/profile.ts';

let online: Online | null = null;

function getOnline(app: App): Online {
  if (online === null) {
    online = new Online(app);
    const o = online;
    o.openProfile = () => openProfile(app, o);
  }
  return online;
}

/** Accueil en ligne ; `invite` : code d'un lien d'invitation à rejoindre directement. */
export function openOnlineSection(app: App, invite?: string): void {
  openOnline(app, getOnline(app), invite);
}

export function openProfileSection(app: App): void {
  openProfile(app, getOnline(app));
}
