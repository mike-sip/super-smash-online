# Spec : `ranking` — classement, historique des matchs, statistiques de profil

> Statut : **APPROUVÉE le 2026-11-15** (décisions par défaut validées telles quelles). Plan : [tasks/ranking/plan.md](tasks/ranking/plan.md), tâches : [tasks/ranking/todo.md](tasks/ranking/todo.md). Module de la [carte des capacités](CAPABILITY-MAP.md). Dépend de : `accounts` (identité, sessions, statistiques du profil), `match-rules` (forme des résultats). Alimenté par : `lobby` (en cours en parallèle), qui lance les parties et transmet leurs résultats. Utilisé par : la démo aujourd'hui, `app-shell` demain.

## Hypothèses

1. **Le résultat d'un match n'est jamais fourni par un client.** Le relais de `netcode` ne simule rien, mais il garde le journal des inputs confirmés ; tous les clients simulent la même partie au bit près. Le serveur de `lobby` (ou le relais pour son compte) peut donc **rejouer le journal** avec `sim-core` et `match-rules` pour obtenir le `MatchResult` officiel, sans croire aucun client. C'est à `lobby` de produire ce résultat ; `ranking` n'accepte que des rapports **signés par un serveur** (clé partagée que les navigateurs n'ont jamais) ou remis en mémoire par un module du même processus.
2. **Hébergé avec les comptes.** `ranking` est un paquet à part (`@game/ranking`), mais son API HTTP est servie par le même processus Node que `accounts`, sous `/api/ranking/v1`, grâce à un point d'extension étroit ajouté à `accounts`. Il lit ainsi les sessions et les pseudos sans appel réseau, et apprend les suppressions de compte par `onAccountDeleted`. Son stockage est à lui : interface `RankingStore`, implémentations SQLite (fichier séparé de celui des comptes) et mémoire, même suite de contrat.
3. **Un seul classement pour la v1**, tous modes confondus (Stock, Temps, Endurance ; chacun pour soi et équipes). On pourra le scinder plus tard sans changer le format des rapports.
4. **Serveur, donc calcul en virgule flottante permis.** Aucune contrainte de déterminisme entre navigateurs ici : les points sont calculés une fois, côté serveur, puis arrondis à l'entier par une règle qui conserve la somme.
5. **Données personnelles** : rien de nouveau. On enregistre l'identifiant de compte, le personnage joué, la place, quelques compteurs du match et la date. Le pseudo n'est pas copié : il est lu chez `accounts` à l'affichage, pour suivre ses changements et disparaître avec le compte.

## Objectif

Donner à chaque joueur inscrit une cote qui reflète son niveau face aux autres, quel que soit le nombre de joueurs et le mode ; un tableau de classement ; l'historique de ses matchs ; et des statistiques de profil (matchs, victoires, personnages joués). Le tout sans qu'un résultat puisse être compté deux fois ni venir d'un client.

**Succès** : après un match classé à 8, chaque participant inscrit voit sa cote bouger d'une quantité conforme à la formule, son match apparaît dans son historique, ses compteurs montent ; le même rapport envoyé deux fois ne change rien la seconde fois ; un rapport non signé est refusé ; la somme des points ne dérive pas, même après des milliers de matchs.

### Périmètre fonctionnel

| Domaine | Inclus dans ce module |
|---|---|
| Réception des résultats | Rapport de match signé par HMAC (HTTP) ou remis en mémoire ; validation stricte ; idempotence par identifiant de match |
| Cote | Elo par paires adapté de 2 à 8 joueurs, chacun pour soi et équipes, égalités, abandons ; somme nulle par match |
| Historique | Liste paginée des matchs d'un joueur : date, mode, place, personnage, adversaires, variation de cote |
| Classement | Tableau paginé des joueurs inscrits par cote ; position du joueur connecté |
| Statistiques | Matchs joués, victoires, par personnage (joués, victoires), KO, chutes ; matchs classés, cote, meilleure cote |
| Comptes | Mise à jour des compteurs `matchesPlayed` et `wins` d'`accounts` ; effacement des données à la suppression d'un compte |
| Client | Fonctions typées dans `@game/ranking/client` (navigateur), sans exception |
| Démo | Panneau « Classement » minimal : tableau, ma cote, mon historique ; une partie locale de la démo n'est jamais envoyée |

**Hors périmètre** : production du résultat officiel (rejoue du journal : `lobby`/`netcode`), matchmaking par niveau (`lobby` pourra lire la cote par `getRating`), saisons et remise à zéro, classements par mode ou par personnage, profils publics d'autres joueurs, détection de triche ou de collusion (deux comptes qui s'arrangent), écran final (`app-shell`).

