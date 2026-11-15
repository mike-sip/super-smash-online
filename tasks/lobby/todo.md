# Tâches : module `lobby`

> Statut : **VALIDÉ le 2026-11-15**. Plan : [plan.md](plan.md).
>
> Vérification commune à chaque tâche : `pnpm --filter @game/netcode test` et `pnpm --filter @game/netcode typecheck` passent (tests existants inchangés) ; à partir de T3, `pnpm --filter @game/lobby test` et `pnpm --filter @game/lobby typecheck` aussi ; à partir de T12, `pnpm --filter @game/lobby test:e2e` ; à partir de T13, `pnpm --filter @game/online test` ; et toujours `pnpm lint`.

## Phase A — Relais authentifié (`netcode`)

- [x] **T1 : Mode réservé du relais**
  - Acceptation : `RelayOptions.authenticate(ticket)` ; avec elle, un `HELLO` doit porter un ticket accepté, viser une partie réservée par `Relay.reserve(gameId, { seats, expiresInMs })` et venir d'un compte qui y a une place ; il reçoit sa place réservée (et non la première libre) ; refus par `ERR_AUTH` (nouveau code) et fermeture ; réservation expirée sans tous les joueurs : partie fermée, connectés prévenus ; `Relay.cancel(gameId, reason)` ; `RelayOptions.onGameEvent` (`started`, `left`, `closed`) ; un même compte ne peut pas ouvrir deux connexions dans une partie ; sans `authenticate`, comportement inchangé.
  - Vérification : tests du relais pour chaque refus et chaque événement, places imposées dans un ordre d'arrivée quelconque, expiration et annulation ; tous les tests existants de `netcode` inchangés.
  - Fichiers : `packages/netcode/src/server/relay.ts`, `packages/netcode/src/server/index.ts`, `packages/netcode/src/protocol.ts`, `packages/netcode/test/relay-reserved.test.ts`

- [x] **T2 : Reconnexion en pleine partie**
  - Acceptation : en mode réservé, historique complet des inputs confirmés par blocs de 4 096 frames, libéré à la fermeture ; `HELLO` d'un compte dont les places sont absentes dans une partie commencée : accepté, `START` d'origine renvoyé, historique transmis depuis la frame `D` par fenêtres à chaque pas du relais ; message `REJOINED` (place, frame de reprise) à tous ; événement `rejoined` ; le client rattrape une partie commencée sans afficher les frames intermédiaires ; ses inputs comptent à partir de la frame de reprise.
  - Vérification : bout en bout simulé : 4 clients, l'un coupé à 1 min puis revenu à 5 min, rattrape en moins de 20 s de temps simulé, toutes les empreintes égales à la rejoue hors ligne du journal du relais, aucune désync ; deux départs et retours successifs ; revenant après la fin de partie refusé ; mesure de la mémoire de l'historique.
  - Fichiers : `packages/netcode/src/server/relay.ts`, `packages/netcode/src/protocol.ts`, `packages/netcode/src/client.ts`, éventuellement `packages/netcode/src/rollback.ts`, `packages/netcode/test/match.ts` (options ajoutées, sans changer les existantes), `packages/netcode/test/session-rejoin.test.ts`, `packages/netcode/test/protocol.test.ts` (cas ajoutés), `SPEC-netcode.md` (section « Écarts »)

**Point de contrôle A** : vous voyez le compte rendu (débit de rattrapage mesuré, mémoire) ; si le rattrapage ne tient pas le critère, on en parle avant la suite.

## Phase B — Règles du lobby

