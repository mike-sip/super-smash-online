# Tâches : module `app-shell`

> Statut : **VALIDÉ le 2026-11-17**. Plan : [plan.md](plan.md).
>
> Vérification commune à chaque tâche : `pnpm lint` et `pnpm typecheck` passent ; `pnpm --filter @game/lobby test` à partir de T1 ; `pnpm --filter @game/app test` à partir de T3 ; les tests d'Edge de l'application à partir de T6 ; tests existants de la démo et de la démo en ligne passants et inchangés.

## Phase A — Résultats classés

- [x] **T1 : Expéditeur des rapports**
  - Acceptation : `createRankingReporter` (spec, « API publique ») ; seuls les `agreed` partent ; rapport par `reportFromResult` ; en-tête par `signReport` ; `201`/`200` : fini ; réseau, `5xx`, 5 s sans réponse : nouvel essai (1, 2, 4… s, 60 s au plus, 24 h au plus), même `matchId`, `reportedAt` neuf ; `400`/`401`/`403`/`409` : abandon journalisé ; file bornée à 1 000 ; `close()` ; journaux sans pseudo ni identifiant de compte.
  - Vérification : tests à horloge et `fetch` factices : filtre du statut, contenu du rapport, signature vérifiée par `verifyReportSignature`, renvois, abandon, file pleine, arrêt.
  - Fichiers : `packages/lobby/src/ranking-report.ts`, `packages/lobby/test/ranking-report.test.ts`, `packages/lobby/package.json` (dépendance `@game/ranking`), `pnpm-lock.yaml`

- [x] **T2 : Branchement et bout en bout réel**
  - Acceptation : `config.ts` lit `RANKING_URL`, `RANKING_REPORT_SECRETS` (ensemble ou pas du tout), `RELAY_MAX_GAMES` ; `main.ts` branche l'expéditeur sur `onMatchResult` et le ferme à l'arrêt ; `/health` donne connexions, parties, rapports en attente ; `SPEC-lobby.md` mis à jour (écart « envoi branché »).
  - Vérification : tests de configuration ; `test/e2e/ranking.test.ts` : vrais serveurs, deux inscrits en partie rapide (Temps 30 s), cotes 1016/984 (ou égalité), historique et compteurs, doublon `duplicate`, salon privé non classé, serveur des comptes arrêté puis relancé pendant l'envoi.
  - Fichiers : `packages/lobby/src/config.ts`, `packages/lobby/src/main.ts`, `packages/lobby/src/server.ts`, `packages/lobby/test/config.test.ts`, `packages/lobby/test/e2e/ranking.test.ts`, `SPEC-lobby.md`

**Point de contrôle A** : compte rendu du bout en bout ; on continue sauf objection.

## Phase B — L'application s'ouvre

- [x] **T3 : Paquet `@game/app`**
  - Acceptation : `apps/game` (Vite, alias vers les sources comme la démo), `index.html` sans script en ligne, `dev-plugin.ts` (comptes + classement en mémoire avec `submitMatch` direct, serveur de jeu avec le vrai contenu), configuration « game » dans `.claude/launch.json`, palette et typographie dans `style.css`, prise de test derrière une variable de build.
  - Vérification : `pnpm --filter @game/app dev` répond ; test de contraste de la palette (4,5:1) ; typecheck.
  - Fichiers : `apps/game/package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/main.ts`, `src/style.css`, `src/palette.ts`, `dev-plugin.ts`, `test/palette.test.ts`, `.claude/launch.json`, `pnpm-lock.yaml`

- [x] **T4 : Écrans, navigation, manette des menus (purs)**
  - Acceptation : pile d'écrans (`push`, `replace`, `back` avec confirmation, `reset`) ; `nextFocus` par direction ; lecteur de manette des menus (croix, stick avec zone morte et répétition, A, B, Start, disposition non standard).
  - Vérification : tests unitaires de chaque cas de la stratégie de test.
  - Fichiers : `apps/game/src/screens.ts`, `src/nav.ts`, `src/menu-pad.ts`, `test/screens.test.ts`, `test/nav.test.ts`, `test/menu-pad.test.ts`

