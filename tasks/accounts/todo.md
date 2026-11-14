# Tâches : module `accounts`

> Statut : **VALIDÉ le 2026-11-13**. Plan : [plan.md](plan.md).
>
> Vérification commune à chaque tâche : `pnpm --filter @game/accounts test`, `pnpm --filter @game/accounts typecheck` et `pnpm lint` passent ; à partir de T9, `pnpm --filter @game/accounts-client test` aussi ; à partir de T10, `pnpm --filter @game/demo test` aussi.

## Phase A — Règles

- [x] **T1 : Paquet, protocole, pseudos et mots de passe**
  - Acceptation : paquet `@game/accounts` dans le monorepo avec ses trois points d'entrée (`.`, `./protocol`, `./ticket`) ; types `AccountView`, `ErrorCode` et corps des requêtes ; `validatePseudo` : normalisation NFKC, bords retirés, 3 à 16 caractères, lettres latines accentuées, chiffres, `_` et `-`, première lettre, pas deux séparateurs de suite, clé d'unicité sans casse ni accents, mots interdits trouvés même déguisés ; `validatePassword` : 8 à 128 caractères, différent du pseudo, absent de la liste des mots de passe courants ; aucun import Node dans ces fichiers.
  - Vérification : tests unitaires de chaque règle et de chaque raison de refus, dont `Élodie`/`elodie` même clé, `4dm1n` refusé, `Invité-1` refusé pour un compte.
  - Fichiers : `packages/accounts/package.json`, `packages/accounts/tsconfig.json`, `packages/accounts/tsconfig.build.json`, `packages/accounts/vitest.config.ts`, `packages/accounts/src/protocol.ts`, `packages/accounts/src/names.ts`, `packages/accounts/src/passwords.ts`, `packages/accounts/src/wordlists.ts`, `packages/accounts/test/names.test.ts`, `packages/accounts/test/passwords.test.ts`

- [x] **T2 : Hachage, jetons de session et tickets**
  - Acceptation : `hashPassword`/`verifyPassword` avec scrypt, format `scrypt$15$8$3$<sel>$<empreinte>`, comparaison en temps constant ; détection d'une empreinte aux paramètres périmés ; plafond de calculs simultanés avec file courte puis refus « occupé » ; empreinte factice pour les pseudos inconnus ; jetons de session de 32 octets et leur empreinte SHA-256 ; `signTicket`/`verifyTicket` : format `v1.<charge>.<signature>`, durée 60 s, tolérance de 5 s, audience, rotation des clés, jamais d'exception ; `ticket.ts` n'importe que `node:crypto`.
  - Vérification : tests unitaires (aller-retour, mauvais mot de passe, empreinte mal formée, paramètres périmés, plafond ; ticket valide, expiré, falsifié sur la charge ou la signature, mauvaise audience, clé ancienne acceptée, clé inconnue refusée, textes mal formés) ; test que les paramètres par défaut sont ceux de production.
  - Fichiers : `packages/accounts/src/hashing.ts`, `packages/accounts/src/tokens.ts`, `packages/accounts/src/ticket.ts`, `packages/accounts/test/hashing.test.ts`, `packages/accounts/test/tokens.test.ts`, `packages/accounts/test/ticket.test.ts`

- [x] **T3 : Limitation des tentatives**
  - Acceptation : interface `RateLimiter` et implémentation en mémoire par seaux à jetons, horloge injectée ; réponse « refusé » avec le délai d'attente en secondes ; seaux inactifs oubliés (aucune croissance illimitée de la mémoire) ; règles de la spec : 20 tentatives d'authentification par minute et par adresse, 30 invités par heure et par adresse, 10 échecs de connexion par quart d'heure et par pseudo.
  - Vérification : tests unitaires avec horloge factice (épuisement, remplissage, délai annoncé, oubli des seaux, clés indépendantes).
  - Fichiers : `packages/accounts/src/rate-limit.ts`, `packages/accounts/test/rate-limit.test.ts`

