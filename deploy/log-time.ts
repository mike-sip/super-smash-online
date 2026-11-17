/**
 * Préchargé par les serveurs en production (`NODE_OPTIONS=--import …/log-time.ts`) : chaque ligne
 * de journal commence par l'heure ISO. Les modules ne journalisent déjà ni pseudo, ni ticket, ni
 * mot de passe, ni adresse IP ; ce fichier n'ajoute que l'heure.
 */
for (const level of ['log', 'info', 'warn', 'error'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]): void => {
    const first = args[0];
    // Déjà horodatée (serveur de jeu) : inchangée.
    if (typeof first === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(first)) original(...args);
    else original(new Date().toISOString(), ...args);
  };
}
export {};
