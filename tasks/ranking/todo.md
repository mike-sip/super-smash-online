# Tâches : module `ranking`

> Statut : **VALIDÉ le 2026-11-15**. Plan : [plan.md](plan.md).
>
> Vérification commune à chaque tâche : `pnpm --filter @game/ranking test`, `pnpm --filter @game/ranking typecheck` et `pnpm lint` passent ; à partir de T7, `pnpm --filter @game/accounts test` et son typecheck aussi ; à partir de T10, `pnpm --filter @game/demo test` et son typecheck aussi.

## Phase A — Règles

- [x] **T1 : Paquet, protocole et validation des rapports**
  - Acceptation : paquet `@game/ranking` (points d'entrée `.`, `./protocol`, `./report`, `./client`) ; types `MatchReport`, `ReportedPlayer`, réponses et codes d'erreur ; `validateReport` : champs exacts, 2 à 8 joueurs, UUID, comptes distincts, places cohérentes (une place 1 au moins, ex æquo, même place pour toute une équipe), `leftAtFrame` borné, compteurs bornés, liste des problèmes ; `reportFromResult` depuis un `MatchResult` ; aucun import Node dans `protocol.ts`.
  - Vérification : tests de chaque refus et d'un rapport construit par `reportFromResult` puis validé.
  - Fichiers : `packages/ranking/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts}`, `src/protocol.ts`, `test/protocol.test.ts`

- [x] **T2 : Formule de la cote**
  - Acceptation : `computeRatingChanges` : unités (joueur ou équipe à cote moyenne), règle d'abandon (partant seul et dernier, plus tôt = derrière), `S`, `E`, `D` = nombre moyen d'adversaires, `K = 32` ; invités exclus en amont ; `roundPreservingSum` au plus fort reste, ex æquo par identifiant ; « non classé » s'il reste moins de 2 unités.
  - Vérification : cas connus de la spec (2 joueurs égaux ±16, écart de 400, égalité, 8 joueurs +16 … −16, 8 joueurs avec ex æquo, 2 contre 2, 3 contre 1, 4 équipes de 2, abandons seul/multiples/en équipes) ; propriétés sur 10 000 matchs aléatoires (somme nulle par match, total = 1000 × classés, monotonie à cotes égales, partant jamais gagnant).
  - Fichiers : `src/rating.ts`, `test/rating.test.ts`, `test/rating-properties.test.ts`

- [x] **T3 : Signature des rapports**
  - Acceptation : `signReport(body, secret)` → `Report v1.<hmac base64url>` ; `verifyReportSignature(header, body, secrets)` : plusieurs clés, temps constant, jamais d'exception, longueur bornée ; `report.ts` n'importe que `node:crypto`.
  - Vérification : valide, falsifiée, autre clé, clé tournée, corps modifié d'un octet, en-tête mal formé ou absent, entrées non chaînes ; test de dépendances du fichier.
  - Fichiers : `src/report.ts`, `test/report.test.ts`, `test/boundaries.test.ts`

**Point de contrôle A** : relecture des cas connus de la formule.

## Phase B — Métier

- [x] **T4 : Interface de stockage, mémoire et suite de contrat**
  - Acceptation : `RankingStore` : `recordMatch` atomique (match, participants, cotes, statistiques par joueur et par personnage) ; lecture d'un match par `matchId` (empreinte et variations) ; cotes de plusieurs comptes ; classement paginé et rang d'un compte ; profil ; historique par curseur ; participants non synchronisés et marquage ; suppression d'un compte (données effacées, participations anonymisées) ; liste des comptes connus pour le balayage.
  - Vérification : suite de contrat sur la mémoire, dont un échec au milieu de `recordMatch` qui ne laisse rien.
  - Fichiers : `src/store.ts`, `src/store-memory.ts`, `test/store-contract.ts`, `test/store-memory.test.ts`

- [x] **T5 : Stockage SQLite**
  - Acceptation : `openRankingSqliteStore(path)`, WAL, `secure_delete`, migrations par `PRAGMA user_version`, transactions, requêtes préparées.
  - Vérification : suite de contrat sur SQLite en mémoire et sur fichier ; réouverture sans perte.
  - Fichiers : `src/store-sqlite.ts`, `test/store-sqlite.test.ts`

- [x] **T6 : Règles métier**
  - Acceptation : `RankingService` : `submitMatch` (validation, empreinte du JSON canonique, doublon → `duplicate`, contenu différent → `conflict`, file d'une soumission à la fois, invités = report ou `accounts`, compte inconnu traité en invité, classé seulement si `ranked` et 2 unités inscrites, somme nulle vérifiée avant écriture) ; synchronisation des compteurs d'`accounts` après la transaction et reprise ; lectures (classement avec pseudos actuels, profil, historique avec noms) ; `onAccountDeleted` et balayage des comptes disparus ; `getRating`.
  - Vérification : tests avec `AccountService` réel sur stockage mémoire et horloge factice : doublon en série et simultané, conflit, privé non classé, invités, abandon, synchronisation qui échoue puis reprend, suppression et balayage.
  - Fichiers : `src/service.ts`, `test/service.test.ts`, `test/helpers.ts`

**Point de contrôle B** : métier prouvé sans réseau.

## Phase C — Serveur

- [x] **T7 : Point d'extension dans `accounts`**
  - Acceptation : `AccountsConfig.extensions?: HttpExtension[]` ; `http.ts` passe à l'extension toute requête dont le chemin commence par son préfixe, avec `address`, `auth()` et les en-têtes de sécurité ; `AccountService.publicNames(ids)` ; aucun comportement existant modifié.
  - Vérification : nouveaux tests dans `accounts` (routage par préfixe, routes existantes intactes, `auth()` avec et sans cookie, erreur d'une extension → 500 générique, `publicNames`) ; suite d'`accounts` entière inchangée.
  - Fichiers : `packages/accounts/src/{index.ts,http.ts,service.ts}`, `packages/accounts/test/extensions.test.ts`

- [x] **T8 : Routes HTTP, `createRanking`, commandes**
  - Acceptation : routes de la spec ; `POST /matches` : en-tête `Origin` ou `Sec-Fetch-Site` refusé, corps borné (32 Ko), signature vérifiée avant lecture, `reportedAt` à ±5 min ; `GET /leaderboard`, `GET /me` (`profile: null` sans session), `GET /me/matches` ; `createRanking` ; `main.ts` (comptes + classement, `RANKING_DB`, `RANKING_REPORT_SECRETS`), `dev.ts` (clés de dev), `seed.ts`.
  - Vérification : tests de bout en bout sur un vrai serveur (chaque protection, doublon, conflit, session, client avec cookie qui ne peut pas soumettre) ; lancement à la main de `dev` puis `seed` et `curl`.
  - Fichiers : `src/{http.ts,index.ts,main.ts,dev.ts,seed.ts,config.ts}`, `test/api.test.ts`

**Point de contrôle C** : serveur lançable et semé.

## Phase D — Démo

- [x] **T9 : Client navigateur**
  - Acceptation : `createRankingClient` : `leaderboard`, `me`, `myMatches`, résultats sans exception, erreur `network` si le serveur est absent.
  - Vérification : client contre un vrai serveur ; serveur éteint.
  - Fichiers : `src/client.ts`, `test/client.test.ts`

- [x] **T10 : Panneau Classement de la démo**
  - Acceptation : bouton « Classement » et une touche libre ; tableau (rang, pseudo, cote, matchs), ma cote (ou « provisoire », ou « invité : non classé »), mon historique (date, mode, place, personnage, Δ) ; texte par `textContent` seulement ; message clair sans serveur ; relais `/api/ranking` dans Vite.
  - Vérification : test Playwright dans Edge avec un vrai serveur semé ; sans serveur, démo jouable ; tests existants inchangés ; capture dans le navigateur intégré.
  - Fichiers : `apps/demo/src/leaderboard.ts`, `apps/demo/src/main.ts`, `apps/demo/index.html` (si besoin), `apps/demo/vite.config.ts`, `apps/demo/package.json`, `apps/demo/test/leaderboard.test.ts`

**Point de contrôle D** : visible dans la démo.

## Phase E — Fin

- [x] **T11 : Relecture, bilan, note à `lobby`**
  - Acceptation : relecture de sécurité (origine des rapports, idempotence, injections, données exposées, journaux) consignée dans la spec ; écarts constatés ; bilan des critères de succès ; note du dossier partagé mise à jour.
  - Fichiers : `SPEC-ranking.md`, note partagée