**Point de contrôle A** : relecture humaine des règles ; vous complétez la liste des mots interdits si vous le souhaitez.

## Phase B — Métier

- [x] **T4 : Interface de stockage, stockage mémoire et suite de contrat**
  - Acceptation : interface `AccountStore` (comptes, sessions, purge, suppression en cascade) et types des enregistrements ; stockage mémoire ; suite de contrat réutilisable : création, unicité de la clé (y compris entre invités et comptes selon la spec), conversion, mise à jour du profil, sessions (création, recherche par empreinte, prolongation, suppression, plafond), purge des sessions expirées et des invités inactifs, suppression en cascade, statistiques.
  - Vérification : suite de contrat sur le stockage mémoire.
  - Fichiers : `packages/accounts/src/store.ts`, `packages/accounts/src/store-memory.ts`, `packages/accounts/test/store-contract.ts`, `packages/accounts/test/store-memory.test.ts`

- [x] **T5 : Stockage SQLite**
  - Acceptation : `openSqliteStore(path)` avec `node:sqlite`, mode WAL, clés étrangères actives, index unique sur la clé de pseudo des comptes, migrations numérotées par `PRAGMA user_version` ; requêtes préparées uniquement ; fermeture propre.
  - Vérification : suite de contrat sur SQLite en mémoire et sur fichier ; réouverture d'une base existante sans perte ; migration d'une base vide ; contrainte d'unicité tenue par la base même sans vérification préalable.
  - Fichiers : `packages/accounts/src/store-sqlite.ts`, `packages/accounts/test/store-sqlite.test.ts`

