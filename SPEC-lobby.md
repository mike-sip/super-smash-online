# Spec : `lobby` — salons, matchmaking et lancement des parties en ligne

> Statut : **PROPOSÉE le 2026-11-15, en attente de votre validation.** Module de la [carte des capacités](CAPABILITY-MAP.md). Dépend de : `netcode` (implémenté), `match-rules` (implémenté), `accounts` (implémenté). `fighters` et `stages-items` ne sont pas encore fusionnés : le lobby manipule des **identifiants** de personnage et de stage, dont la liste lui est donnée par sa configuration.

## Hypothèses

1. **Un seul processus serveur pour le jeu en ligne.** Hébergement v1 en Europe, sur une machine : le serveur du lobby et le relais de `netcode` tournent dans le même processus Node.js et partagent le même serveur HTTP (`/lobby` et `/net`). Le lobby réserve directement les places d'une partie dans le relais, sans réseau entre eux. Le serveur des comptes reste un processus à part (sa spec le veut ainsi) ; le lobby et le relais ne lisent jamais sa base : ils vérifient ses **tickets**.
2. **Transport : WebSocket, messages JSON.** Le lobby échange peu (quelques messages par seconde au plus) : du JSON texte, versionné et validé strictement, suffit et se lit facilement dans les outils du navigateur. Bibliothèque `ws` côté serveur, déjà utilisée par `netcode` (même version, déjà dans le lockfile).
3. **Un joueur = un compte = un navigateur.** Chaque membre d'un salon est un compte `accounts` (invité compris), connecté depuis un navigateur. Plusieurs joueurs sur la même machine (que `netcode` sait faire) restent hors des salons en v1.
4. **État en mémoire.** Salons, file d'attente et réservations vivent en mémoire du processus : un redémarrage du serveur les perd (les joueurs sont renvoyés au menu). Suffisant pour une instance ; l'état reste derrière des fonctions pures pour pouvoir le déplacer plus tard.
5. **Le serveur ne simule rien.** Comme le veut `netcode`, le résultat d'un match est calculé par les clients (`matchResult` de `match-rules`) et **déclaré** au lobby, qui l'accepte quand les déclarations concordent. La rejoue côté serveur (le relais a tous les inputs) reste possible plus tard pour un classement à enjeu ; voir « Décisions à valider ».
6. **Le contenu est un identifiant.** Le lobby ne charge aucune donnée de personnage ni de stage : il valide des identifiants contre les listes de sa configuration et les transmet. Chaque client construit la `SimConfig` à partir de ces identifiants (registre de contenu de l'application), de la `MatchConfig` et de la graine donnée par le relais.

## Objectif

Permettre à des joueurs de se retrouver et de lancer une partie en ligne : en privé entre amis par un code à partager, ou en public par une file d'attente rapide ; choisir personnage, stage et règles ; jouer sur le relais de `netcode`, en étant authentifiés ; revenir au salon à la fin, avec les résultats, qui sont aussi transmis au futur module `ranking`.

**Utilisateurs** : les joueurs (par la démo en ligne aujourd'hui, par `app-shell` demain), `ranking` (qui recevra les résultats), `app-shell` (qui dessinera les écrans définitifs et déploiera le serveur).

**Succès** : dans trois onglets d'Edge, un joueur crée un salon, les deux autres le rejoignent par le code, chacun choisit son personnage, l'hôte règle le match et lance ; ils jouent, l'un recharge sa page en pleine partie et revient dans le match ; à la fin, tous voient les mêmes résultats et se retrouvent dans le salon, prêts pour une revanche.

### Périmètre fonctionnel

| Domaine | Inclus dans ce module |
|---|---|
| Identité | Connexion au lobby par ticket `accounts` (audience `lobby`), invités compris ; une seule connexion active par compte (la nouvelle remplace l'ancienne) |
| Salons privés | Création avec un code de 6 caractères non devinable ; rejoindre par le code ; capacité de 2 à 8 ; hôte ; expulsion (interdit de retour dans ce salon) ; verrouillage ; état « prêt » ; départ |
| Sélection | Personnage de chaque joueur, équipe en mode équipes, stage (ou « au hasard ») et `MatchConfig` réglés par l'hôte, validés par `validateMatchConfig` |
| Matchmaking rapide | File d'attente par région (`eu` seule en v1, la région existe dans les messages et la configuration), règles fixes, regroupement de 2 à 4 joueurs, refus au-delà d'un aller-retour trop long |
| Lancement | Compte à rebours, réservation des places dans le relais, envoi à chaque membre de tout ce qu'il faut pour construire la partie, échec propre si quelqu'un ne rejoint pas |
| Relais authentifié | Le relais vérifie le ticket `accounts` (audience `relay`) de chaque connexion et n'admet que les joueurs réservés, à leur place ; tickets rejoués refusés ; la connexion libre par identifiant disparaît du serveur de production |
| Robustesse | Déconnexion et reconnexion au lobby (délai de grâce) ; **reconnexion au relais en pleine partie** ; hôte parti ou déconnecté (l'hôte passe à un autre) ; salon vide supprimé ; partie abandonnée détectée |
| Fin de match | Résultats déclarés par les clients, acceptés par concordance ; retour au salon ; résultats gardés dans le salon et transmis par un point d'extension (`onMatchResult`) |
| Abus | Limites de débit par connexion, par compte et par adresse ; tailles de message bornées ; plafonds de salons et de connexions ; tentatives de code limitées |
| Client | Paquet TypeScript pour le navigateur et Node : état du lobby observable, commandes, reconnexion automatique |
| Démo | Écrans minimaux dans `apps/online` : menu (salon privé, rejoindre, partie rapide), salon, partie, résultats |

**Hors périmètre** : écrans définitifs, navigation et options (`app-shell`) ; classement et historique (`ranking`) ; plusieurs joueurs sur une machine dans un salon ; spectateurs ; discussion écrite (pas de modération à opérer) ; liste publique des salons ; amis et invitations ; plusieurs régions déployées et plusieurs processus ; persistance des salons au redémarrage ; déploiement.

## Points de conception

### Architecture

```
navigateur ──HTTP──► serveur des comptes (/api/accounts)   ← tickets « lobby » et « relay »
    │
    ├──WebSocket /lobby (JSON)──► service du lobby ─┐
    │                                               │ réserve les places, est prévenu des événements
    └──WebSocket /net (binaire)──► relais netcode ◄─┘   (même processus)
```

- Le **service du lobby** est une logique pure, comme le relais : il reçoit des connexions abstraites (`send`, `close`) et une horloge injectée. Un hôte mince le branche sur `ws`. Les tests de bout en bout simulés font tourner comptes (tickets signés), lobby, relais et clients dans un même processus, à horloge virtuelle.
- Le serveur de production (`pnpm --filter @game/lobby start`) attache le lobby sur `/lobby` et le relais authentifié sur `/net`. En développement, le greffon Vite de la démo en ligne fait de même, et démarre aussi un serveur des comptes en mémoire si aucun n'est indiqué.

### Identité et connexion au lobby

- Le client demande un ticket `lobby` au serveur des comptes (`AccountsClient.ticket('lobby')`), ouvre `/lobby` et envoie `hello { version, ticket }` dans les 5 s. Le serveur appelle `verifyTicket` (audience `lobby`), refuse un `jti` déjà vu (rejeu) et retient `sub` (identifiant stable), `name` (pseudo) et `guest`.
- **Une connexion active par compte.** Si le compte est déjà connecté, l'ancienne connexion est fermée (« ouverte ailleurs ») et la nouvelle reprend sa place : salon, file d'attente, partie en cours. C'est aussi le chemin de la reconnexion.
- **Délai de grâce** : un membre dont la connexion tombe reste dans son salon, marqué « déconnecté », pendant 30 s (réglable). Revenu à temps, il retrouve tout ; sinon il quitte le salon. Pendant une partie, le délai ne s'applique pas : il reste membre jusqu'à la fin du match (son combattant reste immobile s'il ne revient pas au relais).
- Un ticket ne dure que 60 s : le client en redemande un à chaque connexion ou reconnexion.

### Salons privés

- **Code** : 6 caractères tirés par `crypto.randomInt` dans un alphabet de 30 symboles sans ambiguïté (`ABCDEFGHJKMNPQRSTVWXYZ23456789` : ni `0/O`, ni `1/I/L`, ni `U`), soit 729 millions de codes ; affiché `ABC-DEF` ; saisie tolérante (minuscules, espaces et tirets ignorés). Redessiné en cas de collision. Le code meurt avec le salon.
- **Non devinable en pratique** : avec 2 000 salons ouverts (le plafond par défaut), un essai au hasard a 1 chance sur 365 000 de tomber juste. Les échecs sont limités à 10 par minute et 60 par heure par compte, et autant par adresse IP : une adresse obstinée a moins de 0,4 % de chances par jour de tomber sur un salon quelconque, sans pouvoir viser. L'hôte peut **verrouiller** son salon et **expulser**. Voir « Abus ».
- **Membres** : de 2 à 8 places (8 par défaut, réglable par l'hôte, jamais sous le nombre de membres présents). Ordre d'arrivée conservé : il sert à désigner le prochain hôte.
- **Hôte** : le créateur. Lui seul règle la capacité, le verrou, la `MatchConfig` et le stage, expulse et lance. S'il quitte le salon, ou si son délai de grâce expire, l'hôte passe au membre connecté arrivé le plus tôt ; tous en sont prévenus. Un salon sans membre est supprimé.
- **Expulsion** : hors partie seulement. L'expulsé est retiré et ne peut plus rejoindre ce salon (liste par identifiant de compte, pour la vie du salon).
- **Prêt** : chaque membre non hôte se déclare prêt ; changer de personnage ou d'équipe ne retire pas l'état prêt, mais toute modification des règles par l'hôte remet tout le monde à « pas prêt », pour que personne ne lance sur des règles qu'il n'a pas vues.
- **Lancement** : l'hôte lance quand il y a au moins 2 membres, tous connectés, tous avec un personnage, tous les non-hôtes prêts, et que la configuration est valide pour ce nombre de joueurs (équipes : au moins deux équipes représentées).

### Sélection

- **Personnage** : un identifiant de la liste `content.fighters` de la configuration du serveur, ou `random` (tiré par le serveur au lancement). Le personnage favori du profil `accounts` n'est pas lu par le serveur (il n'a pas la base) ; le client peut le proposer par défaut.
- **Stage** : un identifiant de `content.stages`, ou `random`.
- **Règles** : l'hôte envoie une `MatchConfig` partielle (mode, vies, temps, PV, équipes, tir allié, ultime, objets). Le serveur y met lui-même `players` (un joueur par membre, dans l'ordre des places, avec l'équipe choisie par chacun) et valide le tout par `validateMatchConfig` ; une configuration refusée renvoie les messages d'erreur de `match-rules`.
- **Équipes** : en mode équipes, chaque membre choisit son équipe (0 à 3) ; à l'arrivée, il est placé dans l'équipe la moins remplie.

### Matchmaking rapide

- Le joueur choisit son personnage puis entre dans la file de sa région (`eu`). Une région inconnue ou non déployée est refusée avec un message clair.
- **Règles fixes** de la partie rapide : Stock, 3 vies, 7 minutes, chacun pour soi, ultime et objets activés (fréquence normale), stage au hasard. Réglables par la configuration du serveur, pas par les joueurs.
- **Regroupement** : dès que 4 joueurs attendent, un groupe part ; sinon, quand le plus ancien attend depuis 20 s, tous ceux qui attendent partent ensemble s'ils sont au moins 2. Ordre d'arrivée respecté.
- **Aller-retour** : le lobby mesure l'aller-retour de chaque connexion (pings). Au-delà de 250 ms (médiane des derniers échanges), l'entrée dans la file est refusée : `netcode` a constaté qu'au-delà d'environ 280 ms un joueur ne peut plus jouer (tous ses inputs arrivent en retard). En salon privé, l'aller-retour de chacun est seulement affiché.
- Un groupe formé devient un **salon rapide** : sans code, sans hôte, règles verrouillées. Il se lance seul après un compte à rebours de 5 s. Après le match, ses membres y reviennent ; la revanche part quand tous les membres restants (au moins 2) sont prêts. Chacun peut le quitter librement et retourner dans la file.

### Lancement d'une partie

1. Le serveur fige les choix : tire les `random`, construit la `MatchConfig` finale (déjà validée), attribue à chaque membre une place `0..n-1` (ordre d'arrivée), crée un identifiant de partie aléatoire (16 caractères, alphabet du protocole `netcode`).
2. Il **réserve** la partie dans le relais : nombre de joueurs et identifiant de compte de chaque place, avec une échéance de 20 s.
3. Il envoie à chaque membre `matchStart` : identifiant de partie, chemin du relais, place du membre, `MatchConfig`, stage, et pour chaque place le personnage, le pseudo, le marqueur invité.
4. Chaque client demande un ticket `relay` aux comptes et se connecte au relais (`HELLO` avec ce ticket). La graine vient du relais (`START`), comme aujourd'hui.
5. Si toutes les places ne sont pas prises dans les 20 s, la réservation est annulée, les connectés reçoivent une erreur du relais, et le salon revient à l'état « salon » avec le message « X n'a pas pu rejoindre la partie ». Ce n'est pas un match : rien n'est transmis au classement.

### Relais authentifié (modifications de `netcode`)

Changements **additifs** au relais, sans effet quand l'option n'est pas donnée (les tests et la démo actuels de `netcode` continuent de tourner en mode libre) :

- `RelayOptions.authenticate?: (ticket: string) => { id: string } | null`. Quand elle est fournie, le relais est en **mode réservé** : un `HELLO` doit porter un ticket accepté, viser une partie réservée, et venir d'un compte qui y a une place ; il reçoit **sa** place (et non la première libre). Sinon : erreur `ERR_AUTH` (nouveau code) et fermeture. Le lobby fournit `authenticate` : `verifyTicket` avec l'audience `relay`, plus le refus des `jti` déjà vus.
- `Relay.reserve(gameId, { seats: string[], expiresInMs })`, `Relay.cancel(gameId, reason)` (ferme la partie et ses connexions) et `RelayOptions.onGameEvent?(event)` : `started`, `left` (place, frame), `rejoined` (place, frame), `closed` (plus personne de connecté, ou annulée).
- **Reconnexion en pleine partie** : en mode réservé, un `HELLO` d'un compte dont les places sont marquées absentes dans une partie commencée est accepté. Le relais lui renvoie `START` (même instant de départ, même graine) puis tout l'historique des inputs confirmés depuis la frame `D` ; le client rattrape la partie en simulant sans afficher (comme après un onglet masqué) ; ses inputs comptent de nouveau à partir de la frame où le relais l'a repris, annoncée à tous (`REJOINED`, nouveau message). Pour cela, le relais garde l'historique complet de chaque partie réservée (par blocs de 4 096 frames, environ 115 Ko par minute de jeu à 8 joueurs), libéré à la fermeture de la partie.
- La connexion libre par identifiant (« partie créée par le premier arrivé ») reste dans le relais pour les tests et l'outil `netcode serve`, mais le serveur de production et la démo en ligne passent en mode réservé.

Le détail (messages, version du protocole) sera dans le plan ; toute modification de surface de `netcode` est consignée dans les « Écarts » de `SPEC-netcode.md`. **`sim-core` n'est pas modifié.**

### Pendant la partie et fin du match

- Les membres restent connectés au lobby pendant la partie : le lobby sait qui est là. Le salon passe en phase « partie ».
- **Déconnexion du relais** : le relais confirme des inputs neutres (comportement actuel) et annonce le départ. Le joueur peut revenir tant que la partie dure (rechargement de page : il se reconnecte au lobby, qui lui renvoie `matchStart`, puis au relais).
- **Fin** : chaque client détecte la fin par `matchResult(sim)` **sur un état confirmé** (toutes les frames jusqu'à la fin ont leurs inputs définitifs), et déclare au lobby `{ gameId, résultat }` (classement, gagnants, raison, frame de fin, statistiques par place).
- **Concordance** : le lobby accepte le résultat (`agreed`) quand les déclarations de tous les clients encore connectés au relais à la fin sont identiques **et** que le relais n'a signalé aucune désynchronisation dans cette partie. Désaccord, désync, ou déclarations manquantes 15 s après la première : le match est « contesté » et n'est pas transmis comme résultat officiel. Une déclaration n'est acceptée que d'un membre de la partie, une fois, et doit avoir la forme attendue (bornes, nombre de places).
- **Abandon** : si le relais annonce `closed` (tout le monde parti) sans résultat, ou si le match dépasse sa durée maximale (limite de temps, ou 30 min sans limite, plus 5 min de marge), le match est « abandonné ».
- Dans tous les cas, le relais ferme la partie (`cancel`), le salon revient en phase « salon », les états « prêt » sont remis à zéro, et le dernier résultat (ou le motif d'abandon) est gardé dans le salon et affiché.
- **Transmis au classement** par `LobbyOptions.onMatchResult(record)`, construit côté serveur et jamais par un client : `matchId` (UUID tiré à la création de la partie, clé d'idempotence pour `ranking`, distinct de l'identifiant de partie du relais), `ranked` (vrai en partie rapide, faux en salon privé), identifiant de partie, type de salon (`private` ou `quick`), région, `MatchConfig`, stage, horodatages, statut (`agreed`, `contested`, `abandoned`), et par place : identifiant de compte, pseudo, invité, personnage, résultat (`PlayerResult` de `match-rules`) ou `null`, `leftAtFrame` (frame de départ annoncée par le relais si le joueur est parti sans revenir avant la fin, sinon `null`). Ces champs couvrent le `MatchReport` v1 proposé par `ranking` (note `ranking-interface-for-lobby.md`) : la conversion (`reportFromResult`) et l'envoi (`ranking.submitMatch` en mémoire, ou `POST /api/ranking/v1/matches` signé) se brancheront sur ce point d'extension dans `main.ts` quand `ranking` sera fusionné, sans toucher au service. Le lobby n'écrit rien lui-même dans les comptes : c'est à `ranking` de décider quoi compter (les invités, les matchs contestés…).

### Protocole du lobby

Messages JSON, un objet par message, champ `t` pour le type. Taille maximale 4 Ko (16 Ko pour une déclaration de résultat). Tout champ inconnu, type faux ou valeur hors bornes fait refuser le message : réponse `error` avec un code et un texte en français ; trois messages invalides de suite ferment la connexion.

| Sens | Message | Contenu |
|---|---|---|
| C → S | `hello` | `version`, `ticket` |
| S → C | `welcome` | `you` (id, pseudo, invité), `content` (personnages, stages), `regions`, `quickRules` |
| C → S | `ping` / S → C `pong` | heure du client renvoyée (mesure de l'aller-retour) |
| C → S | `createRoom` | `capacity?` |
| C → S | `joinRoom` | `code` |
| C → S | `leaveRoom` | — |
| C → S | `setFighter` | `fighter` (identifiant ou `random`) |
| C → S | `setTeam` | `team` (0 à 3) |
| C → S | `setReady` | `ready` |
| C → S | `setRules` | `rules` (`MatchConfig` sans `players` ni `version`), `stage`, `capacity`, `locked` — hôte seulement |
| C → S | `kick` | `player` (identifiant de compte) — hôte seulement |
| C → S | `start` | — hôte seulement |
| C → S | `queue` | `region`, `fighter` |
| C → S | `leaveQueue` | — |
| C → S | `result` | `gameId`, `result` |
| S → C | `room` | instantané complet du salon (envoyé à chaque changement) |
| S → C | `roomClosed` | motif (`left`, `kicked`, `expired`, `server`) |
| S → C | `queued` | `region`, joueurs en attente, attente écoulée |
| S → C | `countdown` | secondes avant le lancement |
| S → C | `matchStart` | voir « Lancement d'une partie » |
| S → C | `matchEnd` | statut et résultat accepté (ou motif d'abandon) |
| S → C | `error` | `code`, `message` |
| S → C | `bye` | motif de fermeture (`replaced`, `invalid`, `rate_limited`, `server`) |

L'instantané `room` contient : code (ou `null` pour un salon rapide), type, phase (`lobby`, `countdown`, `playing`), identifiant de l'hôte, capacité, verrou, `MatchConfig` courante, stage, membres (id, pseudo, invité, personnage, équipe, prêt, connecté, aller-retour, place en partie), partie en cours (identifiant, ou `null`) et dernier résultat. Envoyer l'état complet à chaque changement (quelques centaines d'octets) évite toute erreur de mise à jour partielle.

### Abus et limites

| Limite | Valeur par défaut |
|---|---|
| Message | 4 Ko (16 Ko pour `result`) ; JSON invalide ou champ inconnu refusé |
| Débit par connexion | 20 messages par seconde en rafale, 5 par seconde en continu ; au-delà, `bye rate_limited` |
| Connexions simultanées par adresse IP | 16 (une salle de huit joueurs derrière la même box passe) ; IPv6 regroupées par /64, comme dans `accounts` |
| Délai pour `hello` | 5 s |
| Créations de salon | 5 par minute par compte |
| Codes faux | 10 par minute et 60 par heure par compte, autant par adresse IP |
| Entrées et sorties de file | 10 par minute par compte |
| Salons ouverts / connexions | 2 000 / 5 000 au plus ; au-delà, refus poli |
| Tickets | rejeu d'un `jti` refusé (lobby et relais, mémoire de 70 s) |
| Silence | une connexion muette 30 s est fermée (le client envoie un ping toutes les 5 s) |

Les adresses IP ne servent qu'à ces limites, en mémoire, et sont oubliées avec les seaux (même règle que `accounts`). Rien n'est écrit sur disque. Les journaux ne contiennent ni ticket, ni pseudo, ni adresse : type d'événement, code de salon tronqué, nombres.

## Stack technique

| Élément | Choix |
|---|---|
| Langage | TypeScript 7, mêmes réglages que les autres paquets ; serveur exécuté directement par Node 24+ |
| Serveur | `node:http`, `node:crypto`, `ws` (déjà utilisé par `netcode`) ; dépend de `@game/netcode/server`, `@game/accounts/ticket`, `@game/match-rules` |
| Client | `WebSocket` natif (navigateur, et Node 22+ pour les tests) ; dépend de `@game/match-rules` (types et validation) |
| Tests | Vitest ; réseau simulé et horloge virtuelle de `@game/netcode/testing` ; vrais WebSocket en local ; Playwright avec Edge |
| Démo | `apps/online` (Vite) ; ajoute `@game/match-rules`, `@game/accounts-client`, `@game/lobby` (paquets du dépôt) |

**Dépendance à approuver** : `ws` ajoutée au nouveau paquet `@game/lobby` (même version que `netcode`, aucune nouvelle bibliothèque dans le dépôt).

## Commandes

```
Tests :                pnpm --filter @game/lobby test
Bout en bout (Node) :  pnpm --filter @game/lobby test:e2e
Types :                pnpm --filter @game/lobby typecheck
Build :                pnpm --filter @game/lobby build
Serveur :              pnpm --filter @game/lobby start      (lobby + relais ; configuration par variables d'environnement)
Serveur en dev :       pnpm --filter @game/lobby dev        (port 8788, clé de ticket « dev »)
Démo en ligne :        pnpm --filter @game/online dev       (lobby, relais et comptes en mémoire intégrés au serveur Vite)
Test de la démo :      pnpm --filter @game/online test
Tests du relais :      pnpm --filter @game/netcode test
Lint :                 pnpm lint
```

## Structure du projet

```
packages/lobby/                     → @game/lobby
  src/
    protocol.ts      → types des messages, validation stricte, codes d'erreur ; sans import Node (partagé avec le client)
    codes.ts         → codes de salon : tirage, normalisation, affichage (le tirage reçoit sa source d'aléa)
    room.ts          → règles d'un salon : membres, hôte, prêt, sélection, expulsion, verrou, conditions de lancement (pur)
    matchmaking.ts   → file d'attente par région, regroupement (pur, horloge injectée)
    results.ts       → validation des déclarations, concordance, enregistrement transmis au classement (pur)
    limits.ts        → seaux à jetons, clés d'adresse, mémoire des jti (pur, horloge injectée)
    service.ts       → le lobby : connexions, identité, salons, file, lancement, partie, fin (connexions et horloge injectées)
    admission.ts     → `authenticate` du relais : verifyTicket + refus du rejeu
    host.ts          → branchement WebSocket de /lobby et du relais réservé sur un serveur HTTP
    server.ts        → createGameServer : HTTP + lobby + relais, prêt à écouter
    config.ts        → configuration et variables d'environnement
    main.ts, dev.ts  → points d'entrée
    client.ts        → client navigateur et Node : état observable, commandes, reconnexion (sans import Node)
    index.ts         → API publique du serveur
  test/              → unitaires, service à horloge virtuelle, bout en bout simulé
  test/e2e/          → comptes, lobby et relais réels, clients Node sur vrais WebSocket
packages/netcode/src/server/relay.ts   → mode réservé, reconnexion, événements (additif)
packages/netcode/src/protocol.ts       → ERR_AUTH, message REJOINED
packages/netcode/src/client.ts         → reprise d'une partie commencée (rattrapage de l'historique)
packages/netcode/test/                 → tests du mode réservé et de la reconnexion (fichiers ajoutés)
apps/online/
  src/main.ts        → assemble menu, salon, partie et résultats
  src/lobby-ui.ts    → écrans minimaux du lobby (DOM, textContent seulement)
  src/content.ts     → registre de contenu : identifiant → FighterDef / StageDef
  src/match.ts       → partie en ligne : SimConfig par match-rules, boucle netcode, HUD, fin
  src/dev-plugin.ts  → remplace relay-plugin.ts : lobby + relais réservé + comptes en mémoire sur le serveur Vite
  test/              → plusieurs onglets d'Edge : salon, partie, reconnexion, retour au salon
```

Fichiers touchés hors du module : ceux de `netcode` listés ci-dessus, `apps/online` (la connexion par identifiant y est remplacée par le lobby), `.claude/launch.json` (rien à changer : la configuration `online` reste valable), `pnpm-lock.yaml`. `apps/demo`, `sim-core`, `accounts`, `match-rules` et `render` ne sont pas modifiés.

## API publique (contrat)

```ts
// ── @game/lobby (serveur, Node.js) ──────────────────────────────────────────────────────────

export interface LobbyContent {
  readonly fighters: readonly string[];   // identifiants valides ; « random » est réservé
  readonly stages: readonly string[];
}

export interface LobbyOptions {
  readonly now: () => number;
  readonly relay: Relay;                  // relais en mode réservé
  readonly relayPath: string;             // ex. « /net », transmis aux clients
  readonly verifyTicket: (ticket: string) => TicketIdentity | null; // audience « lobby », rejeu refusé
  readonly content: LobbyContent;
  readonly regions?: readonly string[];   // défaut ['eu']
  readonly quick?: Partial<QuickMatchSettings>;
  readonly limits?: Partial<LobbyLimits>;
  readonly random?: (max: number) => number;   // défaut crypto.randomInt ; injecté en test
  readonly onMatchResult?: (record: MatchRecord) => void;   // point d'extension pour ranking
  readonly log?: (message: string) => void;
}

export function createLobby(options: LobbyOptions): Lobby;

export interface Lobby {
  /** Nouvelle connexion ; `address` sert aux limites par adresse. */
  connect(conn: LobbyConnection, address: string): LobbyPeer;
  /** À appeler souvent (toutes les 100 ms) : délais de grâce, file, comptes à rebours, échéances. */
  tick(): void;
  stats(): { connections: number; rooms: number; queued: number; playing: number };
}

export interface MatchRecord {
  readonly matchId: string;                 // UUID, clé d'idempotence pour ranking
  readonly ranked: boolean;                 // partie rapide : vrai ; salon privé : faux
  readonly gameId: string;
  readonly kind: 'private' | 'quick';
  readonly region: string;
  readonly config: MatchConfig;
  readonly stage: string;
  readonly startedAt: number;              // ms, horloge du serveur
  readonly endedAt: number;
  readonly status: 'agreed' | 'contested' | 'abandoned';
  readonly players: readonly {
    readonly accountId: string;
    readonly name: string;
    readonly guest: boolean;
    readonly fighter: string;
    readonly result: PlayerResult | null;   // null si contesté ou abandonné
    readonly leftAtFrame: number | null;    // parti sans revenir avant la fin
  }[];
  readonly winners: readonly number[];      // places ; vide si contesté ou abandonné
}

/** Serveur complet : HTTP, lobby sur /lobby, relais réservé sur /net. */
export function createGameServer(config: GameServerConfig): GameServer;

// ── @game/lobby/client (navigateur et Node) ─────────────────────────────────────────────────

export function createLobbyClient(options: {
  url: string;                                        // ws(s)://hôte/lobby
  getTicket: () => Promise<string | null>;            // AccountsClient.ticket('lobby')
  now: () => number;
  WebSocket?: typeof WebSocket;
}): LobbyClient;

export interface LobbyClient {
  readonly state: LobbyState;                          // connexion, moi, salon, file, partie, erreur
  onChange(listener: (state: LobbyState) => void): () => void;
  onMatchStart(listener: (match: MatchStartInfo) => void): () => void;
  createRoom(capacity?: number): void;
  joinRoom(code: string): void;
  leaveRoom(): void;
  setFighter(fighter: string): void;
  setTeam(team: number): void;
  setReady(ready: boolean): void;
  setRules(rules: RoomRules): void;
  kick(player: string): void;
  start(): void;
  queue(region: string, fighter: string): void;
  leaveQueue(): void;
  reportResult(gameId: string, result: MatchResult): void;
  close(): void;
}
```

Le client se reconnecte seul après une coupure (attente croissante de 0,5 à 8 s, avec un nouveau ticket à chaque essai) et réémet `matchStart` si une partie est en cours à son retour. Il ne lève jamais d'exception : les refus arrivent dans `state.error`. Les noms internes (`LobbyConnection`, `LobbyPeer`, `LobbyState`, `RoomRules`, `MatchStartInfo`, `GameServerConfig`) seront précisés dans le plan ; toute modification de cette surface après validation passe par une mise à jour de cette spec.

Variables d'environnement de `main.ts` : `LOBBY_HOST`, `LOBBY_PORT`, `ACCOUNTS_TICKET_SECRETS` (mêmes clés que le serveur des comptes), `LOBBY_FIGHTERS`, `LOBBY_STAGES` (listes séparées par des virgules), `LOBBY_TRUST_PROXY`. Le serveur refuse de démarrer sans clé de ticket ni contenu.

## Style de code

```ts
// Règle de salon : pure, sans socket ni horloge ; renvoie un refus typé plutôt que de lever.

/** Expulse `target` du salon. Seul l'hôte le peut, hors partie, et jamais lui-même. */
export function kick(room: Room, by: string, target: string): Outcome {
  if (room.host !== by) return refuse('not_host');
  if (room.phase !== 'lobby') return refuse('wrong_phase');
  if (target === by || !room.members.has(target)) return refuse('bad_request');
  room.members.delete(target);
  room.banned.add(target);
  return ok();
}
```

Conventions :
- Mêmes règles de nommage et de formatage que les autres paquets ; documentation et messages en français, code en anglais.
- Les règles (salon, file, concordance, limites, codes, validation des messages) sont des fonctions pures testées seules ; `host.ts`, `server.ts` et `main.ts` restent minces.
- Horloge et aléa toujours injectés : aucun `Date.now`, `performance.now` ni `Math.random` hors des points d'assemblage.
- Le serveur ne fait jamais confiance au client : chaque message est validé avant usage ; chaque action vérifie le rôle et la phase.
- Le DOM de la démo n'est écrit que par `textContent` (pseudos et codes viennent d'autres joueurs).

## Stratégie de test

| Niveau | Quoi | Où |
|---|---|---|
| Unitaire | Protocole (chaque message accepté, chaque champ inconnu, type faux, borne dépassée refusés sans exception ; 10 000 messages aléatoires) ; codes (alphabet, longueur, normalisation, collisions) ; salon (chaque règle et chaque refus : hôte, expulsion, verrou, prêt remis à zéro, capacité, équipes, conditions de lancement, passation d'hôte) ; file (regroupement à 4, à 20 s, région inconnue, aller-retour refusé) ; concordance (unanime, majorité après délai, contesté, déclaration d'un intrus, en double, mal formée) ; limites (seaux, jti, adresses) | `packages/lobby/test/` |
| Relais | Mode réservé : ticket refusé, partie non réservée, compte sans place, place attribuée, réservation expirée, annulation, événements ; reconnexion en pleine partie : le revenant rattrape et finit avec les mêmes empreintes que les autres ; tous les tests existants de `netcode` inchangés | `packages/netcode/test/` |
| Service | Le lobby seul, connexions factices et horloge virtuelle : chaque parcours (créer, rejoindre, choisir, prêt, lancer, déclarer, revenir) et chaque protection (rejeu de ticket, connexion remplacée, délai de grâce, hôte parti, salon vide supprimé, expulsé qui revient, codes faux limités, débit) | `packages/lobby/test/` |
| Bout en bout simulé | Comptes (tickets signés), lobby, relais et 2 à 8 clients complets (client du lobby + client netcode + simulation `match-rules`) dans un même processus, réseau en mémoire à horloge virtuelle : salon privé puis partie rapide ; matchs courts jusqu'à la fin ; résultats concordants transmis à `onMatchResult` ; retour au salon puis revanche ; un joueur coupé et revenu dans le salon, un autre en pleine partie ; l'hôte qui part ; un joueur qui ne rejoint jamais le relais | `packages/lobby/test/` |
| Bout en bout réel | Vrai serveur des comptes, vrai serveur de jeu (lobby + relais) sur un port libre, 3 clients Node sur de vrais WebSocket : créer, rejoindre, choisir, lancer, finir un match en mode Temps de 30 s, revenir au salon | `packages/lobby/test/e2e/` |
| Navigateur | Trois contextes d'Edge sur la démo en ligne : création, code partagé, choix, lancement, une page rechargée en pleine partie qui revient, fin, mêmes résultats partout, retour au salon ; aucune erreur de console | `apps/online/test/` |
| Manuel | Deux machines du réseau local ; ressenti des écrans | — |

Développement piloté par les tests : chaque règle pure et chaque comportement du service commencent par un test qui échoue.

## Limites

- **Toujours** : faire passer tests, typecheck et lint avant chaque commit ; écrire le test avant la logique ; injecter horloge et aléa ; valider chaque message reçu ; dire dans le compte rendu ce qui n'a été vérifié qu'à la main ; faire une relecture de sécurité avant le dernier point de contrôle.
- **Demander d'abord** : ajouter une dépendance ; modifier `sim-core` ; changer un réglage par défaut validé de `netcode` (`D`, `P`, `G`) ; changer le format des tickets de `accounts` ; enregistrer une donnée personnelle sur disque.
- **Jamais** : faire confiance à un message ou à un résultat déclaré sans le valider ; admettre au relais un joueur sans ticket valide en mode réservé ; écrire dans le DOM par `innerHTML` ce qui vient d'un autre joueur ; journaliser un ticket, un pseudo ou une adresse ; modifier `apps/demo` ou la ligne « Specs existantes » de la carte ; toucher au code de `accounts` (la session `ranking` l'étend en parallèle).

## Critères de succès

1. **Salons privés** : créer, partager le code, rejoindre, choisir personnage et équipe, régler stage et règles, se déclarer prêt, expulser, verrouiller, lancer : chaque règle et chaque refus couverts par un test qui passe.
2. **Matchmaking** : 2 à 4 joueurs de la file `eu` sont regroupés selon les règles (4 tout de suite, au moins 2 après 20 s) ; région inconnue et aller-retour de plus de 250 ms refusés ; la région figure dans les messages, la configuration et les enregistrements.
3. **Authentifié** : en mode réservé, le relais refuse une connexion sans ticket, avec un ticket expiré, falsifié, rejoué ou d'une autre audience, ou d'un compte sans place ; chaque joueur admis occupe la place que le lobby lui a réservée ; la démo en ligne n'utilise plus la connexion par identifiant.
4. **Partie complète** : dans le bout en bout simulé, 8 clients passent par le salon, jouent un match jusqu'à sa fin, reçoivent le même résultat, reviennent au salon et relancent une revanche ; `onMatchResult` reçoit un enregistrement `agreed` conforme à `matchResult`. Idem en partie rapide.
5. **Robuste** : un membre coupé 10 s retrouve son salon ; coupé plus de 30 s, il en sort ; un joueur dont la page est rechargée en pleine partie revient dans le match, rattrape et finit avec les mêmes empreintes que les autres (rattrapage de 5 minutes de jeu en moins de 20 s dans Node) ; l'hôte qui part ou se déconnecte est remplacé ; un salon vide disparaît ; un joueur qui ne rejoint pas le relais annule proprement le lancement ; une partie abandonnée est close et signalée.
6. **Résistant aux abus** : 10 000 messages aléatoires, tronqués ou trop gros n'arrêtent pas le serveur ; débit, codes faux, créations et connexions par adresse limités comme prévu ; une déclaration de résultat d'un intrus, en double ou discordante ne change pas le résultat accepté ; les codes sont tirés par `crypto.randomInt` dans l'alphabet prévu.
7. **Réel** : 3 clients Node sur de vrais WebSocket, avec un vrai serveur des comptes, font tout le parcours ; dans Edge, trois onglets font le parcours de l'objectif, rechargement compris, sans erreur de console.
8. **Non-régression** : tous les tests existants de `netcode`, `accounts`, `match-rules` et de la démo locale passent inchangés ; le relais sans `authenticate` se comporte exactement comme avant.
9. **Relu** : une relecture de sécurité est faite et consignée, ses constats corrigés ou expliqués.
10. **Jouable** : vous avez fait le parcours dans la démo en ligne et donné votre avis sur les écrans.

## Décisions à valider

Choix par défaut proposés ; dites-moi ceux à changer.

1. **Lobby et relais dans un même processus** (hypothèse 1), avec réservation directe. Alternative : processus séparés et un « laissez-passer » signé par le lobby pour le relais ; plus extensible, plus de code, inutile pour une seule machine.
2. **Résultats déclarés par les clients, acceptés par concordance** (hypothèse 5). Alternative pour un classement à enjeu : le serveur rejoue la partie à partir des inputs du relais (coût : un processeur pendant quelques secondes par match ; il faudrait le contenu des personnages côté serveur). Je propose de garder la concordance en v1 (déclarations identiques et aucune désync signalée par le relais), que `ranking` accepte comme minimum dans sa proposition, et d'ajouter la rejoue serveur après la fusion de `fighters` et `stages-items` si vous la jugez nécessaire. `ranking` préfère la rejoue : c'est à vous de trancher.
3. **Reconnexion en pleine partie** par rejeu de l'historique des inputs (ni instantané d'état transmis d'un pair, ni serveur qui simule). Coût : l'historique de chaque partie en mémoire du relais, jusqu'à la fin du match.
4. **Codes de 6 caractères** (729 millions) avec limitation des essais, plutôt que 8 (plus sûrs, moins pratiques à dicter).
5. **Partie rapide** : règles fixes (Stock 3 vies, 7 min, chacun pour soi, ultime et objets), groupes de 2 à 4 joueurs, 20 s d'attente avant de partir à moins de 4, refus au-delà de 250 ms d'aller-retour.
6. **Délai de grâce** de 30 s dans un salon ; aucun délai pendant une partie (on reste membre jusqu'à la fin du match).
7. **Invités** : admis partout, y compris en partie rapide ; le marqueur invité est transmis au classement, qui décidera de les compter ou non.
8. **Dépendance** : `ws` dans le nouveau paquet `@game/lobby`.