- [x] **T5 : Réglages, contenu, erreurs (purs)**
  - Acceptation : réglages son et affichage (défauts, bornes, lecture tolérante, version) ; `buildSimConfig` pour tout personnage, stage, mode et objets ; noms et descriptions ; `describeError` pour chaque code des clients des comptes, du lobby, du relais et du classement ; textes dans `strings.ts`.
  - Vérification : tests unitaires ; même entrée ⇒ même `checksum` de simulation après 600 frames ; aucun code d'erreur connu sans message.
  - Fichiers : `apps/game/src/settings.ts`, `src/content.ts`, `src/errors.ts`, `src/strings.ts`, `test/settings.test.ts`, `test/content.test.ts`, `test/errors.test.ts`

- [x] **T6 : Titre, menu principal, composants**
  - Acceptation : application (`app.ts`) avec services partagés et boucle d'images ; composants (bouton, liste, interrupteur, curseur, bandeau, dialogue) ; écran titre (nom, « Appuyez sur une touche », musique après le premier geste) ; menu principal ; crédits ; navigation clavier, manette et souris branchée ; région `aria-live` ; écran d'erreur inattendue.
  - Vérification : Edge : titre → menu → crédits → retour au clavier seul, puis avec une fausse manette ; noms accessibles ; focus visible ; aucune erreur de console.
  - Fichiers : `apps/game/src/app.ts`, `src/ui/*.ts` (composants, title, main-menu, credits, error), `test/helpers.ts`, `test/e2e/menus.test.ts`

**Point de contrôle B** : vous pouvez ouvrir le jeu et naviguer.

## Phase C — On joue en local

- [x] **T7 : Moteur de combat local**
  - Acceptation : boucle à pas fixe, personnages stylés, son, HUD de match, pause (reprendre, recommencer, quitter), fin vers les résultats ; entraînement sans fin avec mannequins (immobiles, sauteurs, bouclier, aléatoires pour la mesure) ; scène de fond derrière les menus, coupée en « mouvements réduits ».
  - Vérification : Edge : match court jusqu'à la fin par la prise de test ; pause qui arrête la simulation ; non-ingérence du rendu (empreinte avant et après dessin).
  - Fichiers : `apps/game/src/local-match.ts`, `src/background.ts`, `src/ui/pause.ts`, `test/e2e/local.test.ts`

- [x] **T8 : Sélection locale, stage, règles, entraînement, résultats**
  - Acceptation : rejoindre par périphérique (2 à 4) ; une carte par joueur (personnage, équipe, prêt) commandée par son périphérique ; stage (aperçu, description, dangers) ; règles avec préréglages et validation par `match-rules` ; entraînement ; résultats (revanche, changer, menu) ; derniers réglages gardés.
  - Vérification : Edge : combat à deux (clavier et fausse manette) jusqu'aux résultats puis revanche ; chaque mode ; règles refusées affichées ; entraînement à 7 mannequins.
  - Fichiers : `apps/game/src/ui/local-setup.ts`, `src/ui/stage-select.ts`, `src/ui/rules.ts`, `src/ui/training.ts`, `src/ui/results.ts`, `src/local-setup.ts` (état pur), `test/local-setup.test.ts`, `test/e2e/local.test.ts`

- [ ] **T9 : Options**
  - Acceptation : commandes (remappage clavier et manette par `captureNext`/`setBindings`, refus affichés, analogique, saut au stick, réinitialiser) ; son ; affichage (plein écran, résolution de rendu, grand texte, mouvements réduits, compteur d'images).
  - Vérification : Edge : une touche remappée sert en combat et survit au rechargement ; son coupé ; grand texte sans débordement ; stockage corrompu ignoré.
  - Fichiers : `apps/game/src/ui/options-*.ts`, `test/e2e/options.test.ts`

**Point de contrôle C** : essai manette en main bienvenu.

## Phase D — On joue en ligne

- [ ] **T10 : Connexion et accueil en ligne**
  - Acceptation : invité automatique ; connexion, inscription, conversion d'invité (messages de validation d'`accounts`) ; accueil (salon privé, rejoindre, partie rapide) ; bandeau d'état du lobby (connexion, reconnexion, hors ligne) ; lien `#rejoindre=CODE`.
  - Vérification : Edge : invité puis conversion ; mauvais mot de passe affiché ; serveur des comptes absent : message et « Réessayer ».
  - Fichiers : `apps/game/src/online.ts`, `src/ui/auth.ts`, `src/ui/online-home.ts`, `src/ui/banner.ts`, `test/e2e/online.test.ts`

