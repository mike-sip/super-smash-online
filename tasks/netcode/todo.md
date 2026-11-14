# Tâches : module `netcode`

> Statut : **VALIDÉ le 2026-11-13**. Plan : [plan.md](plan.md).
>
> Vérification commune à chaque tâche : `pnpm --filter @game/netcode test`, `pnpm --filter @game/netcode typecheck` et `pnpm lint` passent ; à partir de T5, `pnpm --filter @game/netcode bench` passe aussi.

## Phase A — Rollback

- [x] **T1 : Paquet et adaptateur `sim-core`**
  - Acceptation : paquet `@game/netcode` résolu comme `input` (sources en test, `dist/` pour le typecheck et le build), points d'entrée `.` (client) et `./server` (Node) ; réglages par défaut de la spec (`D = 2`, `P = 15`, `G = 8`, checksum toutes les 15 frames) ; interface `RollbackGame` et adaptateur `simGame` ; règle de réapparition calculée depuis l'état (KO depuis 60 frames), exportée pour la démo et les tests.
  - Vérification : tests de l'adaptateur (sauvegarde, restauration, empreinte égales à celles de `sim-core`) ; avec la réapparition, `step×N → save → step×M → load → step×M` donne la même empreinte.
  - Fichiers : `packages/netcode/package.json`, `packages/netcode/tsconfig.json`, `packages/netcode/tsconfig.build.json`, `packages/netcode/vitest.config.ts`, `packages/netcode/src/constants.ts`, `packages/netcode/src/game.ts`, `packages/netcode/src/index.ts`, `packages/netcode/test/game.test.ts`

- [x] **T2 : Protocole**
  - Acceptation : encodage et décodage binaires des onze messages de la spec ; version portée par `HELLO` ; décodage dans des structures réutilisées, sans exception : un message tronqué, trop long, d'un type inconnu ou hors bornes donne une erreur décrite ; taille maximale d'un message plafonnée.
  - Vérification : aller-retour de chaque message, cas limites (8 joueurs, 32 frames par joueur, identifiant de 32 caractères) ; 10 000 messages aléatoires ou tronqués décodés sans exception.
  - Fichiers : `packages/netcode/src/protocol.ts`, `packages/netcode/test/protocol.test.ts`

- [x] **T3 : Historique des inputs**
  - Acceptation : par joueur, anneau d'inputs confirmés, utilisés et locaux ; frontières `connu[p]` et `C` ; inputs des frames `0` à `D-1` confirmés d'office ; prédiction (dernier confirmé pour un distant, lu localement pour un local) ; confirmation par plages qui ignore le déjà connu, refuse les trous et les frames au-delà de l'anneau, et renvoie la première frame simulée mal prédite ; aucune allocation.
  - Vérification : tests unitaires de chacun de ces cas.
  - Fichiers : `packages/netcode/src/timeline.ts`, `packages/netcode/test/timeline.test.ts`

- [x] **T4 : Moteur de rollback**
  - Acceptation : `createRollback` : avance d'une frame avec les inputs locaux (appliqués à `n + D`) et sauvegarde ; refus d'avancer au-delà de `P` frames après `C` ; corrections en attente appliquées par restauration et re-simulation, avec les meilleures prédictions du moment ; empreintes des états confirmés aux frames multiples de l'intervalle, calculées une seule fois et seulement sur un état confirmé ; signalement des seules frames nouvelles ; mesures (rollbacks, profondeur, attentes).
  - Vérification : test de propriété sur 1 000 tirages : deux à huit joueurs, inputs confirmés livrés en retard, par paquets et dans le désordre ; état final et empreintes égaux à une simulation directe avec les inputs définitifs ; frames nouvelles signalées une fois chacune, dans l'ordre.
  - Fichiers : `packages/netcode/src/rollback.ts`, `packages/netcode/test/rollback.test.ts`

- [x] **T5 : Banc du rollback**
  - Acceptation : banc bloquant à 8 joueurs et 16 entités, sur le modèle de `sim-core/bench/step.bench.ts` : à chaque frame, une correction à la plus ancienne frame de la fenêtre force un rollback de 15 frames plus une frame nouvelle ; échec au-delà de 1 ms en moyenne, 2 ms au 99ᵉ centile, ou 32 Ko de croissance du tas sur 10 000 frames.
  - Vérification : `pnpm --filter @game/netcode bench` passe et affiche les mesures.
  - Fichiers : `packages/netcode/bench/rollback.bench.ts`, `packages/netcode/package.json`