## Formule de la cote (proposée)

Notations : `R` la cote avant le match, `K = 32`, cote de départ `1000`.

1. **Unités.** En chacun pour soi, chaque joueur est une unité. En équipes, chaque équipe est une unité, de cote `R_U` égale à la **moyenne** des cotes de ses membres classés.
2. **Résultat entre deux unités** `A` et `B`, d'après leurs places (`placement` de `match-rules`, éventuellement corrigé par la règle d'abandon) : `S = 1` si `A` est mieux classée, `0,5` à égalité, `0` sinon.
3. **Score attendu** : `E(A, B) = 1 / (1 + 10^((R_B − R_A) / 400))`.
4. **Variation d'un joueur** `i` de l'unité `A` : `Δ_i = K / D × Σ_{j adversaire de i} (S(A, B_j) − E(A, B_j))`, où la somme porte sur **chaque joueur adverse** `j` (d'unité `B_j`), et `D` est le **nombre moyen d'adversaires par joueur** dans ce match (`D = Σ_i nb_adversaires(i) / N`).
   - Chacun pour soi à `N` joueurs : `D = N − 1`, et la formule devient l'Elo classique moyenné sur les `N − 1` duels. À 2 joueurs, c'est exactement l'Elo à `K = 32`.
   - 2 contre 2 : `D = 2` ; chaque joueur gagne ou perd au plus `K`, comme à 2.
   - Équipes déséquilibrées (3 contre 1) : `D = 1,5` ; le joueur seul risque plus (jusqu'à `2K`), chacun des trois moins (`K × 2/3`).
5. **Somme nulle.** Pour chaque paire de joueurs adverses, ce que l'un gagne, l'autre le perd (même `K / D`, `S` et `E` complémentaires) : la somme des `Δ` d'un match vaut exactement 0 avant arrondi.
6. **Arrondi sans dérive.** Les cotes sont des entiers. Les `Δ` sont arrondis à l'entier inférieur, puis le point manquant (un entier, à cause de la somme nulle) est distribué d'un point à la fois aux plus grandes parties fractionnaires (méthode du plus fort reste), ex æquo départagés par l'identifiant de compte. La somme des variations entières d'un match vaut donc exactement 0, et la somme des cotes de tous les joueurs classés reste égale à `1000 × leur nombre`.
7. **Pas de plancher** (il casserait la somme nulle) ; une cote très basse est possible mais rare.

Exemples (calculés, repris tels quels dans les tests) : à 2 joueurs de 1000, le gagnant prend +16, le perdant −16. À 8 joueurs de 1000, places 1 à 8 : `Δ = 32/7 × (nb battus − nb devant)/2`, soit +16, +11, +7, +2, −2, −7, −11, −16. Égalité parfaite entre deux joueurs de même cote : 0 et 0.

## Ce qui compte, ou non (proposé)

| Situation | Historique et statistiques | Cote |
|---|---|---|
| Match de matchmaking (`ranked: true` envoyé par `lobby`) | oui | oui |
| Salon privé par code (`ranked: false`) | oui | **non** |
| Joueur invité | oui (son profil d'invité ; conservé s'il crée un compte) | **non** : il est retiré du calcul, les inscrits sont comparés entre eux selon leurs places |
| Moins de 2 unités adverses avec un inscrit (ex. 1 inscrit et 7 invités, ou équipe contre équipe d'invités) | oui | non (match marqué « non classé ») |
| Désynchronisation signalée par le relais pendant le match | non : rapport refusé (`lobby` ne doit pas l'envoyer) | non |
| Partie locale de la démo, ou résultat calculé par un navigateur | jamais reçu | jamais |

**Abandon et déconnexion.** Le relais annonce la frame de départ d'un joueur (déconnexion ou départ volontaire, même traitement : `netcode` ne fait pas la différence). Le rapport porte `leftAtFrame` (ou `null`). Règle :
- Un joueur parti avant la fin est **classé dernier**, quelle que soit la place que `match-rules` lui donne (son combattant immobile pourrait sinon survivre au chronomètre). Plusieurs partants : celui qui est parti le plus tôt est derrière ; même frame, ex æquo.
- En équipes, le partant **quitte son équipe pour le calcul** : il forme une unité seule, classée dernière. Ses coéquipiers gardent la place de leur équipe et, comme ils « battent » le partant, sont un peu dédommagés. La somme nulle tient toujours.
- Un partant perd donc toujours des points (sauf à ne quitter que des joueurs bien mieux cotés, cas où sa perte est faible mais non nulle) ; il n'existe aucune façon d'esquiver une défaite en se déconnectant.
- Le match compte pour les autres même s'ils ne sont plus qu'un : le dernier présent bat tous les partants.
- Pas de reconnexion en v1 (le relais n'en propose pas) : un départ est définitif.

## Points de conception à trancher par la spec

1. **Origine des résultats.** Deux portes d'entrée seulement : `ranking.submitMatch(report)` pour un module du même processus, et `POST /api/ranking/v1/matches` signé. Signature : `Authorization: Report v1.<base64url(HMAC-SHA256(clé, corps brut))>`, avec une clé dédiée (`RANKING_REPORT_SECRETS`, 32 caractères au moins, plusieurs acceptées pour en changer sans coupure), distincte de la clé des tickets. Comparaison en temps constant. Le corps porte `reportedAt` (millisecondes) : refusé s'il s'écarte de plus de 5 minutes de l'horloge du serveur. Une requête qui porte un en-tête `Origin` ou `Sec-Fetch-Site` (donc venue d'un navigateur) est refusée d'office. Le proxy inverse de production pourra en plus bloquer ce chemin depuis l'extérieur.
2. **Idempotence.** `matchId` (UUID choisi par `lobby`) est la clé primaire des matchs. Le rapport entier est enregistré avec son empreinte SHA-256 (JSON canonique). Même `matchId`, même empreinte : réponse `200 { status: 'duplicate', ... }` avec les variations déjà appliquées, rien ne change. Même `matchId`, autre contenu : `409 conflict`, rien ne change. L'enregistrement du match, des participants, des cotes et des statistiques se fait dans **une seule transaction** ; deux rapports simultanés sont traités l'un après l'autre (file en mémoire, un seul processus).
3. **Compteurs d'`accounts`.** `AccountView.stats` (`matchesPlayed`, `wins`) reste la source affichée par le panneau Compte. `ranking` appelle `service.recordMatch(id, won)` **après** sa transaction et marque chaque participant comme synchronisé ; au démarrage et à chaque purge, les participants non synchronisés sont rejoués. Une victoire = place 1 (en équipes, l'équipe gagnante ; un partant n'est jamais vainqueur).
4. **Suppression d'un compte.** À `onAccountDeleted`, sa cote, ses statistiques et sa ligne de classement sont effacées ; dans l'historique des autres joueurs, sa participation reste (la cote des autres ne change pas), mais sans identifiant : affichée « Joueur supprimé ». La somme des cotes perd la sienne : la propriété vérifiée est « somme des variations de chaque match = 0 », et « somme des cotes = 1000 × nombre de classés » tant que personne n'est supprimé.
5. **Classement.** Seuls les comptes inscrits avec au moins **5 matchs classés** y figurent (cote provisoire avant). Tri : cote décroissante, puis plus de matchs classés, puis identifiant. Rang « olympique » : deux cotes égales partagent le rang. Pagination par `offset`/`limit` (au plus 100). Le tableau est public (pseudo, cote, matchs classés, victoires).
6. **Historique.** Lisible par le joueur lui-même seulement (session), paginé par curseur (date et `matchId`), 20 par page, 50 au plus. Chaque entrée : date, mode, équipes oui/non, classé ou non, sa place sur le nombre d'unités, son personnage, abandon, `Δ` et cote après, et la liste des participants (pseudo actuel ou « Invité »/« Joueur supprimé », personnage, place).
7. **Rétention.** L'historique d'un joueur est gardé en entier en v1 (quelques centaines d'octets par participation). Les invités purgés par `accounts` après 30 jours d'inactivité déclenchent `onAccountDeleted` comme une suppression : leurs données partent avec eux.
8. **Point d'extension dans `accounts`** (la seule modification hors du paquet) :
   - `AccountsConfig.extensions?: readonly HttpExtension[]`, où `HttpExtension = { prefix: string; handle(request, response, context): Promise<void> }` ; `http.ts` passe toute requête dont le chemin commence par `prefix` à l'extension, avec un `context` qui donne `address`, `auth()` (la session du cookie, comme pour les routes des comptes) et les en-têtes de sécurité communs. L'extension lit son corps elle-même (taille bornée).
   - `AccountService.publicNames(ids): Promise<Map<string, { pseudo: string; guest: boolean }>>` : les pseudos actuels pour l'affichage.
   - Les deux sont additifs ; aucun comportement existant ne change ; tests ajoutés dans `accounts`.
9. **Lecture de la cote par `lobby`** : `ranking.getRating(accountId)` en mémoire, pour un futur appariement par niveau. Pas de route HTTP pour cela en v1.

## Interface avec `lobby` (à valider avec la session `lobby`)

```ts
// @game/ranking/protocol — sans import Node.

export interface MatchReport {
  readonly version: 1;
  /** UUID choisi par lobby à la création de la partie : clé d'idempotence. */
  readonly matchId: string;
  /** Millisecondes Unix, au moment de l'envoi (signature fraîche). */
  readonly reportedAt: number;
  /** Fin de la partie, millisecondes Unix. */
  readonly endedAt: number;
  /** Matchmaking : true ; salon privé : false. */
  readonly ranked: boolean;
  readonly mode: 'stock' | 'time' | 'stamina';
  readonly teams: boolean;
  /** Frame de fin (MatchResult.endFrame). */
  readonly endFrame: number;
  /** Dans l'ordre des emplacements de la partie, de 2 à 8. */
  readonly players: readonly ReportedPlayer[];
}

export interface ReportedPlayer {
  /** Identifiant de compte (`sub` du ticket vérifié par le relais ou le lobby). */
  readonly accountId: string;
  /** `guest` du ticket. */
  readonly guest: boolean;
  /** Identifiant de personnage, `[a-z0-9-]{1,32}`. */
  readonly fighter: string;
  /** Équipe (0 à 3) ; ignorée sans équipes. */
  readonly team: number;
  /** MatchResult.players[i].placement : 1 = premier, ex æquo possibles. */
  readonly placement: number;
  readonly kos: number;
  readonly falls: number;
  /** Frame de départ annoncée par le relais, ou null s'il est resté jusqu'au bout. */
  readonly leftAtFrame: number | null;
}

/** Construit les champs de match d'un rapport à partir d'un MatchResult officiel. */
export function reportFromResult(result: MatchResult, extra: {
  matchId: string; ranked: boolean; endedAt: number; reportedAt: number;
  players: readonly { accountId: string; guest: boolean; fighter: string; leftAtFrame: number | null }[];
}): MatchReport;

/** Signe un rapport pour l'envoyer en HTTP (côté serveur lobby). N'importe que node:crypto. */
// @game/ranking/report
export function signReport(body: string, secret: string): string;  // valeur de l'en-tête Authorization
```

Ce que `lobby` s'engage à faire : n'envoyer que des matchs terminés dont le résultat a été obtenu côté serveur (rejoue du journal du relais, ou vérification que les empreintes de tous les clients restés concordent jusqu'à la dernière frame) ; ne jamais envoyer un match désynchronisé ; ne jamais confier la clé à un client ; renvoyer le même rapport en cas de doute (l'idempotence le permet). Si deux joueurs ont le même `accountId` (même compte dans deux onglets), le rapport est refusé.

Validation par `ranking` (refus `400 invalid_report` avec la liste des problèmes) : champs exacts sans clé inconnue ; 2 à 8 joueurs ; UUID ; identifiants de comptes distincts ; places entières de 1 à N, cohérentes (au moins une place 1, les places partagées entre ex æquo, en équipes la même place pour toute l'équipe) ; `leftAtFrame` entre 0 et `endFrame` ; compteurs entiers bornés. Un compte inconnu d'`accounts` (supprimé entre-temps) est traité comme un invité.

## Stack technique

| Élément | Choix |
|---|---|
| Langage | TypeScript, mêmes réglages que `accounts` ; exécuté directement par Node 24+ |
| Serveur | `node:http` (par l'extension d'`accounts`), `node:sqlite`, `node:crypto` ; aucune dépendance d'exécution |
| Client | `fetch` du navigateur ; aucune dépendance |
| Tests | Vitest : formule (cas connus, propriétés sur tirages aléatoires), contrat du stockage, API de bout en bout sur un vrai serveur ; Playwright avec Edge pour le panneau de la démo |
| Outillage | Celui déjà présent ; aucune nouvelle dépendance |

## Commandes

```
Tests :                    pnpm --filter @game/ranking test
Types :                    pnpm --filter @game/ranking typecheck
Serveur en dev :           pnpm --filter @game/ranking dev   (comptes + classement sur le port 8787)
Serveur :                  pnpm --filter @game/ranking start
Envoyer des matchs factices en dev : pnpm --filter @game/ranking seed
Tests de accounts :        pnpm --filter @game/accounts test
Test de la démo :          pnpm --filter @game/demo test
Lint :                     pnpm lint
```

`seed` signe et envoie quelques rapports inventés avec la clé de développement, pour remplir le classement de la démo tant que `lobby` n'est pas branché.

## Structure du projet

```
packages/ranking/                  → @game/ranking
  src/
    index.ts        → createRanking (module serveur), stockages, types
    protocol.ts     → MatchReport, réponses HTTP, codes d'erreur, validateReport, reportFromResult ; sans import Node
    rating.ts       → la formule : unités, abandons, Δ, arrondi au plus fort reste ; fonction pure
    report.ts       → signReport, verifyReportSignature ; n'importe que node:crypto
    store.ts        → interface RankingStore et enregistrements
    store-memory.ts → stockage en mémoire
    store-sqlite.ts → SQLite, schéma, migrations
    service.ts      → règles métier : soumission idempotente, synchronisation des compteurs, lectures, suppression
    http.ts         → routes /api/ranking/v1 (extension d'accounts)
    client.ts       → client navigateur (point d'entrée @game/ranking/client)
    main.ts / dev.ts / seed.ts → démarrage comptes + classement ; données de démonstration
  test/
packages/accounts/src/             → extension HTTP et publicNames (additifs)
apps/demo/src/leaderboard.ts       → panneau « Classement »
apps/demo/vite.config.ts           → relais /api/ranking
```

## API publique (contrat)

### HTTP

Préfixe `/api/ranking/v1`. JSON. `Cache-Control: no-store`. Erreurs : `{ "error": { "code", "message", "problems"? } }`.

| Méthode et chemin | Accès | Réponse |
|---|---|---|
| `POST /matches` | serveur, signature HMAC | `201 { status: 'recorded', ranked, changes }` ; `200 { status: 'duplicate', ranked, changes }` ; `400 invalid_report` ; `401 bad_signature` ; `403 forbidden_origin` ; `409 conflict` |
| `GET /leaderboard?offset=&limit=` | public | `200 { total, entries: LeaderboardEntry[] }` |
| `GET /me` | session | `200 { profile: RankingProfile }` (invité compris, sans cote) |
| `GET /me/matches?before=&limit=` | session | `200 { matches: HistoryEntry[], next: string \| null }` |

```ts
export interface RatingChange { readonly accountId: string; readonly before: number; readonly after: number; readonly delta: number }
export interface LeaderboardEntry { readonly rank: number; readonly accountId: string; readonly pseudo: string; readonly rating: number; readonly rankedMatches: number; readonly wins: number }
export interface RankingProfile {
  readonly rating: number | null;          // null pour un invité
  readonly provisional: boolean;           // moins de 5 matchs classés
  readonly rank: number | null;            // position au classement, null si absent
  readonly peakRating: number | null;
  readonly rankedMatches: number;
  readonly matchesPlayed: number; readonly wins: number; readonly kos: number; readonly falls: number;
  readonly fighters: readonly { readonly fighter: string; readonly played: number; readonly wins: number }[];
}
export interface HistoryEntry {
  readonly matchId: string; readonly endedAt: string; readonly mode: 'stock' | 'time' | 'stamina';
  readonly teams: boolean; readonly ranked: boolean;
  readonly placement: number; readonly units: number; readonly fighter: string; readonly left: boolean;
  readonly delta: number | null; readonly ratingAfter: number | null;
  readonly players: readonly { readonly name: string; readonly kind: 'account' | 'guest' | 'deleted'; readonly fighter: string; readonly placement: number; readonly team: number; readonly left: boolean }[];
}
```

### Serveur

```ts
export function createRanking(options: {
  store: RankingStore; accounts: AccountService; reportSecrets: readonly string[]; now?: () => number;
}): Ranking;

export interface Ranking {
  /** À passer dans AccountsConfig.extensions. */
  readonly extension: HttpExtension;
  submitMatch(report: unknown): Promise<SubmitOutcome>;   // même validation que la route HTTP
  getRating(accountId: string): Promise<number | null>;
  close(): Promise<void>;
}

/** Fonction pure, testée seule. */
export function computeRatingChanges(input: {
  teams: boolean;
  players: readonly { accountId: string; rating: number; team: number; placement: number; leftAtFrame: number | null }[];
}): RatingChange[];
```

### Client navigateur

`createRankingClient({ baseUrl?, fetch? })` → `leaderboard(offset?, limit?)`, `me()`, `myMatches(before?)`, chacun `Promise<Result<…>>` sans exception, comme `@game/accounts-client`.

## Style de code

```ts
/** Arrondit des variations de somme nulle en entiers de somme nulle (plus fort reste). */
export function roundPreservingSum(deltas: readonly { id: string; value: number }[]): Map<string, number> {
  const floors = deltas.map((d) => ({ id: d.id, int: Math.floor(d.value), frac: d.value - Math.floor(d.value) }));
  const missing = -floors.reduce((sum, f) => sum + f.int, 0); // ≥ 0, entier
  // Un point à chacune des `missing` plus grandes parties fractionnaires (ex æquo : identifiant).
  // …
}
```

Conventions : celles d'`accounts` (règles pures et testées seules, `http.ts` et `store-sqlite.ts` minces, SQL uniquement préparé, rien de secret dans les journaux, documentation en français, code en anglais).

## Stratégie de test

| Niveau | Quoi | Où |
|---|---|---|
| Formule | Cas connus : 2 joueurs (égaux, écart de 400, égalité), 8 joueurs places 1 à 8 et avec ex æquo, 2 contre 2, 3 contre 1, 4 équipes de 2, abandon seul et multiple, abandon en équipes, invités retirés, match non classé faute d'adversaires ; arrondi : somme nulle exacte, ex æquo départagés de façon stable | `test/rating.test.ts` |
| Propriétés | 10 000 matchs aléatoires (2 à 8 joueurs, équipes ou non, abandons, ex æquo) sur 200 joueurs : somme des variations de chaque match = 0, somme des cotes = 1000 × nombre de classés ; ordre monotone (mieux classé ⇒ variation au moins aussi bonne, à cotes égales) ; un partant ne gagne jamais | `test/rating-properties.test.ts` |
| Validation | Rapports mal formés, champs inconnus, places incohérentes, doublons de comptes, bornes | `test/protocol.test.ts` |
| Signature | Valide, falsifiée, autre clé, clé tournée, corps modifié d'un octet, mal formée, sans exception | `test/report.test.ts` |
| Contrat du stockage | Même suite sur mémoire et SQLite : transaction atomique (échec au milieu ⇒ rien d'écrit), idempotence, pagination, suppression, migrations | `test/store-*.test.ts` |
| Métier | Doublon identique, conflit, ordre de traitement de deux soumissions simultanées, synchronisation des compteurs d'`accounts` et reprise après échec, suppression d'un compte, compte inconnu traité en invité | `test/service.test.ts` |
| API de bout en bout | Vrai serveur comptes + classement : rapport signé accepté ; non signé, mal signé, trop vieux, avec `Origin` refusés ; le même rapport deux fois ; classement public ; `/me` et `/me/matches` avec session, refusés sans ; un client (cookie de session) ne peut pas soumettre | `test/api.test.ts` |
| Extension `accounts` | Préfixe routé vers l'extension, routes existantes inchangées, `auth()` dans l'extension, `publicNames` | `packages/accounts/test/` |
| Démo | Dans Edge : panneau Classement avec un vrai serveur et des matchs semés ; sans serveur, message clair et démo jouable ; tests existants inchangés | `apps/demo/test/` |

## Limites

- **Toujours** : tests, typecheck et lint avant chaque commit ; test avant la logique ; signaler ce qui n'est vérifié qu'à la main.
- **Demander d'abord** : ajouter une dépendance ; changer la formule ou les règles de prise en compte après validation ; changer le format du rapport une fois `lobby` branché ; toucher à `accounts` au-delà des deux ajouts décrits.
- **Jamais** : accepter un résultat venu d'un navigateur ; compter deux fois un même `matchId` ; copier le pseudo en base ; modifier `sim-core`, `netcode`, `match-rules`, le code de `lobby` ou la ligne « Specs existantes » de la carte.

## Critères de succès

1. **Formule juste** : les cas connus (2 joueurs, 8 joueurs, équipes égales et déséquilibrées, égalités) donnent les valeurs attendues, écrites dans la spec et dans les tests.
2. **Sans dérive** : sur 10 000 matchs aléatoires, chaque match est à somme nulle en entiers et la somme des cotes reste `1000 × nombre de classés`.
3. **Abandons** : un joueur parti avant la fin est classé dernier (seul, en équipes) et ne gagne jamais de points ; règle testée en chacun pour soi et en équipes.
4. **Une seule fois** : le même rapport soumis deux fois (en série et simultanément) n'est compté qu'une fois ; un contenu différent sous le même `matchId` est refusé.
5. **Origine vérifiée** : un rapport non signé, mal signé, trop ancien ou venu d'un navigateur est refusé ; un client avec une session valide ne peut pas en soumettre.
6. **Prise en compte** : invités, salons privés et matchs sans adversaire inscrit ne touchent pas aux cotes mais remplissent historique et statistiques.
7. **Profil et compteurs** : statistiques par personnage justes ; `AccountView.stats` d'`accounts` à jour, y compris après un échec de synchronisation repris.
8. **Effaçable** : la suppression d'un compte efface ses données de classement et l'anonymise dans l'historique des autres.
9. **Remplaçable** : la suite de contrat passe sur les deux stockages.
10. **Intégré** : la démo montre classement, ma cote et mon historique contre un vrai serveur ; sans serveur elle reste jouable ; ses tests existants passent inchangés.
11. **Branchable** : `lobby` dispose de `reportFromResult`, `signReport` et `submitMatch`, documentés, et d'une note dans le dossier partagé.

## Décisions prises à la validation

Approuvées telles quelles le 2026-11-15 :

1. **Formule** : Elo par paires, `K = 32`, cote de départ 1000, équipes par cote moyenne, somme nulle exacte (voir plus haut). Alternative écartée : `K` plus fort pour les nouveaux joueurs (convergence plus rapide, mais la somme ne serait plus nulle).
2. **Invités** : historique et statistiques oui, cote non ; retirés du calcul des inscrits.
3. **Salons privés** : non classés.
4. **Abandon** : classé dernier, seul, en équipes comme en chacun pour soi ; aucune distinction entre déconnexion et départ volontaire.
5. **Seuil d'apparition au classement** : 5 matchs classés.
6. **Un seul classement** tous modes confondus.
7. **Historique** visible par le joueur seul ; classement public.