- [x] **T6 : Règles métier**
  - Acceptation : `AccountService` : invité (pseudo tiré au hasard ou choisi, jamais celui d'un compte), inscription, conversion (même identifiant, profil gardé, nouveau jeton), connexion (même échec et même travail pour pseudo inconnu et mauvais mot de passe, rehachage des empreintes périmées, invité courant effacé), déconnexion (invité effacé), profil (pseudo, personnage favori au format de la spec), changement de mot de passe (autres sessions fermées), suppression (mot de passe exigé pour un compte, écouteurs `onAccountDeleted` appelés), tickets, `recordMatch` ; sessions de 30 jours prolongées au plus une fois par heure, 10 au plus par compte ; purge périodique.
  - Vérification : tests avec stockage mémoire et horloge factice pour chaque parcours et chaque refus.
  - Fichiers : `packages/accounts/src/service.ts`, `packages/accounts/test/service.test.ts`

**Point de contrôle B** : relecture humaine ; le métier est prouvé sans réseau.

## Phase C — Serveur

- [x] **T7 : Serveur HTTP et parcours de bout en bout**
  - Acceptation : `createAccountsServer` avec `node:http` ; routes de la spec sous `/api/accounts/v1` ; cookie de session (`HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` et préfixe `__Host-` si `secureCookies`) ; réponses JSON et erreurs au format de la spec ; `Cache-Control: no-store` partout ; `GET /session` à 200 sans session ; `service` exposé ; journal d'une ligne par requête sans donnée sensible.
  - Vérification : tests de bout en bout sur un vrai serveur et `fetch` avec un petit pot à cookies : invité → rechargement → conversion → déconnexion → connexion → profil → mot de passe → suppression ; ticket obtenu par l'API et accepté par `verifyTicket`.
  - Fichiers : `packages/accounts/src/http.ts`, `packages/accounts/src/index.ts`, `packages/accounts/test/helpers.ts`, `packages/accounts/test/api.test.ts`

- [x] **T8 : Protections HTTP, configuration et commandes**
  - Acceptation : `Content-Type: application/json` exigé hors `GET` ; `Origin` vérifiée quand elle est présente ; corps limité à 8 Ko ; JSON invalide ou champs inattendus refusés ; en-têtes `X-Content-Type-Options`, `Content-Security-Policy`, `Referrer-Policy`, `X-Frame-Options` ; limitation des tentatives branchée avec `Retry-After` ; `X-Forwarded-For` lu seulement avec `trustProxy` ; 404 et 405 ; erreur interne sans détail ; configuration lue de l'environnement, refus de démarrer sans clé de ticket ou avec une clé trop courte ; `main.ts` avec purge périodique et arrêt propre ; commandes `dev` et `start`.
  - Vérification : un test de bout en bout par protection ; test de la lecture de configuration ; lancement réel de `pnpm --filter @game/accounts dev` et requêtes à la main, consignés.
  - Fichiers : `packages/accounts/src/http.ts`, `packages/accounts/src/config.ts`, `packages/accounts/src/main.ts`, `packages/accounts/package.json`, `packages/accounts/test/api-security.test.ts`, `packages/accounts/test/config.test.ts`, `.gitignore`

**Point de contrôle C** : relecture humaine ; vous pouvez lancer le serveur et l'interroger.

## Phase D — Client et démo

- [x] **T9 : Client navigateur**
  - Acceptation : paquet `@game/accounts-client` ; `createAccountsClient` conforme à la spec ; résultats sans exception, `network` quand le serveur est injoignable ou répond autre chose que du JSON ; messages d'erreur en français ; `retryAfter` lu ; validations réexportées pour vérifier avant l'envoi.
  - Vérification : tests du client contre un vrai serveur (chaque méthode) et contre un serveur éteint.
  - Fichiers : `packages/accounts-client/package.json`, `packages/accounts-client/tsconfig.json`, `packages/accounts-client/tsconfig.build.json`, `packages/accounts-client/vitest.config.ts`, `packages/accounts-client/src/index.ts`, `packages/accounts-client/test/client.test.ts`

- [ ] **T10 : Panneau Compte de la démo**
  - Acceptation : bouton « Compte » dans la barre d'outils (raccourci libre, non pris par le jeu) ; panneau : état (non connecté, invité, compte), jouer en invité, connexion, inscription, conversion d'un invité, personnage favori, déconnexion, suppression avec confirmation ; erreurs affichées en français ; avertissement « pas de récupération de mot de passe » à l'inscription ; serveur des comptes contacté seulement à l'ouverture du panneau ; sans serveur, message clair et jeu intact ; relais `/api/accounts` vers le serveur des comptes dans la configuration de Vite.
  - Vérification : tests de fumée existants inchangés et passants ; nouveaux tests dans Edge avec un vrai serveur des comptes lancé par le test (invité, conversion, déconnexion, connexion) et sans serveur (message, jeu qui tourne).
  - Fichiers : `apps/demo/package.json`, `apps/demo/vite.config.ts`, `apps/demo/index.html`, `apps/demo/src/account.ts`, `apps/demo/src/controls.ts`, `apps/demo/src/main.ts`, `apps/demo/test/account.test.ts`

**Point de contrôle D** : vous essayez le panneau Compte dans la démo.

## Phase E — Relu

- [ ] **T11 : Relecture de sécurité et bilan**
  - Acceptation : relecture de sécurité de tout le module (authentification, sessions, requêtes intersites, injections, énumération, déni de service, journaux, données personnelles), constats corrigés ou expliqués et consignés dans la spec ; bilan des dix critères de succès, chacun marqué vérifié automatiquement, vérifié à la main ou non vérifié ; note de branchement laissée à `netcode` mise à jour.
  - Vérification : tous les tests, typecheck et lint du dépôt passent ; compte rendu des critères.
  - Fichiers : `SPEC-accounts.md`, `tasks/accounts/todo.md`

**Point de contrôle E** : relecture humaine, module terminé. Suite : modules `lobby` et `ranking`, branchement du ticket dans le relais de `netcode`.