- [x] **T3 : Paquet, protocole et codes**
  - Acceptation : paquet `@game/lobby` (points d'entrée `.`, `./client`, `./protocol`), résolu comme `accounts` ; types de tous les messages de la spec ; `parseClientMessage` / `parseServerMessage` : JSON, taille, type, champs connus seulement, bornes, sans exception ; codes : tirage par une source d'aléa injectée dans l'alphabet de 30 symboles, normalisation de la saisie, affichage `ABC-DEF` ; aucun import Node dans `protocol.ts`, `codes.ts` (hors tirage injecté) et `client.ts`.
  - Vérification : chaque message accepté et chaque refus (champ inconnu, type faux, borne) ; 10 000 entrées aléatoires ou tronquées sans exception ; codes : alphabet, longueur, normalisation (minuscules, tirets, espaces), refus des caractères exclus ; test de frontières d'imports.
  - Fichiers : `packages/lobby/package.json`, `packages/lobby/tsconfig.json`, `packages/lobby/tsconfig.build.json`, `packages/lobby/vitest.config.ts`, `packages/lobby/src/protocol.ts`, `packages/lobby/src/codes.ts`, `packages/lobby/test/protocol.test.ts`, `packages/lobby/test/codes.test.ts`, `packages/lobby/test/boundaries.test.ts`, `pnpm-lock.yaml`

- [x] **T4 : Limites**
  - Acceptation : seaux à jetons à horloge injectée (débit par connexion, créations, codes faux par minute et par heure, entrées en file), compteur de connexions par adresse (IPv6 par /64, IPv4 vues en IPv6 ramenées), mémoire des `jti` vus (70 s), oubli des seaux inactifs.
  - Vérification : tests unitaires avec horloge factice (épuisement, remplissage, oubli, clés d'adresse, jti rejoué puis oublié).
  - Fichiers : `packages/lobby/src/limits.ts`, `packages/lobby/test/limits.test.ts`

- [ ] **T5 : Règles d'un salon**
  - Acceptation : salon privé et salon rapide ; arrivée (capacité, verrou, expulsé refusé, équipe la moins remplie), départ, passation d'hôte au plus ancien connecté, personnage (liste ou `random`), équipe, prêt, règles et stage par l'hôte avec `validateMatchConfig` et remise à zéro des « prêt », capacité jamais sous le nombre de membres, expulsion hors partie, conditions de lancement, construction de la `MatchConfig` finale et tirage des `random`, instantané `room`.
  - Vérification : un test par règle et par refus.
  - Fichiers : `packages/lobby/src/room.ts`, `packages/lobby/test/room.test.ts`

- [ ] **T6 : File d'attente**
  - Acceptation : file par région ; région inconnue refusée ; aller-retour au-delà du seuil refusé ; groupe de 4 tout de suite, ou tous (au moins 2) quand le plus ancien attend depuis 20 s ; ordre d'arrivée ; sortie de file.
  - Vérification : tests unitaires avec horloge factice.
  - Fichiers : `packages/lobby/src/matchmaking.ts`, `packages/lobby/test/matchmaking.test.ts`

- [ ] **T7 : Concordance des résultats**
  - Acceptation : validation d'une déclaration (forme, nombre de places, bornes) ; une par membre de la partie ; `agreed` si toutes les déclarations des clients encore connectés au relais sont identiques et sans désync signalée ; `contested` sinon, ou après 15 s sans toutes les déclarations ; `abandoned` ; construction du `MatchRecord` (`matchId`, `ranked`, `leftAtFrame`, résultats par place).
  - Vérification : unanime, désaccord, désync, intrus, doublon, déclaration mal formée, délai écoulé, joueur parti puis revenu (`leftAtFrame` à `null`).
  - Fichiers : `packages/lobby/src/results.ts`, `packages/lobby/test/results.test.ts`

**Point de contrôle B** : relecture des règles si vous le souhaitez.

## Phase C — Service et client, simulés

- [ ] **T8 : Service — identité, connexions, salons**
  - Acceptation : `createLobby` ; `hello` dans les 5 s avec ticket vérifié (fonction injectée) et rejeu refusé ; connexion remplacée (`bye replaced`) qui reprend la place ; ping/pong et aller-retour ; messages invalides (trois de suite : fermeture), débit, connexions par adresse, plafonds ; création, arrivée par code, départ, sélection, règles, prêt, expulsion, verrou ; délai de grâce de 30 s puis départ ; passation d'hôte ; salon vide supprimé ; instantané envoyé à chaque changement ; silence de 30 s.
  - Vérification : tests du service avec connexions factices et horloge virtuelle, un par parcours et par protection.
  - Fichiers : `packages/lobby/src/service.ts`, `packages/lobby/src/index.ts`, `packages/lobby/test/service.test.ts`, `packages/lobby/test/fakes.ts`

- [ ] **T9 : Service — lancement, partie, fin, partie rapide**
  - Acceptation : compte à rebours ; réservation dans le relais puis `matchStart` à chacun ; annulation si une place n'est pas prise en 20 s (message, retour au salon) ; phase « partie » ; reconnexion au lobby pendant la partie (`matchStart` renvoyé) ; événements du relais (`left`, `rejoined`, `closed`) ; déclarations et concordance ; abandon (tous partis, durée maximale) ; fermeture de la partie au relais, retour au salon, « prêt » remis à zéro, dernier résultat gardé ; `onMatchResult` ; partie rapide : file, salon rapide, lancement automatique, revanche quand tous sont prêts.
  - Vérification : tests du service avec un vrai relais en mode réservé (sans réseau) et horloge virtuelle.
  - Fichiers : `packages/lobby/src/service.ts`, `packages/lobby/test/service-match.test.ts`

- [ ] **T10 : Client du lobby**
  - Acceptation : `createLobbyClient` : `hello` avec ticket frais, état observable, commandes, `onMatchStart`, reconnexion automatique (0,5 à 8 s, nouveau ticket), `matchStart` réémis au retour, jamais d'exception ; fonctionne avec le `WebSocket` du navigateur, de Node et un transport injecté (tests).
  - Vérification : client contre le service sur des connexions en mémoire : parcours, coupure et reprise, refus affichés, serveur fermé.
  - Fichiers : `packages/lobby/src/client.ts`, `packages/lobby/test/client.test.ts`

- [ ] **T11 : Bout en bout simulé**
  - Acceptation : harnais : tickets signés par `signTicket`/`verifyTicket` de `accounts` (tests), lobby, relais réservé et clients complets (client du lobby, client `netcode`, simulation par `createMatchSimConfig` avec le contenu de test de `sim-core`, joueurs simulés, déclaration du résultat sur état confirmé) sur le réseau simulé de `netcode`.
  - Vérification : salon privé à 8 de bout en bout avec revanche ; partie rapide à 4 ; un membre coupé 10 s dans le salon ; une page « rechargée » en pleine partie qui revient et finit synchronisée ; l'hôte qui part ; un joueur qui ne rejoint pas le relais ; tout le monde qui quitte la partie (abandon) ; `onMatchResult` conforme à `matchResult` ; empreintes identiques.
  - Fichiers : `packages/lobby/test/harness.ts`, `packages/lobby/test/e2e-simulated.test.ts`

**Point de contrôle C** : compte rendu des scénarios simulés.

## Phase D — Réel

- [ ] **T12 : Hôte, serveur complet et bout en bout réel**
  - Acceptation : `admission.ts` (`verifyTicket` audience `relay` + rejeu) ; `host.ts` (`/lobby` sur `ws`, adresse du client, `trustProxy`, taille maximale, silence) ; `createGameServer` (HTTP, lobby, relais réservé, pas des minuteries) ; `config.ts` (variables d'environnement, refus sans clé ni contenu) ; `main.ts`, `dev.ts` (port 8788, clé « dev ») ; scripts `start`, `dev`, `test:e2e`.
  - Vérification : vrai serveur des comptes et vrai serveur de jeu sur des ports libres, 3 clients Node (`AccountsClient` avec cookies, client du lobby, client `netcode`) : créer, rejoindre, choisir, lancer, finir un match en mode Temps de 30 s, revenir au salon ; refus d'un ticket d'une autre audience sur les deux points d'entrée ; message texte trop gros ou invalide sur vrai WebSocket ; configuration (tests unitaires).
  - Fichiers : `packages/lobby/src/admission.ts`, `packages/lobby/src/host.ts`, `packages/lobby/src/server.ts`, `packages/lobby/src/config.ts`, `packages/lobby/src/main.ts`, `packages/lobby/src/dev.ts`, `packages/lobby/vitest.e2e.config.ts`, `packages/lobby/test/config.test.ts`, `packages/lobby/test/e2e/real.test.ts`

- [ ] **T13 : Démo en ligne**
  - Acceptation : greffon Vite qui attache lobby et relais réservé au serveur de développement et démarre un serveur des comptes en mémoire (ou relaie vers `ACCOUNTS_URL`) ; invité créé à l'ouverture si besoin ; écrans minimaux : menu (créer, rejoindre par code, partie rapide), salon (membres, code, personnage, équipe, prêt, règles et stage pour l'hôte, expulsion, verrou, dernier résultat), partie (match-rules, HUD de match, diagnostic existant), résultats puis retour au salon ; reprise après rechargement ; registre de contenu ; `textContent` seulement ; l'ancien formulaire par identifiant retiré ; prise de test.
  - Vérification : test Playwright dans Edge à trois contextes : création, code, arrivée des deux autres, choix, règles (Temps, 30 s), lancement, une page rechargée en pleine partie qui revient, fin, mêmes résultats, retour au salon, aucune erreur de console ; le test « deux onglets » existant réécrit pour passer par le lobby ; capture d'écran vérifiée à la main.
  - Fichiers : `apps/online/package.json`, `apps/online/vite.config.ts`, `apps/online/index.html`, `apps/online/src/main.ts`, `apps/online/src/lobby-ui.ts`, `apps/online/src/match.ts`, `apps/online/src/content.ts`, `apps/online/src/dev-plugin.ts`, `apps/online/src/relay-plugin.ts` (supprimé), `apps/online/test/two-tabs.test.ts`, `apps/online/test/lobby.test.ts`, `pnpm-lock.yaml`

**Point de contrôle D** : votre essai de la démo en ligne (plusieurs onglets ou deux machines).

## Phase E — Bilan

- [ ] **T14 : Relecture de sécurité et bilan**
  - Acceptation : relecture de tout le module et des changements du relais (authentification, rejeu, autorisation par rôle et par phase, validation, déni de service, journaux, données personnelles, DOM) ; constats corrigés avec un test chacun, ou expliqués ; section « Relecture de sécurité » et « Bilan des critères de succès » en fin de spec, avec ce qui n'a été vérifié qu'à la main ; « Écarts » de `SPEC-netcode.md` à jour ; note pour `ranking` et `app-shell` dans le dossier partagé.
  - Vérification : tests, typecheck et lint de `lobby`, `netcode`, `accounts`, `match-rules`, `online` et de la démo locale passants.
  - Fichiers : `SPEC-lobby.md`, `SPEC-netcode.md`, corrections éventuelles
