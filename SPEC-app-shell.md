# Spec : `app-shell` — l'application du jeu, son assemblage et son déploiement

> Statut : **APPROUVÉE le 2026-11-17** (décisions par défaut retenues, nom « Fracas »). Module de la [carte des capacités](CAPABILITY-MAP.md), dernier de la v1 (jalon 4 : v1 publique). Dépend de : tous les autres modules, implémentés et fusionnés (`sim-core`, `input`, `render` avec l'audio, `fighters`, `stages-items`, `match-rules`, `netcode`, `accounts`, `lobby`, `ranking`). Plan et tâches : `tasks/app-shell/plan.md` et `todo.md`, rédigés après validation de cette spec.

## Hypothèses

1. **Une nouvelle application, la démo reste.** Le jeu est une application Vite à part, `apps/game` (paquet `@game/app`). `apps/demo` (outil de développement : panneaux, raccourcis, réglage des personnages) et `apps/online` (démo du lobby) restent tels quels et continuent de passer leurs tests. L'application reprend leurs idées, pas leur code de panneaux : les écrans de la démo sont faits pour un développeur, pas pour un joueur.
2. **DOM et TypeScript, sans framework.** Les menus sont du HTML sémantique (boutons, listes, titres) superposé au canvas WebGL, écrit par `textContent` et `createElement`. Pas de React ni de bibliothèque d'interface : aucune dépendance ajoutée. La logique (pile d'écrans, navigation, réglages, construction d'un match) est faite de fonctions pures testées dans Node ; le DOM reste mince.
3. **Combat local sans IA.** Les bots sont hors v1 (carte, hypothèse 3). Le combat local se joue donc à 2 à 4 humains sur la même machine (un clavier, des manettes), plus un mode **Entraînement** : un joueur contre 1 à 7 mannequins immobiles (ou qui répètent une action simple, comme dans la démo), sans règle de fin. Un mannequin n'est pas une IA : il ne choisit rien.
4. **En ligne : un joueur par navigateur**, comme le veut `lobby`. Connexion invité automatique au premier passage par « En ligne » ; compte par pseudo et mot de passe facultatif.
5. **Trois processus en production, une machine en Europe** : un serveur web en frontal (TLS, fichiers statiques du client, proxy inverse), le serveur des comptes avec le classement (`@game/ranking`, qui héberge `accounts`), et le serveur de jeu (lobby + relais, `@game/lobby`). Même domaine pour tout : `/` (client), `/api/accounts` et `/api/ranking` (comptes), `/lobby` et `/net` (jeu). C'est l'architecture que les specs de `lobby` et `ranking` supposent déjà.
6. **Rien n'est déployé sans vous.** Je prépare la configuration, les conteneurs, les scripts et la marche à suivre ; ouvrir un compte chez un hébergeur, payer, acheter un nom de domaine et lancer le premier déploiement sont des actions que je vous demanderai avant de les faire, ou que vous ferez.
7. **Docker n'est pas installé sur cette machine.** Les fichiers de conteneur seront écrits et relus, mais leur construction ne pourra pas être vérifiée ici. Ce qui sera vérifié : le build de production, et les vrais processus serveur lancés depuis ce build derrière une passerelle locale qui reproduit les routes du frontal (voir « Stratégie de test »).

## Objectif

Faire du projet un jeu qu'un joueur peut ouvrir dans son navigateur et utiliser sans rien connaître de sa fabrication : un écran titre, des menus clairs au clavier comme à la manette, un combat local complet, le jeu en ligne (salons par code, partie rapide), son classement et son profil, des options ; puis tout assembler, le construire pour la production et le rendre prêt à être hébergé en Europe.

**Utilisateurs** : les joueurs ; vous, qui déploierez et exploiterez le serveur.

**Succès** : dans Edge, un joueur ouvre le jeu, passe l'écran titre, fait un combat local jusqu'aux résultats ; dans deux onglets, deux joueurs inscrits passent par la partie rapide, jouent un match jusqu'au bout et voient tous deux leurs résultats, puis leur cote et leur historique mis à jour dans « Profil ». Le tout sur le build de production servi par les vrais serveurs, sans erreur de console, et entièrement faisable sans souris.

### Périmètre fonctionnel

| Domaine | Inclus dans ce module |
|---|---|
| Intégration `lobby` → `ranking` | **En premier.** Le serveur de jeu transmet chaque match `agreed` au classement : `reportFromResult`, `POST /api/ranking/v1/matches` signé (`signReport`, `RANKING_REPORT_SECRETS`), renvois en cas d'échec avec le même `matchId` et un `reportedAt` recalculé. Test de bout en bout réel |
| Écran titre | Nom du jeu, « Appuyez sur une touche », musique ; puis menu principal : Combat local, En ligne, Profil et classement, Options, Crédits |
| Navigation | Clavier (flèches, Entrée, Échap, Tab), manette (croix ou stick, A valide, B revient, Start) et souris ; focus toujours visible ; retour en arrière cohérent ; sons de menu |
| Combat local | Rejoindre en appuyant sur son périphérique (2 à 4 joueurs) ; choix des personnages (chaque joueur sur sa carte, avec son périphérique) et des équipes ; choix du stage (aperçu, description, dangers) ; règles (mode, vies, temps, PV, équipes, tir allié, ultime, objets) avec préréglages ; combat ; pause ; résultats ; revanche ou retour |
| Entraînement | Un joueur, personnage et stage au choix, 1 à 7 mannequins (immobiles, sauteurs, bouclier) ; pause avec remise à zéro |
| En ligne | Connexion (invité automatique, connexion, inscription, conversion d'invité) ; salon privé : créer, code affiché et copiable, lien d'invitation, rejoindre par code, choix du personnage et de l'équipe, prêt, règles et stage par l'hôte, expulsion, verrou ; partie rapide : file `eu`, attente affichée, annulation ; match en ligne ; résultats ; retour au salon |
| Profil et classement | Mon profil (pseudo, invité ou inscrit, cote ou « provisoire », rang, statistiques par personnage) ; mon historique ; tableau du classement paginé avec ma position ; gestion du compte (pseudo, mot de passe, déconnexion, suppression avec confirmation) |
| Options | Commandes (remappage clavier et manette par l'API d'`input`, réglages analogiques, saut au stick, réinitialisation) ; son (activé, musique, effets) ; affichage (plein écran, résolution de rendu, taille du texte, mouvements réduits, compteur d'images) ; tout est gardé dans le navigateur |
| Erreurs visibles | Serveur injoignable, connexion au lobby perdue puis rétablie, relais perdu, joueur parti ou revenu, désynchronisation, lancement annulé, salon fermé, compte refusé, ticket impossible : chaque cas a un message en français et une action (réessayer, retour au menu) |
| Assemblage et build | Build de production du client (fichiers statiques, empreintes dans les noms, en-têtes de sécurité) ; points d'entrée de production des serveurs, configurés par variables d'environnement |
| Déploiement | `deploy/` : fichiers de conteneur des deux serveurs, composition avec le frontal, configuration du frontal (TLS automatique, routes, en-têtes, blocage externe de la route des rapports), modèle de variables, script de génération des clés, vérifications de santé, journaux, sauvegarde des bases SQLite ; `DEPLOIEMENT.md` pas à pas |
| Relecture | Relecture de sécurité des serveurs assemblés et du frontal avant le dernier point de contrôle |

**Hors périmètre** : IA et bots ; mode solo ou aventure ; spectateurs et replays ; mobile et tactile ; plusieurs régions et plusieurs instances ; amis, invitations par compte, discussion ; traduction en d'autres langues que le français (les textes sont regroupés pour la permettre plus tard) ; rejoue des matchs côté serveur (décision de `lobby`, concordance en v1) ; l'achat et l'ouverture effective de l'hébergement (à vous) ; intégration continue chez un service tiers.

## Points de conception

### Architecture du client

```
apps/game
  main.ts ─► App : pile d'écrans, services partagés (input, audio, comptes, lobby, classement, réglages)
               │
               ├─ écrans DOM (titre, menus, sélection, options, profil, salon, résultats, erreurs)
               └─ « scène de combat » : boucle à pas fixe locale, ou boucle netcode en ligne,
                  rendu `render`, HUD de `render`, audio, détection de fin par `match-rules`
```

- **Pile d'écrans pure** (`screens.ts`) : `push`, `replace`, `back`, `reset` ; chaque écran déclare ce que fait « retour » (revenir, demander confirmation, ou rien pendant un compte à rebours). Testée dans Node.
- **Un seul canvas et un seul renderer à la fois**, recréés à chaque match comme dans la démo. Derrière les menus, le canvas montre une scène calme (stage du dernier match ou belvédère, caméra lente) ou reste vide si « mouvements réduits » est choisi ; le coût de cette scène est mesuré.
- **Le combat local et l'entraînement** reprennent la boucle de la démo (pas fixe 60 Hz, au plus 5 pas par image, rendu interpolé) ; **le combat en ligne** reprend celle de `apps/online` (netcode, déclaration du résultat sur un état confirmé). Les deux sont réécrites dans `apps/game` pour ajouter le style des personnages, l'audio, la pause, le HUD et la fin vers l'écran de résultats ; les démos ne sont pas modifiées.
- **Construction d'un match** (`content.ts`, pur) : à partir d'identifiants (personnages de `fighters`, stage de `stages-items`) et d'une `MatchConfig`, une seule fonction produit la `SimConfig` (`buildMatchConfig`, `applyStage`, `applyItems`, `createMatchSimConfig`). Elle sert au local et à l'en ligne : deux navigateurs qui reçoivent le même `matchStart` construisent la même configuration, ce qu'un test vérifie par empreinte.
- **Le serveur de jeu reçoit la vraie liste de contenu** (les 4 personnages, les 4 stages) au lieu des combattants de test de la démo en ligne. La partie rapide garde ses règles fixes (Stock, 3 vies, 7 min, ultime et objets).

### Navigation au clavier et à la manette

- Les éléments interactifs sont de vrais `<button>`, `<input>` et listes, dans l'ordre de lecture : le clavier et les lecteurs d'écran fonctionnent sans code particulier. Les flèches déplacent le focus dans une grille ou une liste (`nav.ts`, pur : prochain élément dans une direction, d'après les positions à l'écran), Entrée valide, Échap revient.
- **Manette dans les menus** : `menu-pad.ts` lit `navigator.getGamepads()` à chaque image hors combat, en disposition standard : croix et stick gauche (avec répétition après un délai) déplacent le focus, A valide, B revient, Start ouvre ou ferme la pause. Il ne touche pas aux dispositions de jeu d'`input` ; une manette non standard navigue au stick et valide avec le premier bouton. Pendant un combat, seul `input` lit les manettes ; la pause se lit sur Start (manette) ou Échap (clavier).
- **Plusieurs joueurs dans un même écran** (sélection locale) : chaque périphérique rejoint en appuyant (événement `onJoinRequest` d'`input`) et ne commande que sa carte : gauche et droite changent le personnage, haut et bas l'équipe, A le déclare prêt, B annule ou fait quitter. Le premier joueur arrivé choisit ensuite le stage et les règles.
- **Lisibilité** : contraste d'au moins 4,5:1 pour tout texte (vérifié par un test sur la palette), focus marqué par un contour épais et une couleur, cible d'au moins 44 px, aucune information portée par la couleur seule (équipes : couleur et numéro), textes en `rem` avec l'option « grand texte », annonces importantes (erreurs, compte à rebours, adversaire parti) dans une région `aria-live`, animations réduites si le système le demande ou si l'option est cochée.

### Combat local

- **Rejoindre** : le clavier tient le joueur 1 ; une manette actionnée prend la première place libre, comme dans la démo. Au moins 2 joueurs (sauf Entraînement). Quatre joueurs locaux au plus (`MAX_LOCAL_PLAYERS` d'`input`).
- **Règles** : les champs de `MatchConfig`, validés par `validateMatchConfig` (les messages d'erreur de `match-rules` sont affichés). Préréglages : « Classique » (Stock 3 vies, 7 min, objets normaux), « Chrono » (Temps 2 min), « Endurance » (150 PV), et les derniers réglages utilisés, gardés dans le navigateur.
- **Pause** (Start ou Échap) : reprendre, recommencer, commandes (lecture seule), quitter vers la sélection. La simulation s'arrête ; la musique baisse.
- **Résultats** : classement, vainqueurs, KO, chutes, dégâts infligés et reçus par joueur, raison de la fin ; « Revanche » (mêmes réglages), « Changer de personnages », « Menu ».

### En ligne

- **Connexion** : à l'entrée dans « En ligne », session existante ou invité créé sans question ; un bandeau dit « Vous jouez en invité : votre cote n'est pas enregistrée » avec « Créer un compte » (conversion, qui garde l'historique) et « Se connecter ». Les mots de passe ne sont jamais gardés par l'application.
- **Salon privé** : écrans définitifs pour tout ce que le client du lobby permet. Code affiché `ABC-DEF`, bouton « Copier » et lien `…/#rejoindre=ABCDEF` (le code ne quitte jamais le domaine ; ouvrir le lien mène à la connexion puis au salon). Liste des membres (pseudo, invité, personnage, équipe, prêt, connecté, aller-retour), réglages de l'hôte, motifs de refus de lancement visibles avant d'appuyer.
- **Partie rapide** : choix du personnage, entrée en file, temps d'attente et nombre de joueurs en attente, annulation ; refus clairs (aller-retour trop long, région).
- **Match** : HUD de match, pseudos au-dessus des combattants (HUD existant), messages discrets « X a quitté la partie », « X est revenu ». Échap ouvre « Quitter la partie ? » sans arrêter le jeu (il n'y a pas de pause en ligne). Une page rechargée en pleine partie y revient (le client du lobby renvoie `matchStart`).
- **Fin** : écran de résultats commun, puis retour au salon (privé ou rapide) ; un match `contested` ou `abandoned` est expliqué (« Les résultats ne concordent pas : match non compté »).

### Erreurs visibles pour le joueur

Un module (`errors.ts`, pur) traduit chaque état d'erreur des clients (`accounts-client`, client du lobby, `NetClient`, client du classement) en message français et en actions proposées. Principes : jamais de message technique brut, jamais d'écran bloqué sans issue, reconnexion automatique quand le client la fait déjà (le lobby se reconnecte seul ; le bandeau montre « Reconnexion… » puis disparaît), retour au menu en dernier recours. Une erreur non prévue du code (exception) est attrapée au niveau de l'application : écran « Une erreur est survenue » avec « Recharger », sans détail technique à l'écran (la console garde la trace).

### Options

| Groupe | Réglages | Stockage |
|---|---|---|
| Commandes | Disposition clavier et manette par joueur (capture, conflits refusés par `setBindings`, noms par `describe`), zones mortes, saut au stick, réinitialiser | Celui d'`input` (déjà persistant) |
| Son | Activé, volume de la musique, volume des effets, sons de menu | `localStorage`, clé versionnée |
| Affichage | Plein écran, résolution de rendu (densité de pixels plafonnée à 1, 1,5 ou 2), grand texte, mouvements réduits, compteur d'images | `localStorage`, clé versionnée |

Un réglage stocké illisible ou d'une autre version est ignoré (valeurs par défaut), jamais une cause de plantage. Sans `localStorage` (navigation privée stricte), le jeu fonctionne avec les défauts.

### Nom du jeu

Un nom original est nécessaire pour l'écran titre, le titre de la page et le domaine. Il vivra dans une seule constante. Propositions (à vérifier par vous côté marques et noms de domaine, je ne peux pas le faire de façon fiable) :

1. **Fracas** — court, français, dit le genre (« le fracas des combats »). Ma recommandation.
2. **Éjecta** — d'après l'éjection hors du stage, mécanique centrale ; sonne bien dans plusieurs langues.
3. **Tumulte** — plus léger, ton « fête entre amis ».

### Intégration `lobby` → `ranking` (premier point)

- Nouveau fichier `packages/lobby/src/ranking-report.ts` : un **expéditeur** pur à horloge et `fetch` injectés. `submit(record)` ignore tout ce qui n'est pas `agreed` ; convertit par `reportFromResult` (`@game/ranking/protocol`) ; signe par `signReport` (`@game/ranking/report`) ; envoie. Réponses `201` et `200 duplicate` : fini. `5xx`, erreur réseau, délai dépassé (5 s) : nouvel essai après 1, 2, 4… s, jusqu'à 60 s d'écart, pendant 24 h au plus, avec le même `matchId` et un `reportedAt` recalculé. `400`, `401`, `403`, `409` : abandon journalisé (c'est une erreur de configuration ou de code, un nouvel essai n'y changerait rien). File en mémoire bornée (1 000 rapports) ; à l'arrêt du serveur, un dernier essai rapide est fait et ce qui reste est journalisé (risque accepté : un redémarrage pendant une panne du serveur des comptes perd ces rapports).
- `main.ts` du serveur de jeu le branche sur `onMatchResult` quand `RANKING_URL` et `RANKING_REPORT_SECRETS` sont donnés ; sans eux, il journalise comme aujourd'hui (et le dit au démarrage). En développement (greffon Vite du jeu), les comptes et le classement tournent dans le même processus : l'expéditeur appelle directement `ranking.submitMatch`.
- Le serveur de jeu ajoute `@game/ranking` à ses dépendances (paquet du dépôt, points d'entrée `protocol` et `report` seulement, sans base ni HTTP).
- **Bout en bout réel** (`packages/lobby/test/e2e/ranking.test.ts`) : vrai serveur comptes + classement (SQLite en mémoire), vrai serveur de jeu avec l'expéditeur HTTP, deux clients Node **inscrits** passent par la partie rapide (règles de test : Temps 30 s, attente 1 s), finissent le match ; `/me` de chacun montre une cote 1016 et 984 (ou l'inverse, ou 1000 et 1000 à égalité), une entrée d'historique classée, des compteurs à 1 ; un second envoi du même enregistrement donne `duplicate` sans rien changer ; un match de salon privé arrive dans l'historique sans changer la cote ; le serveur des comptes arrêté pendant l'envoi puis relancé reçoit le rapport à son retour.

### Production et déploiement

```
Internet ──443──► frontal (Caddy : TLS automatique, HTTP/2, en-têtes, fichiers statiques)
                    ├─ /                     → client (build de apps/game)
                    ├─ /api/accounts/*       → comptes + classement :8787
                    ├─ /api/ranking/v1/matches → refusé (404) depuis l'extérieur
                    ├─ /api/ranking/*        → comptes + classement :8787
                    ├─ /lobby, /net          → serveur de jeu :8788 (WebSocket)
                    └─ /health/*             → santé des deux serveurs, réservée au réseau interne
serveur de jeu ──réseau interne──► comptes + classement /api/ranking/v1/matches (rapports signés)
```

- **Frontal proposé : Caddy** (image officielle, TLS Let's Encrypt automatique, une configuration de 40 lignes). C'est un logiciel tiers dans le déploiement, pas une dépendance du code : à valider (« Décisions »). Alternative : nginx avec certbot, plus de configuration.
- **Conteneurs** : une image Node 24 pour les deux serveurs (deux commandes), construite en plusieurs étapes (`pnpm install --frozen-lockfile`, build des paquets, image finale sans outils de build, utilisateur non root, système de fichiers en lecture seule sauf le volume des bases). Volumes : `data/` (bases SQLite des comptes et du classement). `docker-compose.yml` assemble frontal, comptes, jeu, avec redémarrage automatique et vérifications de santé (`/health`).
- **Configuration** : `deploy/.env.example` documente chaque variable (domaine, origines autorisées, cookies `Secure`, proxy de confiance, clés de ticket et de rapport, contenu, chemins des bases, plafond de parties du relais). `deploy/generate-secrets.ts` produit des clés aléatoires (Node, `crypto.randomBytes`), jamais commitées. Les serveurs refusent déjà de démarrer avec une configuration incomplète ; le serveur de jeu y ajoute `RANKING_URL`, `RANKING_REPORT_SECRETS` et `RELAY_MAX_GAMES`.
- **Mémoire du relais** : `RELAY_MAX_GAMES` (défaut de production proposé : 200 parties simultanées, soit au plus environ 700 Mo d'historique dans le pire cas de matchs de 30 min à 8). Option ajoutée à la configuration du serveur de jeu, sans changer le relais (il a déjà `maxGames`).
- **Journalisation minimale** : une ligne par événement sur la sortie standard, préfixée de l'heure ISO, sans pseudo, ticket, mot de passe ni adresse IP (règles déjà suivies par les modules) ; le frontal journalise les requêtes sans les adresses IP complètes (format réduit). Rotation par Docker (taille et nombre de fichiers bornés).
- **Santé** : `/health` existe déjà sur les deux serveurs ; celui du serveur de jeu ajoute le nombre de connexions, parties et rapports en attente. Le frontal et Docker s'en servent ; une page d'état publique n'est pas prévue.
- **Sauvegarde** : script qui copie les bases SQLite à chaud (`VACUUM INTO`) vers un fichier daté, à lancer par une tâche planifiée de la machine ; restauration documentée.
- **Client statique** : noms de fichiers à empreinte et cache long, `index.html` sans cache ; en-têtes `Content-Security-Policy` stricte (`default-src 'self'`, pas de script en ligne), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (manette autorisée, le reste coupé), HSTS.
- **`DEPLOIEMENT.md`** : choix d'un hébergeur en Europe (ce dont la machine a besoin, deux ou trois offres comparables, sans engagement de ma part), nom de domaine et DNS, installation de Docker, copie du dépôt, génération des clés, lancement, vérifications après mise en ligne, mise à jour, sauvegarde et restauration, rotation des clés, que faire en cas d'incident. Chaque étape qui engage un compte ou de l'argent est marquée comme telle.

## Stack technique

| Élément | Choix |
|---|---|
| Client | TypeScript, Vite (déjà utilisé), DOM natif, CSS écrit à la main avec des variables ; les paquets du dépôt seulement |
| Serveurs | Ceux des modules : `@game/ranking` (comptes + classement), `@game/lobby` (jeu), Node 24+ |
| Tests | Vitest dans Node pour la logique ; Playwright avec Edge (`playwright-core`, déjà présent) pour les parcours, l'accessibilité au clavier et la performance |
| Déploiement | Docker et Docker Compose, Caddy (à valider), scripts Node sans dépendance |

**Aucune nouvelle dépendance npm.** Les seules nouveautés sont des outils de déploiement hors du code (Docker, Caddy), à valider.

## Commandes

```
Jeu en dev :              pnpm --filter @game/app dev        (comptes, classement, lobby et relais en mémoire dans Vite)
Build de production :     pnpm --filter @game/app build      (client statique dans apps/game/dist)
Tests (logique) :         pnpm --filter @game/app test
Parcours dans Edge :      pnpm --filter @game/app test:e2e   (build de production + vrais serveurs + passerelle locale)
Performance :             pnpm --filter @game/app perf
Production en local :     pnpm --filter @game/app serve:prod (mêmes processus que le serveur, sans Docker ni TLS)
Bout en bout lobby→classement : pnpm --filter @game/lobby test:e2e
Types :                   pnpm typecheck
Lint :                    pnpm lint
Tous les tests :          pnpm test
Clés de production :      node deploy/generate-secrets.ts
Déploiement :             voir DEPLOIEMENT.md (docker compose -f deploy/docker-compose.yml up -d)
```

## Structure du projet

```
apps/game/                        → @game/app
  index.html                      → racine, titre de la page, aucun script en ligne
  src/
    main.ts                       → assemble l'application (seul point d'entrée qui touche window)
    app.ts                        → services partagés, pile d'écrans, boucle d'images
    screens.ts                    → pile d'écrans (pure)
    nav.ts                        → déplacement du focus par direction (pur)
    menu-pad.ts                   → manette dans les menus : lecture, répétition, actions (pur + adaptateur)
    content.ts                    → identifiants → SimConfig, noms et descriptions affichés (pur)
    settings.ts                   → réglages son et affichage : défauts, lecture tolérante, écriture (pur)
    errors.ts                     → états d'erreur des clients → message et actions (pur)
    strings.ts                    → textes de l'interface
    local-match.ts                → combat local et entraînement : boucle, pause, fin
    online-match.ts               → combat en ligne : netcode, déclaration du résultat
    online.ts                     → session, client du lobby, enchaînement salon / file / match
    ui/                           → un fichier par écran (title, main-menu, local-setup, stage-select,
                                    rules, training, pause, results, online-home, room, queue, auth,
                                    profile, leaderboard, options-*, credits, error) et composants
                                    (button, list, toggle, slider, banner, dialog)
    style.css                     → palette, typographie, focus, mise en page
  dev-plugin.ts                   → serveurs en mémoire pour `vite dev`
  test/                           → logique (Node) ; e2e/ (Edge) ; perf/
packages/lobby/src/ranking-report.ts → expéditeur des rapports de match (nouveau)
packages/lobby/src/main.ts, config.ts → RANKING_URL, RANKING_REPORT_SECRETS, RELAY_MAX_GAMES
packages/lobby/test/ranking-report.test.ts, test/e2e/ranking.test.ts
deploy/
  Dockerfile, docker-compose.yml, Caddyfile, .env.example
  generate-secrets.ts, backup.ts
  gateway.ts                      → passerelle locale qui reproduit les routes du frontal (tests, serve:prod)
DEPLOIEMENT.md
.claude/launch.json               → configuration « game »
```

Fichiers touchés hors de `apps/game` et `deploy/` : `packages/lobby` (expéditeur, configuration, dépendance à `@game/ranking`), `pnpm-workspace`/`pnpm-lock.yaml` (nouveau paquet du dépôt), `.claude/launch.json`, `CAPABILITY-MAP.md` (à la fin). **`sim-core` n'est pas modifié** ; `apps/demo` et `apps/online` non plus. Si un besoin d'API manque dans un module (par exemple une scène de fond dans `render`), il sera ajouté de façon additive, consigné dans les « Écarts » de ce module, et signalé.

## API publique (contrat)

L'application n'expose pas d'API à d'autres modules. Ses contrats sont :

```ts
// packages/lobby/src/ranking-report.ts
export interface ReporterOptions {
  readonly url: string;                       // ex. http://accounts:8787/api/ranking/v1/matches
  readonly secret: string;                    // première clé de RANKING_REPORT_SECRETS
  readonly now: () => number;
  readonly fetch: typeof fetch;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly log?: (message: string) => void;
  readonly maxQueue?: number;                 // défaut 1 000
}
export interface RankingReporter {
  submit(record: MatchRecord): void;          // ignore ce qui n'est pas « agreed »
  pending(): number;
  close(): Promise<void>;                     // dernier essai, puis journalise le reste
}
export function createRankingReporter(options: ReporterOptions): RankingReporter;

// apps/game/src/content.ts
export function buildSimConfig(match: MatchConfig, choice: {
  stage: StageId; fighters: readonly FighterId[]; seed: number; hazards?: boolean;
}): SimConfig;
```

Variables d'environnement ajoutées au serveur de jeu : `RANKING_URL`, `RANKING_REPORT_SECRETS` (mêmes clés que le serveur du classement, la première sert à signer), `RELAY_MAX_GAMES`. Le contenu par défaut (`LOBBY_FIGHTERS`, `LOBBY_STAGES`) est documenté avec les identifiants réels.

La prise pour les tests automatiques (`window.__game`) suit la règle des démos : lecture d'état et quelques actions de test (avancer des frames, finir un match, pousser une sortie de stage), jamais utilisée par le code du jeu. Elle n'existe pas dans le build de production servi au public : elle est activée par une variable de build réservée aux tests, et le build de production est vérifié sans elle.

## Style de code

```ts
/** Prochain élément focalisable dans `direction` depuis `from`, ou `null` (on reste sur place). */
export function nextFocus(
  from: Rect,
  candidates: readonly { id: string; rect: Rect }[],
  direction: Direction,
): string | null {
  // Candidats strictement dans le demi-plan de la direction, puis le plus proche
  // en pondérant l'écart perpendiculaire (un voisin aligné gagne sur un voisin en diagonale).
  // …
}
```

Conventions : celles des démos et des modules (documentation et textes en français, code en anglais ; logique pure testée seule, DOM mince ; horloge injectée dans la logique ; `textContent` uniquement pour tout ce qui vient d'un joueur ou du serveur ; jamais `innerHTML` avec une donnée ; aucun `Math.random` dans ce qui touche la simulation).

## Stratégie de test

| Niveau | Quoi | Où |
|---|---|---|
| Unitaire | Pile d'écrans (retour, remplacement, confirmations) ; navigation par direction (grilles, listes, trous, bords) ; manette des menus (répétition, A/B, stick et croix, disposition non standard) ; réglages (défauts, valeurs hors bornes, JSON illisible, autre version, pas de stockage) ; erreurs (chaque code connu a un message et une action) ; contenu (chaque personnage et chaque stage se construisent, même entrée ⇒ même empreinte de `SimConfig`) ; contraste de la palette | `apps/game/test/` |
| Expéditeur | Ne transmet que `agreed` ; rapport conforme à `reportFromResult` ; signature vérifiable par `verifyReportSignature` ; renvois avec le même `matchId` et un `reportedAt` neuf ; abandon sur 4xx ; file bornée ; arrêt | `packages/lobby/test/` |
| Bout en bout réel lobby → classement | Voir « Intégration » : deux inscrits, partie rapide, cotes et historiques mis à jour, doublon sans effet, privé non classé, reprise après panne du serveur des comptes | `packages/lobby/test/e2e/` |
| Parcours dans Edge | Sur le **build de production** servi par la passerelle locale et les vrais serveurs (SQLite dans un dossier temporaire) : titre → combat local à deux (clavier et une manette simulée par la prise de test) → résultats → revanche → menu ; Entraînement ; en ligne à deux onglets : inscription, partie rapide, match jusqu'au bout, mêmes résultats, retour au salon, profil avec cote et historique mis à jour, classement ; salon privé par code et par lien ; rechargement en pleine partie ; serveur de jeu arrêté puis relancé (message visible, reconnexion) ; aucune erreur de console | `apps/game/test/e2e/` |
| Clavier seul et accessibilité | Tout le parcours local et en ligne fait au clavier, sans souris ; chaque élément interactif a un nom accessible ; focus toujours visible ; ordre de tabulation sans piège ; textes à 200 % sans débordement de l'écran principal | `apps/game/test/e2e/` |
| Options | Une touche remappée dans Options sert en combat et survit au rechargement ; son coupé ; résolution de rendu appliquée | `apps/game/test/e2e/` |
| Performance | Dans Edge, l'écran de combat de l'application, 8 combattants (entraînement, mannequins à inputs aléatoires) et objets, son actif : seuils de `render` (95 % des images sous 16,7 ms, dessin moyen sous 4 ms) ; menus au-dessus de la scène de fond : 95 % sous 16,7 ms ; taille du client compressé mesurée et consignée | `apps/game/test/perf/` |
| Production | Le build ne contient ni la prise de test, ni clé de développement, ni carte des sources ; les en-têtes de la passerelle et du `Caddyfile` concordent (test qui lit les deux) ; les serveurs refusent de démarrer sans leurs clés ; `/health` répond | `apps/game/test/`, `deploy/` |
| Non-régression | Tous les tests existants (démo, démo en ligne, modules, bancs) passent inchangés | — |
| Manuel | Manette réelle dans les menus et en combat ; ressenti des écrans ; lecteur d'écran (Narrateur) sur le menu principal | — |

Les tests de logique sont écrits avant le code. Les parcours dans Edge sont écrits avec chaque écran.

## Limites

- **Toujours** : tests, typecheck et lint avant chaque commit ; test avant la logique ; textes du DOM par `textContent` ; dire dans le compte rendu ce qui n'a été vérifié qu'à la main (manette réelle, lecteur d'écran, Docker) ou pas du tout (Firefox et Safari, absents de la machine) ; relecture de sécurité avant le dernier point de contrôle.
- **Demander d'abord** : ajouter une dépendance npm ; modifier `sim-core` ; changer une API existante d'un module (les ajouts additifs sont consignés et signalés) ; toute action externe (compte chez un hébergeur, nom de domaine, achat, déploiement réel, envoi de données à un service tiers) ; relever un seuil de performance.
- **Jamais** : casser `apps/demo` ou `apps/online` ; mettre une clé réelle dans le dépôt ; servir la prise de test en production ; journaliser un mot de passe, un ticket, un pseudo ou une adresse IP ; reprendre un nom, un personnage, un son ou un visuel d'un jeu existant.

## Critères de succès

1. **Résultats classés** : un match de partie rapide terminé en concordance arrive au classement une fois et une seule, avec les cotes prévues par la formule ; un salon privé remplit l'historique sans toucher aux cotes ; une panne passagère du serveur des comptes ne fait pas perdre le rapport. Vérifié par le bout en bout réel.
2. **Jouable sans souris** : du titre aux résultats, en local et en ligne, tout se fait au clavier ; au clavier et à la manette dans les menus (manette vérifiée par simulation automatique et par vous à la main).
3. **Combat local complet** : 2 à 4 joueurs, tous les personnages, tous les stages, tous les modes et réglages de `match-rules`, pause, résultats, revanche ; Entraînement avec 1 à 7 mannequins.
4. **En ligne complet** : connexion invité, inscription, connexion, conversion ; salon privé (code, lien, sélection, règles, prêt, expulsion, verrou, lancement) ; partie rapide ; match ; résultats identiques dans les deux onglets ; retour au salon ; rechargement en pleine partie.
5. **Profil et classement** : cote, rang, statistiques et historique visibles et mis à jour après un match classé ; classement paginé avec ma position ; gestion du compte.
6. **Options persistantes** : remappage, son et affichage appliqués et gardés après rechargement ; un stockage corrompu ou absent ne gêne pas.
7. **Erreurs visibles** : chaque cas listé a un message français et une issue ; le parcours « serveur de jeu arrêté puis relancé » montre un message puis se rétablit sans recharger.
8. **Lisible et accessible** : contraste vérifié, focus visible, noms accessibles, grand texte et mouvements réduits fonctionnels, vérifiés par les tests d'Edge.
9. **Performance** : seuils de `render` tenus sur l'écran de combat de l'application à 8 combattants avec le son ; menus fluides.
10. **Production** : le build de production et les vrais serveurs font le parcours complet de l'objectif dans Edge derrière la passerelle locale ; le build ne contient ni prise de test ni clé de développement ; en-têtes de sécurité présents.
11. **Prêt à déployer** : `deploy/` et `DEPLOIEMENT.md` permettent à quelqu'un qui n'a pas suivi le projet de mettre le jeu en ligne sur une machine en Europe ; ce qui n'a pas pu être vérifié ici (construction des images, TLS réel) est dit clairement.
12. **Non-régression** : tous les tests, bancs et mesures existants passent ; démo et démo en ligne inchangées.
13. **Relu** : relecture de sécurité des serveurs assemblés, du frontal et du client consignée, constats corrigés ou expliqués.
14. **Jugé** : vous avez fait le parcours et donné votre avis sur les écrans et le nom.

## Décisions prises à la validation

Choix par défaut approuvés le 2026-11-17 :

1. **Nom du jeu** : « Fracas » (alternatives : « Éjecta », « Tumulte », ou votre idée).
2. **Nouvelle application `apps/game`** à côté des démos, en DOM natif sans framework, sans dépendance ajoutée.
3. **Combat local sans IA** : 2 à 4 humains, plus un mode Entraînement contre des mannequins qui ne décident rien.
4. **Production en trois processus** sur une machine (frontal, comptes + classement, jeu), avec **Docker Compose et Caddy** (TLS automatique). Alternative : nginx + certbot, ou un hébergement « plateforme » qui fournit le TLS (moins de contrôle sur les WebSocket et les volumes SQLite).
5. **Expéditeur des rapports dans le serveur de jeu** (`packages/lobby`), file en mémoire avec renvois pendant 24 h ; rapports perdus si le serveur de jeu redémarre pendant une panne du serveur des comptes (risque accepté en v1).
6. **Plafond de 200 parties simultanées** par défaut en production (`RELAY_MAX_GAMES`), à ajuster selon la mémoire de la machine louée.
7. **Lien d'invitation** `…/#rejoindre=CODE` en plus du code à dicter.
8. **Vérification sans Docker** : build de production + vrais serveurs + passerelle locale dans les tests ; images Docker écrites mais non construites sur cette machine.
