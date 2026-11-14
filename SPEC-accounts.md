# Spec : `accounts` — invités, comptes, sessions et profils

> Statut : **APPROUVÉE le 2026-11-13**. Plan : [tasks/accounts/plan.md](tasks/accounts/plan.md), tâches : [tasks/accounts/todo.md](tasks/accounts/todo.md). Module de la [carte des capacités](CAPABILITY-MAP.md). Dépend de : rien. Sera utilisé par `lobby`, `ranking` (pas encore faits), le relais de `netcode` (par la vérification de ticket) et `app-shell`.

## Hypothèses

1. **Premier serveur du projet.** Aucun serveur n'existe encore. Celui-ci est un processus Node.js autonome, sans framework ni dépendance ajoutée : `node:http` pour le HTTP, `node:sqlite` pour le stockage, `node:crypto` pour scrypt, les jetons et les signatures. Node 24+ exécute directement le TypeScript (types effacés), comme le banc de `input` le fait déjà.
2. **Même origine que le jeu.** En production, un proxy inverse sert le jeu et l'API des comptes sous le même domaine (`/api/accounts/…`). En développement, le serveur de Vite de la démo fait ce relais. Le cookie de session reste donc sur un seul site, et le serveur n'a pas besoin de CORS.
3. **Une seule région, un seul processus.** Hébergement en Europe, un seul serveur des comptes : un fichier SQLite suffit, et la limitation des tentatives vit en mémoire. Les deux restent derrière une interface, pour passer plus tard à une base partagée et à plusieurs instances.
4. **Les autres serveurs ne lisent pas la base des comptes.** Le relais de `netcode` (et plus tard `lobby` et `ranking` s'ils tournent à part) authentifie un joueur par un **ticket** : un jeton court, signé par le serveur des comptes, vérifiable localement avec une fonction de quelques lignes et une clé partagée. Pas d'appel réseau à chaque connexion.
5. **Le pseudo est public.** Il s'affiche en jeu et dans les salons ; révéler qu'un pseudo est déjà pris à l'inscription est donc accepté. En revanche, la connexion ne dit jamais si c'est le pseudo ou le mot de passe qui est faux.
6. **Aucune donnée personnelle inutile.** Ni email, ni adresse IP, ni navigateur enregistrés en base. Les adresses IP ne servent qu'à la limitation des tentatives, en mémoire, et sont oubliées après quelques minutes.

## Objectif

Permettre à quelqu'un de jouer tout de suite sous un pseudo temporaire, puis de garder son identité en créant un compte par pseudo et mot de passe, sans email ; et donner aux autres serveurs un moyen sûr et simple de savoir qui se connecte.

**Utilisateurs** : les joueurs (par la démo aujourd'hui, par `app-shell` demain) ; le relais de `netcode`, qui vérifie les tickets ; `lobby` et `ranking`, qui s'appuieront sur l'identifiant de compte et, pour `ranking`, rempliront les statistiques du profil.

**Succès** : un joueur clique « Jouer en invité » et a un pseudo ; il crée ensuite un compte sans rien perdre ; il se reconnecte depuis un autre navigateur ; il peut tout supprimer. Une base volée ne livre ni mot de passe ni session utilisable ; un robot ne peut pas essayer des mots de passe à la chaîne.

### Périmètre fonctionnel

| Domaine | Inclus dans ce module |
|---|---|
| Invité | Session immédiate sans mot de passe, pseudo tiré au hasard ou choisi par le joueur, effacée après 30 jours sans visite |
| Inscription | Pseudo et mot de passe, sans email ; pseudo unique sans tenir compte de la casse ni des accents |
| Conversion | Un invité devient un compte : même identifiant, profil conservé |
| Connexion | Par pseudo et mot de passe ; déconnexion ; changement de mot de passe, qui ferme les autres sessions |
| Profil | Pseudo affiché (modifiable), personnage favori, statistiques (lues ici, écrites plus tard par `ranking`) |
| Suppression | Effacement immédiat et définitif du compte, de son profil et de ses sessions, après confirmation par le mot de passe |
| Tickets | Jeton court et signé pour le relais et les futurs serveurs, et sa fonction de vérification documentée |
| Sécurité | Hachage lent, cookie `HttpOnly`, protection contre les requêtes intersites, limitation des tentatives, en-têtes de sécurité, taille des requêtes bornée |
| Client | Paquet TypeScript pour le navigateur : appels typés, résultats sans exception, validation des pseudos et mots de passe avant envoi |
| Démo | Panneau « Compte » minimal ; la démo reste jouable sans serveur des comptes |

**Hors périmètre** : email, récupération de mot de passe oublié (sans email, impossible sans un autre canal : voir « Décisions à valider »), connexion par un service tiers (Google, Discord…), double authentification, modération et signalement, profils publics consultables par d'autres joueurs (à définir avec `lobby` et `ranking`), calcul des statistiques (`ranking`), écran de compte final (`app-shell`), déploiement (`app-shell`).

## Points de conception à trancher par la spec

1. **Session : cookie plutôt que jeton en mémoire du navigateur.** Un cookie `HttpOnly` est hors de portée d'un script injecté dans la page ; un jeton gardé par le client ne l'est pas. Le cookie est `HttpOnly`, `SameSite=Strict`, `Path=/`, et `Secure` avec le préfixe `__Host-` en production. Le jeton de session (32 octets aléatoires) n'est conservé en base que sous forme d'empreinte SHA-256 : une base volée ne permet pas de se faire passer pour quelqu'un.
2. **Requêtes intersites.** Trois verrous : cookie `SameSite=Strict` ; toute requête qui modifie quelque chose doit être en `Content-Type: application/json`, ce qu'un formulaire d'un autre site ne peut pas envoyer sans autorisation du serveur, qui ne la donne jamais ; et si l'en-tête `Origin` est présent, il doit figurer dans la liste des origines autorisées.
3. **Hachage des mots de passe.** scrypt, aux paramètres que l'OWASP donne comme équivalents à son minimum : N = 2^15, r = 8, p = 3, sel aléatoire de 16 octets, empreinte de 32 octets (environ 32 Mo de mémoire et 0,2 s par calcul sur la machine de développement). Les paramètres sont écrits dans l'empreinte stockée (`scrypt$15$8$3$<sel>$<empreinte>`) : on pourra les durcir plus tard, chaque mot de passe étant recalculé à la connexion suivante. Les calculs simultanés sont plafonnés (2 par défaut) pour qu'une rafale ne sature pas la mémoire ; au-delà d'une file courte, le serveur répond « occupé ».
4. **Pas d'énumération par le temps de réponse.** Une connexion avec un pseudo inconnu calcule quand même un scrypt sur une empreinte factice, pour répondre dans le même temps qu'un mauvais mot de passe.
5. **Règles des pseudos.** Normalisation NFKC et espaces de bord retirés ; 3 à 16 caractères ; lettres latines (accents compris), chiffres, `_` et `-` ; commence par une lettre ; pas deux séparateurs de suite. **Clé d'unicité** : minuscules, accents retirés (`Élodie` et `elodie` sont le même pseudo). **Mots interdits** : une liste courte, vérifiée dans la clé après avoir ramené les chiffres déguisés en lettres (`4dm1n` → `admin`) : noms réservés (`admin`, `modo`, `staff`, `support`, `system`, `officiel`…), préfixes réservés aux invités (`invite`, `guest`) et une poignée d'insultes françaises et anglaises. La liste vit dans un fichier de données, à compléter par vous.
6. **Règles des mots de passe.** Suivant les recommandations actuelles (NIST 800-63B) : 8 à 128 caractères, aucune règle de composition imposée, refus d'un mot de passe égal au pseudo ou présent dans une courte liste des mots de passe les plus courants.
7. **Invités.** Un invité est un compte sans mot de passe, marqué comme tel. Son pseudo n'est pas réservé : deux invités peuvent porter le même, mais aucun ne peut prendre celui d'un compte existant. Les serveurs qui affichent des pseudos reçoivent ce marqueur dans le ticket et peuvent signaler l'invité à l'écran. Un invité qui se déconnecte, ou qui se connecte à un vrai compte depuis le même navigateur, perd son identité d'invité : elle est effacée sur-le-champ.
8. **Durée des sessions.** 30 jours, prolongés à chaque usage (la prolongation n'est écrite en base qu'une fois par heure au plus). 10 sessions par compte au plus : la plus ancienne est fermée au-delà. Un nouveau jeton est émis à chaque connexion, inscription et conversion (pas de fixation de session).
9. **Limitation des tentatives.** En mémoire, par seau à jetons. Par adresse IP : 20 tentatives d'authentification par minute (connexion, inscription, conversion, changement de mot de passe, suppression) et 30 créations d'invité par heure (une salle de huit joueurs derrière la même box passe sans peine). Par pseudo : 10 échecs de connexion par quart d'heure, quelle que soit l'adresse ; au-delà, refus avec `Retry-After`. Un attaquant peut ainsi bloquer temporairement la connexion d'un pseudo, mais jamais deviner son mot de passe : c'est le compromis retenu. Derrière le proxy inverse, l'adresse est lue dans `X-Forwarded-For`, seulement si l'option est activée.
10. **Tickets pour les autres serveurs.** Format `v1.<charge>.<signature>`, en base64url : la charge est un JSON `{ sub, name, guest, aud, iat, exp, jti }`, la signature un HMAC-SHA256 avec une clé partagée. Durée de vie : 60 secondes, le temps d'ouvrir une connexion. `aud` dit à quel serveur le ticket est destiné (`relay`, `lobby`, `ranking`), pour qu'un ticket du relais ne serve pas ailleurs. Plusieurs clés sont acceptées à la vérification, pour en changer sans coupure. `jti` permet au relais de refuser un ticket déjà présenté s'il le souhaite ; ce module ne l'impose pas.
11. **Stockage.** Interface `AccountStore`, deux implémentations : SQLite (`node:sqlite`, mode WAL, migrations numérotées par `PRAGMA user_version`) et mémoire. Les mêmes tests de contrat passent sur les deux : c'est ce qui garantit qu'on pourra changer de stockage.
12. **Identifiants.** Un compte est désigné par un identifiant aléatoire (UUID v4), jamais par son pseudo, qui peut changer. `lobby`, `ranking` et le relais s'appuient sur cet identifiant.

## Stack technique

| Élément | Choix |
|---|---|
| Langage | TypeScript 7, mêmes réglages que les autres paquets ; exécuté directement par Node 24+ |
| Serveur | `node:http`, `node:sqlite`, `node:crypto` ; aucune dépendance d'exécution |
| Client | `fetch` du navigateur ; aucune dépendance d'exécution |
| Tests | Vitest : unitaires, contrat du stockage, API de bout en bout sur un vrai serveur HTTP ; Playwright avec Edge pour le panneau de la démo |
| Outillage | `@types/node`, déjà présent dans le dépôt (démo), ajouté au paquet serveur : aucune nouvelle dépendance externe |

## Commandes

```
Tests du serveur :   pnpm --filter @game/accounts test
Types du serveur :   pnpm --filter @game/accounts typecheck
Serveur en dev :     pnpm --filter @game/accounts dev        (port 8787, base ./data/accounts.dev.sqlite)
Serveur :            pnpm --filter @game/accounts start      (configuration par variables d'environnement)
Tests du client :    pnpm --filter @game/accounts-client test
Types du client :    pnpm --filter @game/accounts-client typecheck
Test de la démo :    pnpm --filter @game/demo test
Lint :               pnpm lint
```

## Structure du projet

```
packages/accounts/                 → @game/accounts : le serveur
  src/
    index.ts        → API publique du serveur (createAccountsServer, stockages, configuration)
    main.ts         → point d'entrée : lit l'environnement, démarre, arrêt propre sur SIGTERM
    protocol.ts     → types des requêtes et réponses, codes d'erreur ; sans import Node (partagé avec le client)
    names.ts        → normalisation, clé d'unicité, validation des pseudos ; sans import Node
    passwords.ts    → règles des mots de passe (sans import Node)
    wordlists.ts    → mots interdits, mots de passe courants (données)
    hashing.ts      → scrypt : hacher, vérifier, détecter les paramètres périmés, plafond de calculs
    ticket.ts       → signer et vérifier un ticket ; n'importe que node:crypto
    tokens.ts       → jetons de session et leur empreinte
    rate-limit.ts   → seaux à jetons en mémoire, derrière une interface
    store.ts        → interface AccountStore et types des enregistrements
    store-memory.ts → stockage en mémoire
    store-sqlite.ts → stockage SQLite, schéma et migrations
    service.ts      → règles métier : invité, inscription, conversion, connexion, profil, suppression
    http.ts         → routage, cookies, lecture du corps, en-têtes, erreurs
    config.ts       → configuration et lecture des variables d'environnement
  test/             → unitaires, contrat des stockages, API de bout en bout
packages/accounts-client/          → @game/accounts-client : le client navigateur
  src/index.ts      → createAccountsClient, réexporte protocole et validations
  test/             → client contre un vrai serveur
apps/demo/
  src/account.ts    → panneau « Compte » minimal
  vite.config.ts    → relais /api/accounts vers le serveur des comptes
```

Le paquet serveur expose trois points d'entrée : `@game/accounts` (le serveur), `@game/accounts/protocol` (types et validations, utilisables dans le navigateur) et `@game/accounts/ticket` (vérification, pour le relais).

## API publique (contrat)

### API HTTP

Préfixe : `/api/accounts/v1`. Corps en JSON. Toute réponse porte `Cache-Control: no-store`. Erreur : statut HTTP et corps `{ "error": { "code": ErrorCode, "message": string } }`.

| Méthode et chemin | Corps | Réponse | Session requise |
|---|---|---|---|
| `GET /session` | — | `200 { account: AccountView \| null }` | non (renvoie `null` sans session, pour ne pas produire d'erreur dans la console du navigateur) |
| `POST /guest` | `{ pseudo?: string }` | `201 { account }` + cookie | non |
| `POST /register` | `{ pseudo, password }` | `201 { account }` + cookie | non |
| `POST /convert` | `{ pseudo, password }` | `200 { account }` + nouveau cookie | invité |
| `POST /login` | `{ pseudo, password }` | `200 { account }` + cookie | non |
| `POST /logout` | `{}` | `204` + cookie effacé | non (sans effet sans session : la déconnexion est idempotente) |
| `PATCH /profile` | `{ pseudo?, favoriteFighter? }` | `200 { account }` | oui |
| `POST /password` | `{ current, next }` | `204` ; autres sessions fermées | compte |
| `POST /delete` | `{ password }` (vide pour un invité) | `204` + cookie effacé | oui |
| `POST /tickets` | `{ audience: 'relay' \| 'lobby' \| 'ranking' }` | `200 { ticket, expiresAt }` | oui |
| `GET /health` | — | `200 { ok: true }` | non |

La suppression passe par `POST /delete` plutôt que `DELETE` : elle porte un corps (le mot de passe), ce que certains proxys suppriment sur un `DELETE`.

```ts
// @game/accounts/protocol — partagé par le serveur et le client.

export interface AccountView {
  readonly id: string;               // UUID, stable
  readonly pseudo: string;           // tel qu'affiché
  readonly guest: boolean;
  readonly favoriteFighter: string | null;   // identifiant de personnage, ex. « vanguard »
  readonly stats: { readonly matchesPlayed: number; readonly wins: number };
  readonly createdAt: string;        // ISO 8601
}

export type ErrorCode =
  | 'bad_request' | 'unsupported_media_type' | 'payload_too_large' | 'forbidden_origin'
  | 'not_found' | 'method_not_allowed'
  | 'unauthenticated' | 'not_a_guest' | 'guest_not_allowed'
  | 'invalid_pseudo' | 'pseudo_taken' | 'invalid_password' | 'invalid_credentials'
  | 'invalid_fighter' | 'invalid_audience'
  | 'rate_limited' | 'server_busy' | 'internal';

export type PseudoProblem = 'length' | 'characters' | 'start' | 'separators' | 'forbidden';
export type PasswordProblem = 'length' | 'same_as_pseudo' | 'too_common';

/** Pseudo normalisé, ou la raison du refus. */
export function validatePseudo(raw: string):
  { ok: true; pseudo: string; key: string } | { ok: false; problem: PseudoProblem };
export function validatePassword(password: string, pseudo: string):
  { ok: true } | { ok: false; problem: PasswordProblem };
```

### Vérification d'un ticket (pour le relais de `netcode`)

```ts
// @game/accounts/ticket — n'importe que node:crypto.

export interface TicketClaims {
  readonly sub: string;      // identifiant du compte
  readonly name: string;     // pseudo à afficher
  readonly guest: boolean;
  readonly aud: string;      // serveur destinataire
  readonly iat: number;      // émis à (secondes Unix)
  readonly exp: number;      // expire à (secondes Unix)
  readonly jti: string;      // identifiant unique du ticket
}

export type TicketError = 'malformed' | 'bad_signature' | 'expired' | 'wrong_audience';

/**
 * Vérifie un ticket émis par le serveur des comptes. Ne lève jamais d'erreur.
 * `secrets` : clés acceptées (la première est celle qui signe côté comptes).
 * Tolère 5 secondes d'écart d'horloge.
 */
export function verifyTicket(
  ticket: string,
  options: { secrets: readonly string[]; audience: string; now?: number },
): { ok: true; claims: TicketClaims } | { ok: false; error: TicketError };
```

Usage côté relais : le client demande `POST /tickets { audience: 'relay' }`, envoie le ticket dans son premier message au relais, et le relais appelle `verifyTicket(ticket, { secrets: [process.env.ACCOUNTS_TICKET_SECRET], audience: 'relay' })`. Le relais n'a besoin ni de la base, ni du réseau des comptes.

### Serveur

```ts
// @game/accounts

export interface AccountsConfig {
  readonly host: string;                    // défaut 127.0.0.1
  readonly port: number;                    // défaut 8787 ; 0 pour un port libre (tests)
  readonly store: AccountStore;
  readonly ticketSecrets: readonly string[];  // obligatoire, 32 caractères au moins
  readonly allowedOrigins: readonly string[];
  readonly secureCookies: boolean;          // défaut true ; false en dev sur http
  readonly trustProxy: boolean;             // lire X-Forwarded-For ; défaut false
  readonly hashing?: HashParams;            // défaut : paramètres de production
  readonly now?: () => number;              // horloge injectable pour les tests
}

export function createAccountsServer(config: AccountsConfig): AccountsServer;

export interface AccountsServer {
  listen(): Promise<{ port: number }>;
  close(): Promise<void>;
  /** Accès direct aux règles métier, pour les futurs modules hébergés dans le même processus (ranking). */
  readonly service: AccountService;
}

export function openSqliteStore(path: string): AccountStore;   // ':memory:' accepté
export function createMemoryStore(): AccountStore;
```

`AccountService` expose aussi, sans route HTTP, `recordMatch(accountId, { won })` pour les statistiques et `onAccountDeleted(listener)`, pour que `ranking` puisse effacer ses propres données. Variables d'environnement lues par `main.ts` : `ACCOUNTS_HOST`, `ACCOUNTS_PORT`, `ACCOUNTS_DB`, `ACCOUNTS_TICKET_SECRETS` (liste séparée par des virgules), `ACCOUNTS_ALLOWED_ORIGINS`, `ACCOUNTS_SECURE_COOKIES`, `ACCOUNTS_TRUST_PROXY`. Le serveur refuse de démarrer sans clé de ticket ; la commande `dev` en fournit une, marquée « dev ».

### Client navigateur

```ts
// @game/accounts-client

export type Result<T> = { ok: true; value: T } | { ok: false; error: ClientError };
export interface ClientError {
  readonly code: ErrorCode | 'network';
  readonly message: string;          // en français, affichable tel quel
  readonly retryAfter?: number;      // secondes, pour rate_limited
}

export function createAccountsClient(options?: { baseUrl?: string; fetch?: typeof fetch }): AccountsClient;

export interface AccountsClient {
  session(): Promise<Result<AccountView | null>>;
  guest(pseudo?: string): Promise<Result<AccountView>>;
  register(pseudo: string, password: string): Promise<Result<AccountView>>;
  convert(pseudo: string, password: string): Promise<Result<AccountView>>;
  login(pseudo: string, password: string): Promise<Result<AccountView>>;
  logout(): Promise<Result<void>>;
  updateProfile(changes: { pseudo?: string; favoriteFighter?: string | null }): Promise<Result<AccountView>>;
  changePassword(current: string, next: string): Promise<Result<void>>;
  deleteAccount(password?: string): Promise<Result<void>>;
  ticket(audience: 'relay' | 'lobby' | 'ranking'): Promise<Result<{ ticket: string; expiresAt: number }>>;
}
```

Le client ne lève jamais d'exception : un serveur injoignable donne `{ ok: false, error: { code: 'network' } }`. Il ne voit jamais le jeton de session, que le navigateur garde dans le cookie.

## Style de code

```ts
// Règle métier : pure, horloge et stockage injectés, testable sans réseau.

/** Connecte un compte. Même réponse, et même durée, que le pseudo existe ou non. */
async login(pseudo: string, password: string): Promise<Outcome<Session>> {
  const account = await this.store.findByKey(pseudoKey(pseudo));
  const ok = await this.hasher.verify(password, account?.passwordHash ?? DUMMY_HASH);
  if (account === null || !ok) return failure('invalid_credentials');
  // …
}
```

Conventions :
- Mêmes règles de nommage et de formatage que les autres paquets ; documentation et messages en français, code en anglais.
- Les règles (pseudos, mots de passe, tickets, limitation, métier) sont des fonctions ou des classes sans entrée-sortie, testées seules ; `http.ts`, `store-sqlite.ts` et `main.ts` restent minces.
- Rien de secret dans les journaux : ni mot de passe, ni jeton, ni pseudo, ni adresse IP. Une ligne par requête : méthode, route, statut, durée.
- Requêtes SQL uniquement préparées, jamais de texte concaténé.
- Comparaisons de secrets en temps constant (`timingSafeEqual`).

## Stratégie de test

| Niveau | Quoi | Où |
|---|---|---|
| Unitaire | Pseudos (normalisation, clé, accents, caractères, mots interdits déguisés), mots de passe, hachage (aller-retour, format, paramètres périmés, plafond), tickets (valide, expiré, falsifié, mauvaise audience, clé tournée, mal formé), limitation (seaux, `Retry-After`, oubli), cookies | `packages/accounts/test/` |
| Contrat du stockage | La même suite sur le stockage mémoire et sur SQLite : création, unicité de la clé, conversion, sessions, purge, suppression en cascade, migrations sur une base existante | `packages/accounts/test/` |
| Métier | Les règles de `service.ts` avec horloge factice : expiration et prolongation des sessions, plafond de 10 sessions, purge des invités, rehachage | `packages/accounts/test/` |
| API de bout en bout | Un vrai serveur HTTP sur un port libre, interrogé par `fetch` : chaque parcours (invité → conversion → déconnexion → connexion → profil → mot de passe → suppression) ; et chaque protection (type de contenu exigé, origine refusée, corps trop gros, JSON invalide, attributs du cookie, en-têtes, 429 et `Retry-After`, même erreur pour pseudo inconnu et mauvais mot de passe, session morte après déconnexion, changement de mot de passe et suppression, ticket vérifié par `verifyTicket`) | `packages/accounts/test/` |
| Client | Le client contre un vrai serveur ; serveur éteint : erreur `network` sans exception | `packages/accounts-client/test/` |
| Navigateur | Dans Edge : panneau Compte avec un vrai serveur des comptes (invité, inscription, conversion, déconnexion) ; sans serveur, message clair et démo toujours jouable ; tests de fumée existants inchangés | `apps/demo/test/` |

Le hachage de production est lent par conception : les tests utilisent des paramètres réduits, et un test dédié vérifie que la configuration par défaut est bien celle de production.

## Limites

- **Toujours** : faire passer tests, typecheck et lint avant chaque commit ; écrire le test avant la logique ; dire dans le compte rendu ce qui n'a pu être vérifié qu'à la main ; faire une relecture de sécurité avant le dernier point de contrôle.
- **Demander d'abord** : ajouter une dépendance ; enregistrer une donnée personnelle nouvelle ; changer le format des tickets une fois le relais branché dessus ; abaisser un paramètre de sécurité (coût de scrypt, durée des tickets, limites de tentatives).
- **Jamais** : enregistrer un mot de passe, un jeton de session ou une adresse IP en clair, en base ou dans un journal ; renvoyer une empreinte au client ; distinguer « pseudo inconnu » et « mauvais mot de passe » ; modifier le code de `netcode`, `sim-core` ou la ligne « Specs existantes » de la carte.

## Critères de succès

1. **Invité immédiat** : en une requête, sans mot de passe, un joueur a une session et un pseudo ; il le garde en rechargeant la page.
2. **Compte sans perte** : un invité converti garde son identifiant et son profil ; il se reconnecte avec son pseudo et son mot de passe depuis un autre navigateur.
3. **Pseudos propres** : unicité sans tenir compte de la casse ni des accents ; caractères hors liste, longueurs hors bornes et mots interdits (même déguisés) refusés avec la raison.
4. **Secrets protégés** : mots de passe hachés par scrypt aux paramètres de production ; jetons de session stockés par empreinte ; cookie `HttpOnly`, `SameSite=Strict`, `Secure` en production ; une base copiée ne permet ni de retrouver un mot de passe en clair, ni d'ouvrir une session.
5. **Robuste aux abus** : tentatives limitées par adresse et par pseudo avec `Retry-After` ; requêtes intersites, corps trop gros et types de contenu inattendus refusés ; réponse identique pour pseudo inconnu et mauvais mot de passe.
6. **Effaçable** : la suppression retire le compte, le profil et les sessions sur-le-champ ; le pseudo redevient libre ; les invités inactifs disparaissent après 30 jours.
7. **Branchable** : un ticket obtenu par l'API est accepté par `verifyTicket` avec la bonne audience, refusé avec une autre, après expiration ou modification ; la vérification est documentée et n'importe que `node:crypto`.
8. **Remplaçable** : la suite de contrat passe sur les deux stockages.
9. **Intégré** : la démo a un panneau Compte qui fonctionne contre le vrai serveur ; sans serveur, elle reste jouable ; ses tests existants passent inchangés.
10. **Relu** : une relecture de sécurité est faite et consignée, ses constats corrigés ou expliqués.

## Décisions prises à la validation

Choix par défaut approuvés tels quels le 2026-11-13 :

1. **Mot de passe oublié** : sans email, pas de récupération dans la v1. Le joueur est prévenu à l'inscription. Une piste pour plus tard : un code de secours affiché une seule fois à l'inscription.
2. **Pseudo des invités** : tiré au hasard (`Invité-48213`) ou choisi par le joueur, avec les mêmes règles ; non réservé, mais jamais égal à celui d'un compte.
3. **Changement de pseudo** : permis à tout moment, sans délai ; l'identifiant de compte ne change pas.
4. **Pseudo d'un compte supprimé** : libre immédiatement (et non après une période de carence).
5. **Personnage favori** : un identifiant au format `[a-z0-9-]{1,32}`, non vérifié contre la liste des personnages, que `fighters` construit en parallèle.
6. **Mots interdits** : je fournis une liste courte (noms réservés et une vingtaine d'insultes), que vous compléterez.
7. **Statistiques** : deux compteurs pour commencer (matchs joués, victoires) ; `ranking` en ajoutera.