- [ ] **T11 : Salon privé, partie rapide, match en ligne**
  - Acceptation : salon (code, copie, lien, membres, sélection, prêt, règles et stage de l'hôte, expulsion, verrou, motifs de refus de lancement) ; file (attente, annulation, refus) ; match en ligne (netcode, déclaration sur état confirmé, joueurs partis et revenus, désync, « Quitter la partie ? ») ; résultats et retour au salon ; rechargement en pleine partie.
  - Vérification : Edge à deux onglets : salon par code et par lien, match jusqu'au bout, mêmes résultats, retour au salon ; partie rapide ; rechargement ; serveur de jeu arrêté puis relancé.
  - Fichiers : `apps/game/src/online-match.ts`, `src/ui/room.ts`, `src/ui/queue.ts`, `test/e2e/online.test.ts`

- [ ] **T12 : Profil, historique, classement, compte**
  - Acceptation : profil (cote ou provisoire, rang, statistiques par personnage) ; historique paginé ; classement paginé avec ma position ; changement de pseudo et de mot de passe, déconnexion, suppression confirmée.
  - Vérification : Edge : après une partie rapide entre inscrits, cote et historique à jour dans les deux onglets ; suppression de compte.
  - Fichiers : `apps/game/src/ui/profile.ts`, `src/ui/leaderboard.ts`, `src/ui/account.ts`, `test/e2e/profile.test.ts`

**Point de contrôle D** : vous pouvez faire le parcours en ligne dans deux onglets.

## Phase E — Prêt pour la production

- [ ] **T13 : Build de production et parcours complet**
  - Acceptation : `vite build` sans prise de test, sans clé de développement, sans carte des sources ; `deploy/routes.ts` (routes et en-têtes) ; `deploy/gateway.ts` ; `serve:prod` (comptes + classement et jeu en vrais processus, SQLite dans un dossier temporaire, passerelle) ; `test:e2e` qui lance tout cela.
  - Vérification : test du contenu du build ; parcours de l'objectif dans Edge sur le build de production (titre, local, deux onglets en partie rapide, résultats, profil à jour), au clavier seul, sans erreur de console.
  - Fichiers : `apps/game/vite.config.ts`, `deploy/routes.ts`, `deploy/gateway.ts`, `apps/game/scripts/serve-prod.ts`, `apps/game/test/build.test.ts`, `apps/game/test/e2e/journey.test.ts`

- [ ] **T14 : Performance**
  - Acceptation : mesure dans Edge sur l'écran de combat de l'application (8 combattants, objets, son) et sur les menus au-dessus de la scène de fond ; taille du client compressé consignée.
  - Vérification : seuils de `render` tenus ; menus à 95 % sous 16,7 ms.
  - Fichiers : `apps/game/test/perf/perf.test.ts`, `apps/game/vitest.perf.config.ts`

- [ ] **T15 : Déploiement**
  - Acceptation : `Dockerfile` (plusieurs étapes, non root, lecture seule sauf `data/`), `docker-compose.yml` (frontal, comptes, jeu, santé, redémarrage, journaux bornés), `Caddyfile` (TLS, routes, en-têtes, route des rapports et santé bloquées depuis l'extérieur), `.env.example`, `generate-secrets.ts`, `backup.ts` (`VACUUM INTO`), heure ISO dans les journaux des serveurs, `DEPLOIEMENT.md`.
  - Vérification : test qui compare le `Caddyfile` à `routes.ts` ; `generate-secrets.ts` et `backup.ts` essayés en local ; relecture des fichiers Docker (non construits : pas de Docker ici).
  - Fichiers : `deploy/*`, `DEPLOIEMENT.md`, `apps/game/test/deploy.test.ts`

**Point de contrôle E** : vous relisez `DEPLOIEMENT.md` ; on décide ensemble de l'hébergeur et du moment.

## Phase F — Bilan

- [ ] **T16 : Relecture de sécurité, bilan, carte**
  - Acceptation : relecture des serveurs assemblés, du frontal, du client et des scripts consignée dans la spec, constats corrigés avec un test ou expliqués ; bilan des critères de succès ; ligne « Specs existantes » et état d'`app-shell` mis à jour dans `CAPABILITY-MAP.md`.
  - Vérification : `pnpm test`, `pnpm typecheck`, `pnpm lint`, bancs, perf de la démo et de l'application, tests d'Edge des trois applications passants.
  - Fichiers : `SPEC-app-shell.md`, `CAPABILITY-MAP.md`