**Point de contrôle A** : mesures du banc et test de propriété consignés dans le commit ; relecture au point C (décision du 2026-11-13). Mesuré le 2026-11-14 : pire cas (rollback de 15 frames + 1 nouvelle, 8 joueurs, 16 entités) 0,055 ms en moyenne, 0,10 ms au 99ᵉ centile, tas +9 Ko sur 10 000 frames ; test de propriété : 1 000 tirages passants, un bogue trouvé et corrigé.

## Phase B — En ligne, simulé

- [x] **T6 : Horloge**
  - Acceptation : estimation de l'écart avec l'horloge du serveur à partir des échanges ping/pong (l'échange à l'aller-retour le plus court parmi les 16 derniers) ; horloge de jeu qui suit l'estimation d'au plus 1 ms par frame, ou d'un coup au-delà de 250 ms d'écart ; frame cible et fraction de frame à un instant donné.
  - Vérification : tests unitaires avec gigue, latences asymétriques, horloge locale qui dérive de ±0,1 %, saut d'horloge.
  - Fichiers : `packages/netcode/src/clock.ts`, `packages/netcode/test/clock.test.ts`

- [x] **T7 : Relais (logique pure)**
  - Acceptation : parties par identifiant ; attribution des emplacements dans l'ordre d'arrivée ; `WAITING`, puis `START` 2 s après le dernier arrivé ; refus motivés (version, partie pleine ou commencée, nombre de joueurs incohérent) ; acceptation des inputs qui prolongent la suite d'un emplacement du client, relais immédiat à tous avec redondance jusqu'à accusé (32 frames par joueur au plus) ; input en retard de `G` frames remplacé par le précédent ; déconnexion : `LEFT` et inputs neutres ; empreintes comparées par frame, `DESYNC` au premier écart ; message invalide : connexion fermée ; partie supprimée quand tous sont partis ou après 10 minutes d'attente ; journal optionnel des inputs confirmés (pour les tests).
  - Vérification : tests unitaires de chacun de ces cas, avec des connexions factices et une horloge virtuelle.
  - Fichiers : `packages/netcode/src/server/relay.ts`, `packages/netcode/src/server/index.ts`, `packages/netcode/test/relay.test.ts`

