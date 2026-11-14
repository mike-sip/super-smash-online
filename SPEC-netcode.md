# Spec : `netcode` — jeu en ligne par rollback et serveur relais

> Statut : **APPROUVÉE le 2026-11-13, implémentée** (bilan en fin de document ; un critère partiel à reformuler, l'essai manuel reste à faire). Plan : [tasks/netcode/plan.md](tasks/netcode/plan.md), tâches : [tasks/netcode/todo.md](tasks/netcode/todo.md). Module de la [carte des capacités](CAPABILITY-MAP.md). Dépend de : `sim-core` (implémenté), `input` (implémenté). Jalon visé : jalon 2 de la carte, « 2 puis 8 joueurs en ligne, sans désync ».

## Hypothèses

1. **Tout le monde simule tout.** Chaque navigateur fait tourner la simulation complète de `sim-core`. Le serveur ne simule rien : il reçoit les inputs de chaque joueur, les ordonne, les relaie aux autres et arbitre les retards. C'est la décision de la carte (« simulation déterministe + rollback, inputs relayés par un serveur, topologie en étoile »).
2. **Le serveur est l'arbitre des inputs.** Un input ne devient définitif (« confirmé ») que lorsque le serveur l'a accepté et renvoyé à tous, y compris à son auteur. Un joueur dont l'input arrive trop tard voit le serveur le remplacer par son input précédent : un joueur à la connexion lente ne fige pas les sept autres, il est le seul à en pâtir. Une déconnexion se traite de la même façon (inputs neutres).
3. **Transport : WebSocket seul pour la v1.** WebTransport n'est pas simple côté serveur : Node.js n'a pas de serveur HTTP/3, il faudrait une bibliothèque native. Le protocole est néanmoins conçu pour un transport qui perd et désordonne les messages (envoi redondant jusqu'à accusé de réception), pour que WebTransport puisse s'ajouter plus tard sans le changer, et c'est ainsi qu'il est testé.
4. **Horloge commune.** Chaque client estime l'horloge du serveur (échanges ping/pong) et simule la frame `n` à l'instant `début + n × 16,67 ms` de cette horloge. Tous les joueurs sont ainsi à la même frame au même instant, à l'erreur d'estimation près, sans négociation d'avance entre pairs.
5. **Le netcode ne connaît pas les règles du jeu.** Il fait avancer, sauvegarde et restaure un « jeu » par une interface minimale. Toute logique appliquée entre deux frames (la réapparition aujourd'hui, les règles de `match-rules` demain) doit être une fonction de l'état de la simulation, sans état à côté, faute de quoi le rollback la rendrait fausse. Un adaptateur prêt à l'emploi enveloppe une simulation `sim-core`.
6. **Connexion minimale.** On rejoint une partie par un identifiant libre et un nombre de joueurs attendus ; la partie démarre quand tous les emplacements sont pris. Salons par code, matchmaking, choix du personnage et comptes appartiennent à `lobby` et `accounts`, qui remplaceront ce point d'entrée. Pas de reconnexion en cours de partie, pas de spectateurs (hors v1 selon la carte).
7. **Aucune modification de `sim-core`.** Tout ce dont le netcode a besoin existe déjà (`saveState`, `loadState`, `checksum`, `frame`, et le compteur de frames d'action qui permet une réapparition calculée depuis l'état). Si l'implémentation révèle un besoin, il sera soumis à part, comme le veulent les règles de développement en parallèle.
8. **Hébergement** : une seule région (Europe). Les réglages par défaut visent des allers-retours de moins de 100 ms ; au-delà, le jeu reste correct mais corrige plus souvent l'affichage.

## Objectif

Permettre à 2 puis 8 joueurs, chacun dans son navigateur, de jouer le même combat avec la réactivité d'une partie locale : son propre combattant répond sans attente perceptible, les autres apparaissent avec le moins de retard possible, et toutes les machines restent rigoureusement synchronisées.

**Utilisateurs** : `lobby` (qui créera les parties et y fera entrer les joueurs), `app-shell` (qui intégrera la boucle de jeu en ligne), et vous, avec une démo jouable à plusieurs onglets ou plusieurs machines du réseau local.

**Succès** : huit clients, sur un réseau avec latence, gigue et pertes, jouent dix minutes et finissent avec des checksums identiques, sans jamais figer plus que la fenêtre prévue ; dans la démo, deux onglets d'Edge jouent ensemble et chacun voit l'autre bouger.

### Périmètre fonctionnel

| Domaine | Inclus dans ce module |
|---|---|
| Rollback | Historique des inputs, prédiction des inputs inconnus (répétition du dernier connu), sauvegarde de l'état à chaque frame, restauration et re-simulation à la première frame mal prédite, fenêtre de prédiction bornée |
| Délai d'input | Input local appliqué `D` frames après sa lecture, `D` fixé par la partie (2 par défaut) |
| Horloge | Estimation de l'horloge serveur, cadence de simulation calée dessus, corrections progressives, rattrapage après un onglet masqué |
| Protocole | Messages binaires versionnés, envoi redondant jusqu'à accusé de réception, validation stricte de tout message reçu |
| Serveur relais | Node.js, WebSocket, parties par identifiant, attribution des emplacements, relais immédiat des inputs, remplacement des inputs en retard, inputs neutres après une déconnexion, limites de taille et de débit |
| Désynchronisation | Checksum d'un état confirmé envoyé régulièrement par chaque client, comparé par le serveur, alerte à tous les clients en cas d'écart |
| Mesures | Aller-retour, profondeur des rollbacks, frames prédites, attentes, inputs remplacés : exposées pour un affichage de diagnostic |
| Rendu | Contrat d'appel du rendu pendant le rollback, vérifié contre `render` (voir « Rendu et rollback ») |
| Démo | Application `apps/online` : jeu à plusieurs onglets ou machines du réseau local, serveur relais intégré au serveur de développement |

**Hors périmètre** : salons, matchmaking, sélection de personnage et de stage (`lobby`) ; comptes et authentification (`accounts`) ; règles de match et fin de partie (`match-rules`) ; reconnexion, spectateurs, replays ; WebTransport ; délai d'input adaptatif ; déploiement en production (`app-shell`).

## Points de conception

### Numérotation des frames

`S(n)` est l'état après `n` pas de simulation (`frame(sim) === n`) ; `I(n)` est l'ensemble des inputs qui font passer de `S(n)` à `S(n+1)`. L'input lu localement pendant que le client est à la frame `n` devient l'input du joueur pour `I(n + D)`. Les inputs des frames `0` à `D-1` valent 0 pour tous et sont confirmés d'office.

### Côté client : le rollback

- Chaque client tient, par joueur, la frontière des inputs confirmés `connu[p]` : tous les inputs de ce joueur avant cette frame sont définitifs. La frontière globale `C = min(connu)` est la première frame dont un input reste incertain.
- Pour simuler une frame dont un input n'est pas confirmé, le client le **prédit** : le dernier input confirmé du joueur pour un joueur distant, l'input lu localement pour un joueur local. L'input utilisé est mémorisé.
- Quand un input confirmé arrive pour une frame déjà simulée et qu'il diffère de l'input utilisé, le client restaure l'état `S(f)` de la première frame fausse et re-simule jusqu'à la frame courante, avec les meilleures prédictions du moment.
- Le client ne s'avance jamais de plus de `P` frames au-delà de `C` (**fenêtre de prédiction**, 15 frames = 250 ms par défaut). Au-delà, il attend : c'est une « attente », comptée dans les mesures. Il garde donc au plus `P + 1` états sauvegardés, soit 44 Ko avec l’état actuel de `sim-core`.
- Corrections et nouvelles frames sont traitées dans cet ordre à chaque appel : réception, rollback éventuel, puis avance jusqu'à la frame que dicte l'horloge.

### Côté serveur : l'arbitrage

- Le serveur tient, par joueur, la suite des inputs confirmés. Un input reçu est accepté s'il prolonge exactement cette suite ; un trou (message perdu) est comblé par le renvoi redondant du client.
- **Inputs en retard** : quand l'horloge du serveur atteint la frame `f + G` sans que l'input du joueur pour `f` soit arrivé (`G`, la **tolérance**, vaut 8 frames par défaut), le serveur confirme à sa place l'input précédent de ce joueur. L'input réel, s'il arrive ensuite, est ignoré ; son auteur le voit corrigé par un rollback.
- Ainsi un client reçoit l'input confirmé de la frame `f` au plus tard vers `f + G` plus la latence serveur → client. Avec `G = 8` et `P = 15`, un client dont la liaison descendante fait moins de 116 ms (gigue comprise) n'attend jamais à cause d'un autre joueur ; un joueur dont la liaison montante dépasse `(D + G)` frames, soit 166 ms, voit ses inputs remplacés.
- **Déconnexion** : le serveur annonce à tous la frame à partir de laquelle le joueur est absent et confirme pour lui des inputs neutres (0) jusqu'à la fin de la partie, sans attendre la tolérance. Son combattant reste immobile ; `match-rules` décidera plus tard de son sort.
- Le serveur relaie à chacun de ses pas (toutes les 4 ms) ce qui a été confirmé depuis le précédent ; le même pas traite les retards, les déconnexions et les délais d'inactivité (voir « Écarts » : la version initiale relayait à chaque input reçu).

### Synchronisation d'horloge

- Pendant l'attente des joueurs, chaque client envoie un ping toutes les 100 ms, puis toutes les secondes une fois la partie lancée. Chaque échange donne un aller-retour et un écart d'horloge estimé. Le client retient l'écart de l'échange à l'aller-retour le plus court parmi les 16 derniers : c'est le moins faussé par la gigue.
- La partie démarre 2 s après l'arrivée du dernier joueur, à un instant exprimé dans l'horloge du serveur : chaque client a eu le temps d'estimer l'écart.
- L'horloge de jeu du client suit l'estimation **progressivement** (au plus 1 ms de correction par frame simulée, soit 6 %), pour ne pas sauter de frames à chaque nouvelle mesure ; un écart de plus de 250 ms est corrigé d'un coup.
- **Onglet masqué** : le navigateur suspend `requestAnimationFrame`. Au retour, le client rattrape les frames manquées en simulant plusieurs frames par appel (au plus 240 par appel), sans les afficher une à une. Pendant son absence, le serveur a confirmé pour lui la répétition de son dernier input : les autres n'ont pas attendu.

### Protocole

Messages binaires (`ArrayBuffer`, entiers petit-boutistes), premier octet = type. Le message d'entrée porte la version du protocole ; un client d'une autre version est refusé avec un message d'erreur clair.

| Sens | Message | Contenu |
|---|---|---|
| C → S | `HELLO` | version, identifiant de partie (1 à 32 caractères `A-Z a-z 0-9 _ -`), joueurs attendus (2 à 8), joueurs locaux (1 à 4), ticket d’authentification optionnel (voir « Écarts ») |
| S → C | `WAITING` | joueurs présents, joueurs attendus |
| S → C | `START` | graine, nombre de joueurs, emplacements de ce client, instant de départ (horloge serveur), `D`, `P`, `G`, intervalle de checksum |
| C → S | `INPUT` | frontière `connu[p]` du client pour chaque joueur (accusé de réception), puis pour chaque joueur local : première frame, nombre, inputs |
| S → C | `INPUTS` | pour chaque joueur : première frame, nombre, inputs confirmés (y compris ceux du destinataire) |
| C → S | `PING` | heure locale d'envoi |
| S → C | `PONG` | heure locale d'envoi renvoyée, heure du serveur |
| C → S | `CHECKSUM` | frame, empreinte de `S(frame)` confirmé |
| S → C | `DESYNC` | frame, empreinte de chaque joueur |
| S → C | `LEFT` | emplacement, frame à partir de laquelle il est absent |
| S → C | `ERROR` | code (version, partie pleine, partie commencée, message invalide…), texte |

- **Redondance** : chaque `INPUT` reprend tous les inputs locaux non encore accusés ; chaque `INPUTS` reprend, pour chaque joueur, ce que le destinataire n'a pas accusé, dans la limite de 32 frames par joueur et par message. Sur WebSocket rien ne se perd et ce surplus reste de quelques dizaines d'octets ; sur un transport à pertes, c'est ce qui comble les trous sans délai de retransmission.
- **Débit** : un client envoie un `INPUT` par frame simulée. À 8 joueurs, un `INPUTS` pèse environ 100 à 300 octets ; compter de l'ordre de 10 à 20 Ko/s par client dans chaque sens.
- **Validation** : tout message est vérifié (taille, bornes, cohérence) avant usage. Un message invalide ferme la connexion de son auteur côté serveur, et est ignoré côté client. Le décodage ne lève jamais d'exception non rattrapée.

### Détection de désynchronisation

Toutes les 15 frames confirmées (4 fois par seconde), chaque client envoie l'empreinte de l'état `S(n)` correspondant. Le serveur compare les empreintes de tous les clients connectés pour une même frame ; au premier écart, il envoie `DESYNC` à tous et le journalise. Côté client, l'application est prévenue (la démo affiche un bandeau). La partie continue : décider de l'arrêter appartient à l'application.

### Rendu et rollback

Lecture du code de `render` (vérifiée par un test, pas supposée) :

- `capture` réinitialise l'interpolation et recadre la caméra sans adoucissement dès que la frame capturée ne suit pas la précédente. Si le netcode appelait `capture` après chaque frame re-simulée, chaque rollback produirait un saut de caméra.
- Le filtre d'événements ignore bien les frames déjà vues : un rollback ne rejoue aucun effet.

**Contrat retenu** : le netcode ne signale à l'application que les frames **nouvelles** (de numéro supérieur à toutes celles déjà signalées), une fois les re-simulations faites ; l'application appelle `capture` à ce moment-là, et seulement là. Les frames restent consécutives pour le rendu ; une correction se voit comme un petit déplacement d'une image à l'autre.

**Limite constatée, laissée au module `render`** : un effet issu d'une frame mal prédite reste joué (déjà accepté par la spec de `render`), et un effet qui n'apparaît qu'après correction, dans une frame déjà signalée, n'est jamais joué. Avec `D = 2`, la plupart des coups sont connus avant d'être portés (le démarrage d'une attaque dure plusieurs frames), donc le cas reste rare ; il sera chiffré dans les tests de bout en bout et transmis à `render` (et à sa phase audio, menée en parallèle).

## Stack technique

| Élément | Choix |
|---|---|
| Langage | TypeScript 7, mêmes réglages que `sim-core` |
| Client | Navigateur : `WebSocket` natif. Tests : `WebSocket` global de Node.js (présent depuis Node 22) |
| Serveur | Node.js ≥ 24, `node:http`, serveur WebSocket `ws` |
| Démo | Vite, comme `apps/demo` ; le relais s'attache au serveur de développement sur le chemin `/net` (un seul port, joignable depuis le réseau local) |
| Tests | Vitest ; réseau simulé en mémoire à horloge virtuelle ; Playwright avec Edge |
| Dépendances d'exécution | `@game/sim-core`, `@game/input` (types seulement côté module) ; `ws` côté serveur |

## Commandes

```
Tests :                 pnpm --filter @game/netcode test
Bout en bout (Node) :   pnpm --filter @game/netcode test:e2e
Banc du rollback :      pnpm --filter @game/netcode bench
Types :                 pnpm --filter @game/netcode typecheck
Build :                 pnpm --filter @game/netcode build
Serveur relais seul :   pnpm --filter @game/netcode serve -- --port 8787
Démo en ligne :         pnpm --filter @game/online dev        (puis ouvrir l'adresse affichée dans plusieurs onglets)
Test de la démo :       pnpm --filter @game/online test
Lint :                  pnpm lint --fix
```

## Structure du projet

```
packages/netcode/
  src/
    index.ts            → API publique côté client (navigateur et Node)
    constants.ts        → réglages par défaut (D, P, G, intervalles), durée d'une frame
    game.ts             → interface RollbackGame, adaptateur pour sim-core
    timeline.ts         → historique des inputs par joueur, frontières, prédiction (logique pure)
    rollback.ts         → sauvegardes, restauration, re-simulation, fenêtre (logique pure)
    clock.ts            → estimation de l'horloge serveur, correction progressive (logique pure)
    protocol.ts         → encodage et décodage binaires, validation (logique pure)
    client.ts           → session client : connexion, horloge, rollback, envoi, mesures
    transport.ts        → interface Transport, adaptateur WebSocket
    server/
      index.ts          → API publique côté serveur (Node seulement)
      relay.ts          → parties, emplacements, arbitrage, relais, désync (logique pure, sans socket)
      host.ts           → branchement du relais sur un serveur HTTP (WebSocket)
      main.ts           → serveur autonome en ligne de commande
    testing/
      network.ts        → réseau simulé : horloge virtuelle, latence, gigue, pertes, désordre
  test/                 → tests unitaires et de bout en bout simulés
  test/e2e/             → bout en bout sur vrais WebSocket, en local
  bench/
    rollback.bench.ts   → banc bloquant du rollback à 8 joueurs
apps/online/
  index.html
  src/
    main.ts             → formulaire de connexion, boucle en ligne, rendu, diagnostic
    relay-plugin.ts     → attache le relais au serveur de développement Vite
  test/                 → deux onglets d'Edge jouent ensemble (Playwright)
packages/render/test/
  rollback.test.ts      → NOUVEAU FICHIER : vérifie le contrat « Rendu et rollback » contre render
```

Fichiers touchés hors du module : un fichier de test ajouté dans `packages/render/test/` (aucun fichier existant modifié), `.claude/launch.json` (une configuration ajoutée pour la démo en ligne), `pnpm-lock.yaml`. `apps/demo` n'est pas modifiée.

## API publique (contrat)

```ts
// ── Côté client : @game/netcode ──────────────────────────────────────────────

/** Ce que le rollback doit savoir faire d'un jeu. Tout l'état doit passer par save/load. */
export interface RollbackGame {
  readonly players: number;
  readonly stateBytes: number;
  step(inputs: Uint32Array): void;
  save(out: Uint8Array): void;
  load(from: Uint8Array): void;
  checksum(): number;
}

/**
 * Enveloppe une simulation sim-core. `advance` remplace `step` quand l'application ajoute une
 * logique entre les frames (réapparition) ; elle ne doit lire et écrire que l'état de `sim`.
 */
export function simGame(sim: Sim, advance?: (sim: Sim, inputs: Uint32Array) => void): RollbackGame;

/** Canal de messages vers le serveur. `send` peut réutiliser `data` dès son retour. */
export interface Transport {
  send(data: Uint8Array): void;
  close(): void;
  onOpen(listener: () => void): void;
  onMessage(listener: (data: Uint8Array) => void): void;
  onClose(listener: (reason: string) => void): void;
}
export function webSocketTransport(url: string): Transport;

export interface MatchInfo {
  readonly seed: number;
  readonly players: number;
  /** Emplacements tenus par ce client, dans l'ordre de ses joueurs locaux. */
  readonly localSlots: readonly number[];
  readonly inputDelay: number;
  readonly maxPrediction: number;
}

export interface NetClientOptions {
  readonly transport: Transport;
  readonly gameId: string;
  /** Joueurs attendus dans la partie, de 2 à 8. */
  readonly players: number;
  /** Joueurs sur cette machine, de 1 à 4. */
  readonly localPlayers: number;
  /** Horloge en millisecondes : `performance.now` dans le navigateur, horloge virtuelle en test. */
  readonly now: () => number;
}

export function createNetClient(options: NetClientOptions): NetClient;

export interface NetClient {
  readonly status: 'connecting' | 'waiting' | 'starting' | 'running' | 'closed';
  /** Connue à partir de l'état « starting ». */
  readonly match: MatchInfo | null;
  /** À appeler une fois, dès `match` connu, avec un jeu créé pour `match.players` et `match.seed`. */
  begin(game: RollbackGame): void;
  /**
   * À appeler à chaque image. Reçoit, corrige, puis avance jusqu'à la frame que dicte l'horloge.
   * `sample(out)` est appelé une fois par frame simulée et remplit `out[i]` pour le joueur local i
   * (c'est `Input.sample` du module input). `onFrame` est appelé après chaque frame nouvelle,
   * jamais pendant une re-simulation : c'est là qu'il faut appeler `Renderer.capture`.
   * Renvoie la fraction de frame écoulée (de 0 à 1), à passer à `Renderer.draw`.
   */
  update(sample: (out: Uint32Array) => void, onFrame?: () => void): number;
  stats(): NetStats;
  onStatus(listener: (status: NetClient['status']) => void): () => void;
  onDesync(listener: (frame: number) => void): () => void;
  onPlayerLeft(listener: (slot: number, frame: number) => void): () => void;
  close(): void;
}

export interface NetStats {
  frame: number;
  /** Première frame dont un input reste incertain. */
  confirmedFrame: number;
  rttMs: number;
  /** Rollbacks depuis le début, et profondeur maximale et moyenne. */
  rollbacks: number;
  maxRollback: number;
  meanRollback: number;
  /** Images où le client a dû attendre faute d'inputs confirmés. */
  stalls: number;
  /** Inputs locaux remplacés par le serveur pour cause de retard. */
  lateInputs: number;
}

/** Moteur de rollback seul, sans réseau ni horloge : utilisé par le client, testable isolément. */
export function createRollback(options: RollbackOptions): Rollback;

// ── Côté serveur : @game/netcode/server (Node.js seulement) ─────────────────

export interface RelayOptions {
  readonly now: () => number;
  readonly inputDelay?: number;     // 2
  readonly maxPrediction?: number;  // 15
  readonly lateTolerance?: number;  // 8
  readonly checksumInterval?: number; // 15
  readonly onDesync?: (gameId: string, frame: number, checksums: readonly number[]) => void;
}
export function createRelay(options: RelayOptions): Relay;

/** Branche le relais sur un serveur HTTP existant (serveur Vite, ou serveur autonome). */
export function attachRelay(server: import('node:http').Server, relay: Relay, path?: string): RelayHost;
export function startRelayServer(port: number, options?: Partial<RelayOptions>): Promise<RelayHost>;
```

Les noms internes (`RollbackOptions`, `Relay`, `RelayHost`) seront précisés dans le plan ; toute modification de cette surface après validation passe par une mise à jour de cette spec.

## Style de code

```ts
// Logique pure : ni socket, ni horloge, ni DOM. L'horloge et le transport sont injectés.

/** Enregistre les inputs confirmés de `player` à partir de `start`. Renvoie la plus petite
 *  frame déjà simulée dont l'input diffère de celui utilisé, ou -1. N'alloue rien. */
export function confirmInputs(
  t: Timeline,
  player: number,
  start: number,
  inputs: Uint32Array,
  count: number,
  simulated: number,
): number {
  // …
}
```

Conventions :
- Mêmes règles de nommage et de formatage que `sim-core`.
- Tout ce qui peut s'écrire sans socket ni horloge (historique, rollback, estimation d'horloge, protocole, arbitrage du serveur) vit dans des fonctions pures testées ; les fichiers qui touchent au réseau restent minces.
- Aucune allocation dans le chemin d'une frame du rollback (avance, restauration, re-simulation) : historiques et sauvegardes sont des tampons alloués à la création et réutilisés en anneau.
- L'horloge est toujours injectée (`now`) : aucun appel direct à `performance.now` ou `Date.now` hors des points d'assemblage (démo, serveur autonome). C'est ce qui rend les tests de bout en bout reproductibles.
- Le serveur ne fait jamais confiance au client : bornes vérifiées, emplacements contrôlés, taille de message plafonnée.

## Stratégie de test

| Niveau | Quoi | Où |
|---|---|---|
| Unitaire | Protocole (aller-retour de chaque message, messages tronqués, hors bornes ou d'une autre version rejetés sans exception) ; historique et prédiction ; estimation d'horloge (gigue, asymétrie, dérive) ; arbitrage du serveur (attribution des emplacements, retards, déconnexion, désync) | `test/*.test.ts` |
| Propriété | Rollback : quel que soit l'ordre et le retard d'arrivée des inputs confirmés, l'état final et chaque empreinte confirmée égalent ceux d'une simulation directe avec les inputs définitifs (1 000 tirages) | `test/rollback.test.ts` |
| Bout en bout simulé | Serveur et clients dans un même processus, réseau en mémoire à horloge virtuelle : 2 puis 8 clients, latence, gigue, pertes et désordre, horloges qui dérivent ; 10 minutes de jeu à inputs aléatoires ; checksums identiques entre clients et égaux à une rejoue hors ligne du journal du serveur ; aucune désync signalée ; joueur lent, joueur déconnecté, onglet masqué | `test/session*.test.ts` |
| Bout en bout réel | Serveur relais et 2 puis 8 clients Node sur de vrais WebSocket en local, latence artificielle à l'envoi | `test/e2e/` |
| Navigateur | Deux onglets d'Edge rejoignent la même partie de la démo ; une touche dans l'un fait bouger son combattant dans l'autre ; empreintes égales | `apps/online/test/` |
| Rendu | Le contrat « Rendu et rollback » : aucun effet rejoué, interpolation et caméra continues quand seules les frames nouvelles sont capturées | `packages/render/test/rollback.test.ts` |
| Performance | Banc bloquant : rollback de toute la fenêtre à chaque frame, 8 joueurs, 16 entités | `bench/rollback.bench.ts` |
| Manuel | Deux machines du réseau local, ressenti avec la latence réelle | — |

Développement piloté par les tests : chaque comportement du rollback et du serveur commence par un test qui échoue.

## Limites

- **Toujours** : faire passer tests, typecheck, lint et banc avant chaque commit ; écrire le test avant la logique pure ; injecter l'horloge ; dire dans le compte rendu ce qui n'a été vérifié qu'à la main.
- **Demander d'abord** : ajouter une dépendance ; modifier `sim-core`, `render` ou `input` au-delà du fichier de test annoncé ; changer un réglage par défaut validé (`D`, `P`, `G`) ; relever un seuil du banc.
- **Jamais** : faire confiance à un message reçu sans le valider ; laisser un état hors de la simulation influencer `step` ; appeler `capture` du rendu pendant une re-simulation ; masquer une désynchronisation (la partie continue, mais l'écart est toujours signalé) ; modifier `apps/demo`.

## Critères de succès

1. **Sans désync** : dans le réseau simulé, 8 clients jouent 36 000 frames (10 minutes) avec 40 à 120 ms d'aller-retour, 15 ms de gigue, 5 % de pertes et des horloges qui dérivent de ±0,1 % ; tous finissent avec des empreintes identiques, égales à celles d'une rejoue hors ligne, et le serveur ne signale aucune désync. Idem à 2 clients.
2. **Réactif** : dans ces conditions, aucun client n'attend plus de 1 % des frames ; la profondeur moyenne des rollbacks est inférieure à 4 frames.
3. **Robuste** : un joueur à 400 ms d'aller-retour, ou qui se déconnecte, ou dont l'onglet est masqué 10 s, ne fait attendre aucun autre client plus de 1 % des frames ; les empreintes restent identiques ; le client masqué rattrape la partie à son retour.
4. **Budget** : rollback de 15 frames plus une frame nouvelle, à 8 joueurs et 16 entités : moins de 1 ms en moyenne et moins de 2 ms au 99ᵉ centile dans Node ; le tas grandit de moins de 32 Ko sur 10 000 frames de rollback.
5. **Réel** : 8 clients Node sur de vrais WebSocket finissent avec des empreintes identiques ; deux onglets d'Edge jouent ensemble dans la démo, chacun voit l'autre bouger, empreintes égales.
6. **Sûr** : le serveur rejette sans planter les messages invalides (test par messages aléatoires et tronqués) et ignore les inputs d'un emplacement qui n'est pas celui du client.
7. **Rendu** : le test du contrat « Rendu et rollback » passe ; la proportion d'effets manqués ou joués à tort est chiffrée dans le bilan.
8. **Jouable** : vous avez joué à la démo à deux onglets ou deux machines et donné votre avis sur le ressenti.

## Décisions prises à la validation

- **Serveur WebSocket** : bibliothèque `ws`, côté serveur seulement (Node.js 26 n'a qu'un client WebSocket intégré).
- **Réglages par défaut** : délai d'input `D = 2` frames (33 ms), fenêtre de prédiction `P = 15` frames (250 ms), tolérance du serveur `G = 8` frames (133 ms), à ajuster après essai sur le réseau réel.
- **Inputs en retard** : remplacés par l'input précédent du joueur ; les inputs neutres sont réservés aux joueurs déconnectés.

## Écarts et limites constatés pendant l’implémentation

Mis à jour à chaque tâche.

| Sujet | État actuel | Suite prévue |
|---|---|---|
| Ticket d’authentification | `HELLO` porte un ticket opaque optionnel (jusqu’à 1 024 octets), à la demande du module `accounts` (spec en cours) : le relais le reçoit mais ne le vérifie pas. Ajouté dès maintenant pour ne pas changer de version de protocole plus tard. | Vérification par `verifyTicket` de `accounts`, à brancher après sa fusion. |
| Dépendance à `input` | Aucune : le client reçoit une fonction `sample(out)`, que l’application relie à `Input.sample`. Le paquet ne dépend que de `sim-core`. | — |
| Bogue trouvé par le test de propriété | Une correction en attente peut viser une frame antérieure à la frontière confirmée, qui a avancé entre-temps : l’anneau d’inputs écrasait alors les données de cette frame (tirage 242 : 8 joueurs, fenêtre de 2 frames). Corrigé : la plus ancienne frame protégée tient compte de la correction en attente. | — |
| Relais : envois regroupés | Le relais n'envoie plus à chaque input reçu, mais à son pas suivant (toutes les 4 ms) : la spec disait « dans la milliseconde ». Chaque envoi reprend les 3 dernières frames déjà envoyées par joueur, et tout le non-accusé d'un joueur est renvoyé si l'accusé de ce joueur stagne 100 ms. Mesuré à 8 joueurs : 18 Ko/s par client et par sens (contre 50 Ko/s avec un envoi par input reçu et tout le non-accusé à chaque fois), pour environ 0,2 frame de rollback en plus. | — |
| Profondeur des rollbacks (critère n° 2) | La spec visait une moyenne sous 4 frames. Elle suit la latence : un input distant arrive après l'aller de son auteur, le retour vers le client, la gigue, l'attente des images des deux côtés et le pas du relais, moins `D`. Pour des allers-retours de 40 à 120 ms, cela fait environ 4,2 frames : mesuré 4,14 (datagrammes) et 4,40 (WebSocket) à 8 clients, 2,08 à 2 clients. Le test borne donc chaque client par la valeur attendue d'après sa latence, plus une frame. | Critère à reformuler avec vous (voir le bilan). |
| WebSocket et pertes | Sur TCP, une perte bloque tous les messages suivants le temps d'une retransmission rapide (modélisée : deux trajets et 50 ms). Avec 0,5 % de pertes, les clients à plus de 100 ms d'aller-retour attendent jusqu'à 1,5 % de leurs images (seuil du test : 5 %). En datagrammes avec 5 % de pertes : au plus 0,08 %. | WebTransport (datagrammes) quand Node.js le permettra simplement. |
| Modèle « datagrammes » | Seuls les messages de partie (`INPUT`, `INPUTS`, `PING`, `PONG`) y sont perdables ; les messages de contrôle passent par un flux fiable, comme le ferait un client WebTransport. Le premier essai les perdait aussi : deux clients n'avaient jamais reçu `START` (les six autres ont joué sans les attendre). | — |
| Joueur à très forte latence | Au-delà d'environ 280 ms d'aller-retour, l'écho de ses propres inputs sort de la fenêtre de prédiction : il attend en permanence, prend du retard sur l'horloge, et tous ses inputs arrivent trop tard et sont remplacés. Il ne peut donc pas jouer, mais les autres ne l'attendent jamais (mesuré à 400 ms : 0 attente chez les autres). | Refuser ces joueurs dans `lobby`, ou fenêtre plus grande pour eux : à décider. |
| Effets du rendu après rollback (critère n° 7) | Contrat vérifié par `packages/render/test/rollback.test.ts` : capturer les seules frames nouvelles garde caméra et interpolation continues ; capturer une frame re-simulée les remet à zéro ; un coup qui n'apparaît qu'après correction, dans une frame déjà affichée, n'a pas d'effet. Chiffré dans le bout en bout simulé, contre la rejoue hors ligne : 2 clients, 1,4 % d'effets manqués et 0 % joués à tort ; 8 clients, 9,6 % manqués et 7,5 % joués à tort. Les joueurs simulés changent d'input toutes les 4 frames en moyenne, bien plus souvent qu'un humain : ces proportions sont un majorant. | Transmis à `render` (et à sa phase audio) : déclencher les effets sur la frame confirmée, ou annuler ceux d'une frame corrigée, serait à décider dans ce module. |
| API publique | Conforme à la spec, avec quelques ajouts : `MatchInfo` porte aussi `checksumInterval` et `startAt` ; `NetClient` expose `joined` et `error` ; `NetStats` porte `targetFrame` ; `NetClientOptions.ticket` (voir plus haut) ; `stepWithRespawn` et `RESPAWN_FRAMES` exportés pour la démo. | — |
| Démo en ligne en production | `vite build` produit une page statique sans relais : il faut alors lancer `pnpm --filter @game/netcode serve` et ouvrir la page avec `&server=ws://hôte:8787/net`. En développement, le relais est attaché au serveur Vite. | Déploiement : module `app-shell`. |
| Onglet en arrière-plan | Le navigateur suspend `requestAnimationFrame` : un onglet masqué n'avance plus et le serveur confirme pour lui la répétition de son dernier input. Constaté aussi dans le panneau de navigateur de l'environnement de développement quand il est masqué. Au retour, le client rattrape (240 frames par image au plus). | — |

## Bilan des critères de succès (2026-11-14)

| N° | Critère | État | Mesure |
|---|---|---|---|
| 1 | Sans désync | Atteint | Réseau simulé, 36 000 frames, 40 à 120 ms d'aller-retour, 15 ms de gigue, horloges à ±0,1 % : 2 et 8 clients en datagrammes avec 5 % de pertes, 8 clients en WebSocket avec 0,5 % de retransmissions. Toutes les empreintes (2 404 par client) égales à la rejoue hors ligne du journal du relais ; aucune désync signalée (`test/session.test.ts`). Le test témoin montre qu'une désync volontaire est détectée à la première frame de contrôle (`test/session-faults.test.ts`). |
| 2 | Réactif | **Partiel** | Attentes : au plus 0,08 % des images en datagrammes ; en WebSocket, jusqu'à 1,5 % pour les clients au-delà de 100 ms d'aller-retour (blocage en tête de file après une perte), au-dessus du 1 % visé. Profondeur moyenne de l'ensemble des rollbacks : 2,08 frames à 2 clients, mais 4,14 (datagrammes) et 4,40 (WebSocket) à 8 clients, au-dessus des 4 visés. Le seuil était mal calibré : pour ces latences, l'arrivée d'un input distant impose environ 4,2 frames en moyenne (voir « Écarts »). Le test borne chaque client par la profondeur attendue d'après sa latence, plus une frame. **Critère à reformuler avec vous.** |
| 3 | Robuste | Atteint | Joueur à 400 ms : 0 attente chez les trois autres ; déconnexion en pleine partie : les autres jouent jusqu'au bout, empreintes identiques ; onglet masqué 10 s : 0 attente chez les autres, le client masqué rattrape et reste synchronisé. **Limite** : le joueur à 400 ms, lui, ne peut pas jouer (tous ses inputs arrivent trop tard), voir « Écarts ». |
| 4 | Budget | Atteint | Pire cas répété à chaque frame (rollback de 15 frames et une frame nouvelle, 8 joueurs, 16 entités) : 0,055 ms en moyenne, 0,10 ms au 99ᵉ centile (seuils 1 et 2 ms) ; tas +9 Ko sur 10 000 frames (seuil 32 Ko). `pnpm --filter @game/netcode bench`. |
| 5 | Réel | Atteint | 2 et 8 clients Node.js sur de vrais WebSocket en local, latence artificielle de 5 à 45 ms : empreintes identiques à la rejoue du relais, aucune attente (`test:e2e`). Deux contextes d'Edge dans la démo : chacun voit l'autre courir et sauter, 12 empreintes sur 12 égales, aucune erreur de console (`apps/online/test/two-tabs.test.ts`). Capture d'écran vérifiée à la main : le combattant distant se déplace bien à l'écran. |
| 6 | Sûr | Atteint | 10 000 messages aléatoires ou tronqués décodés sans exception ; le relais ferme la connexion d'un message invalide ou inattendu, ignore les inputs d'un emplacement étranger et ceux trop en avance sur son horloge ; sur vrai WebSocket, un client qui envoie n'importe quoi, du texte ou un message trop gros est déconnecté sans gêner la partie. |
| 7 | Rendu | Atteint | Contrat vérifié par `packages/render/test/rollback.test.ts`. Effets comparés à la rejoue hors ligne : 1,4 % manqués et 0 % joués à tort à 2 clients ; 9,6 % manqués et 7,5 % joués à tort à 8 clients, avec des joueurs simulés bien plus nerveux qu'un humain (majorant). Transmis à `render` par une note dans le dossier partagé. |
| 8 | Jouable | **Non vérifié** | En attente de votre essai à deux onglets ou deux machines du réseau local, et de votre avis sur le ressenti. |

Commandes ajoutées pendant l'implémentation :

```
Bout en bout réel :        pnpm --filter @game/netcode test:e2e
Serveur relais seul :      pnpm --filter @game/netcode serve -- --port 8787
Démo en ligne :            pnpm --filter @game/online dev     (relais sur /net, ouverte au réseau local)
Test de la démo en ligne : pnpm --filter @game/online test
```

Fichiers ajoutés en plus de la structure prévue : `test/match.ts` (partie simulée complète), `test/client.test.ts`, `test/session-faults.test.ts`, `vitest.e2e.config.ts`.