- [x] **T8 : Session client**
  - Acceptation : interface `Transport` ; `createNetClient` : `HELLO`, pings, états de la spec, `begin`, `update` (réception, rollback, avance cadencée par l'horloge, rattrapage borné à 240 frames, envoi d'un `INPUT` par frame avec redondance et accusés, empreintes), `onFrame` pour les seules frames nouvelles, fraction de frame renvoyée ; mesures ; événements de désync, de départ et d'état ; messages invalides ignorés.
  - Vérification : tests unitaires contre un relais en mémoire sans latence (déroulé complet d'une partie à 2) ; réponses à des messages invalides.
  - Fichiers : `packages/netcode/src/transport.ts`, `packages/netcode/src/client.ts`, `packages/netcode/src/index.ts`, `packages/netcode/test/client.test.ts`

- [x] **T9 : Réseau simulé et bout en bout simulé**
  - Acceptation : réseau en mémoire à horloge virtuelle : latence par liaison, gigue, pertes, désordre (mode « datagrammes ») ou ordre garanti (mode « WebSocket »), graine ; clients dont l'horloge dérive et dont les images n'arrivent pas à intervalles exacts. Scénarios : 2 puis 8 clients sur 36 000 frames dans les conditions du critère n° 1 ; joueur à 400 ms d'aller-retour ; joueur déconnecté en cours de partie ; onglet masqué 10 s.
  - Vérification : empreintes identiques entre clients et égales à une rejoue hors ligne du journal du serveur ; aucune désync ; attentes et profondeur de rollback sous les seuils des critères 2 et 3 ; un test témoin vérifie qu'une désync volontaire (un client au jeu modifié) est bien détectée.
  - Fichiers : `packages/netcode/src/testing/network.ts`, `packages/netcode/test/session.test.ts`, `packages/netcode/test/session-faults.test.ts`, `packages/netcode/test/helpers.ts`

**Point de contrôle B** : résultats chiffrés du bout en bout simulé consignés dans le commit et dans les « Écarts » de la spec ; relecture au point C. Mesuré le 2026-11-14 : aucune désync en 10 minutes à 2 et 8 clients (datagrammes 5 % de pertes, WebSocket 0,5 %), empreintes égales à la rejoue du relais ; attentes au plus 0,08 % en datagrammes, 1,5 % sur WebSocket ; profondeur moyenne 2,1 (2 clients) à 4,4 (8 clients) frames ; 18 Ko/s par client et par sens à 8 joueurs.

## Phase C — En ligne, réel

- [x] **T10 : WebSocket réel**
  - Acceptation : `attachRelay` branche le relais sur un serveur HTTP existant, sur un chemin donné, sans gêner ses autres connexions WebSocket ; `startRelayServer` et la commande `serve` ; chaque message copié avant envoi ; taille de message plafonnée par `ws` ; `webSocketTransport` côté client (navigateur et Node).
  - Vérification : bout en bout réel dans Node : serveur local et 2 puis 8 clients sur de vrais WebSocket, latence artificielle à l'envoi, quelques secondes de jeu, empreintes identiques ; un client qui envoie n'importe quoi est déconnecté sans faire tomber la partie.
  - Fichiers : `packages/netcode/src/server/host.ts`, `packages/netcode/src/server/main.ts`, `packages/netcode/src/transport.ts`, `packages/netcode/test/e2e/websocket.test.ts`, `packages/netcode/package.json`

- [ ] **T11 : Contrat rendu et rollback**
  - Acceptation : test dans `render` : une simulation suivie d'un rollback, où seules les frames nouvelles sont capturées, ne rejoue aucun effet et garde interpolation et caméra continues ; un second cas documente qu'une capture de frame re-simulée réinitialise l'interpolation (raison du contrat). Comptage, dans le bout en bout simulé, des événements manqués ou joués à tort par rapport à la rejoue hors ligne.
  - Vérification : `pnpm --filter @game/render test` passe ; proportions consignées dans la spec.
  - Fichiers : `packages/render/test/rollback.test.ts` (nouveau), `packages/netcode/test/session.test.ts`

- [ ] **T12 : Démo en ligne**
  - Acceptation : application `apps/online` : formulaire minimal (identifiant de partie, joueurs attendus, joueurs locaux), aussi lisible depuis l'adresse (`?game=…&players=…`) ; attente puis compte à rebours ; partie jouée au clavier ou à la manette avec le module `input`, rendue avec `render` (capture des seules frames nouvelles) ; diagnostic affichable (aller-retour, frame confirmée, rollbacks, attentes, inputs remplacés) ; bandeau de désync et de départ d'un joueur ; relais attaché au serveur de développement Vite sur `/net`, accessible depuis le réseau local ; configuration ajoutée à `.claude/launch.json`.
  - Vérification : manuelle dans deux onglets ; `pnpm --filter @game/online typecheck` et build passent ; `apps/demo` et ses tests inchangés et passants.
  - Fichiers : `apps/online/package.json`, `apps/online/index.html`, `apps/online/vite.config.ts`, `apps/online/tsconfig.json`, `apps/online/vitest.config.ts`, `apps/online/src/main.ts`, `apps/online/src/relay-plugin.ts`, `.claude/launch.json`

- [ ] **T13 : Deux onglets d'Edge**
  - Acceptation : test Playwright : deux pages d'Edge rejoignent la même partie ; une touche dans la première fait bouger son combattant dans la seconde ; à une même frame confirmée, les empreintes des deux pages sont égales ; aucune erreur de console ni désync.
  - Vérification : `pnpm --filter @game/online test` passe.
  - Fichiers : `apps/online/test/two-tabs.test.ts`, `apps/online/src/main.ts`

**Point de contrôle C** : vous jouez à deux onglets, ou à deux machines du réseau local. Relecture humaine, votre avis sur le ressenti est attendu ici.

## Phase D — Bilan

- [ ] **T14 : Relecture finale**
  - Acceptation : chacun des huit critères de succès marqué vérifié automatiquement, vérifié à la main ou non vérifié, avec sa mesure ; écarts constatés consignés dans la spec ; note de passation à `render` sur les effets après rollback (dossier de notes partagé) ; commandes ajoutées documentées.
  - Vérification : tests, typecheck, lint et bancs de tout le dépôt passants ; compte rendu.
  - Fichiers : `SPEC-netcode.md`

**Point de contrôle D** : relecture humaine, module terminé.
