# Tâches : module `input`

> Statut : **VALIDÉ le 2026-11-13**. Plan : [plan.md](plan.md).
>
> Vérification commune à chaque tâche : `pnpm --filter @game/input test`, `pnpm --filter @game/input typecheck` et `pnpm lint` passent ; à partir de T3, `pnpm --filter @game/demo test` passe aussi.

## Phase A — Clavier

- [x] **T1 : Paquet, actions et dispositions par défaut**
  - Acceptation : paquet `@game/input` dans le monorepo, résolu comme `render` (sources en développement et en test, `dist/` pour le typecheck et le build) ; liste des actions et bouton `InputFrame` de chacune ; dispositions par défaut du clavier et de la manette, conformes à la spec ; validation d'une disposition (action sans commande, commande inconnue) et détection des conflits (une même commande pour deux actions).
  - Vérification : tests unitaires des dispositions par défaut (complètes, sans conflit) et de la validation.
  - Fichiers : `packages/input/package.json`, `packages/input/tsconfig.json`, `packages/input/tsconfig.build.json`, `packages/input/vitest.config.ts`, `packages/input/src/actions.ts`, `packages/input/src/bindings.ts`, `packages/input/test/bindings.test.ts`

- [x] **T2 : État du clavier**
  - Acceptation : état alimenté par des appuis et des relâchements, sans dépendre du DOM ; un appui relâché avant la lecture suivante compte pour une frame exactement, ni perdu ni prolongé ; gauche et droite ensemble, ou haut et bas : la dernière enfoncée l'emporte, et relâcher celle-ci rend la main à l'autre ; touche de marche : demi-stick ; relâchement général ; répétition automatique des touches ignorée.
  - Vérification : tests unitaires de chacun de ces cas, dont l'appui bref sur le saut qui donne un bouton tenu une frame.
  - Fichiers : `packages/input/src/keyboard.ts`, `packages/input/test/keyboard.test.ts`

- [x] **T3 : `createInput`, `sample` et démo au clavier**
  - Acceptation : `createInput` écoute le clavier de la fenêtre et relâche tout à la perte du focus ; les touches du jeu ne font plus défiler la page, et une touche tenue avec Ctrl, Alt ou Méta n'est jamais une commande ; une touche tapée dans un champ de saisie est ignorée ; `sample` écrit l'`InputFrame` du joueur au clavier, 0 pour les emplacements vides, sans allocation ; la démo lit le clavier par le module, `temp-input.ts` ne gardant que la manette.
  - Test de contrat, partie clavier : des séquences produites par le module et jouées dans la simulation déclenchent marche, course, dash, petit et grand saut, attaques neutres et dirigées, smash, bouclier, esquives, saisie et options de rebord.
  - Vérification : test de contrat ; tests de fumée existants de la démo inchangés et passants ; nouveau test de fumée de la perte de focus.
  - Fichiers : `packages/input/src/system.ts`, `packages/input/src/index.ts`, `packages/input/test/contract.test.ts`, `apps/demo/package.json`, `apps/demo/vite.config.ts`, `apps/demo/src/main.ts`, `apps/demo/src/temp-input.ts`, `apps/demo/test/smoke.test.ts`

**Point de contrôle A** : vous jouez à la démo au clavier. Relecture humaine.

## Phase B — Manette

- [x] **T4 : Mise en forme du stick**
  - Acceptation : zone morte retirée sans à-coup à sa sortie ; stick à fond à 127 sur les axes comme dans les diagonales ; résultat entier de -127 à 127, symétrique, croissant avec l'inclinaison ; stick droit ramené à une seule des quatre directions, la dominante ; gâchette analogique ramenée à un bouton par un seuil.
  - Vérification : tests unitaires sur toute la course du stick (repos avec dérive, axes, diagonales, monotonie, symétrie) et aux seuils de `sim-core` (40, 64, 96).
  - Fichiers : `packages/input/src/analog.ts`, `packages/input/test/analog.test.ts`

- [x] **T5 : Manettes et joueurs**
  - Acceptation : lecture des manettes à chaque `sample`, disposition standard ; manette non standard signalée comme telle ; branchement et débranchement à chaud avec notification ; attribution d'un périphérique à un emplacement ; un périphérique non attribué qui est actionné déclenche une demande d'arrivée ; une manette débranchée libère ses boutons, garde son emplacement et le retrouve au rebranchement ; jusqu'à 4 joueurs locaux.
  - Test de contrat, partie manette : mêmes actions qu'au clavier, plus la marche à inclinaison partielle et le dash en diagonale.
  - Vérification : tests unitaires avec des manettes simulées ; test de contrat.
  - Fichiers : `packages/input/src/gamepad.ts`, `packages/input/src/players.ts`, `packages/input/src/system.ts`, `packages/input/test/gamepad.test.ts`, `packages/input/test/players.test.ts`, `packages/input/test/contract.test.ts`

- [x] **T6 : Démo sans `temp-input`, à plusieurs**
  - Acceptation : `temp-input.ts` supprimé ; la démo attribue le clavier au joueur 1 et accueille jusqu'à 3 manettes de plus quand un bouton est pressé, les adversaires automatiques occupant les emplacements restants ; un message signale une manette débranchée.
  - Vérification : test de fumée dans Edge avec une manette simulée (branchement, arrivée, stick, boutons, débranchement) ; votre essai avec une manette réelle.
  - Fichiers : `apps/demo/src/main.ts`, `apps/demo/src/dummies.ts`, `apps/demo/index.html`, `apps/demo/test/smoke.test.ts`, suppression de `apps/demo/src/temp-input.ts`

**Point de contrôle B** : vous jouez avec votre manette. Relecture humaine, votre avis sur le stick est attendu ici.

## Phase C — Remappable

- [x] **T7 : Enregistrement, réglages et saut au stick**
  - Acceptation : `setBindings` refuse une disposition invalide en donnant la raison, sinon l'applique et l'enregistre ; `resetBindings` ; zone morte et seuil réglables ; saut au stick par joueur, désactivé par défaut ; format d'enregistrement versionné ; données absentes, corrompues ou d'une version inconnue : dispositions par défaut, sans erreur ; module utilisable sans stockage.
  - Vérification : tests unitaires de l'aller-retour, des données corrompues, du stockage indisponible ; test du saut au stick dans la simulation (activé : le stick vers le haut fait sauter ; désactivé : non).
  - Fichiers : `packages/input/src/storage.ts`, `packages/input/src/system.ts`, `packages/input/test/storage.test.ts`, `packages/input/test/contract.test.ts`

- [x] **T8 : Remappage et son écran**
  - Acceptation : `captureNext` donne la prochaine touche, le prochain bouton ou le prochain demi-axe actionné sur le périphérique, et s'annule proprement ; `describe` donne le nom de la touche sur le clavier du joueur quand le navigateur le connaît, sinon celui de sa position ; écran minimal dans la démo : liste des actions par périphérique, réassignation, conflit signalé, retour aux valeurs par défaut, zone morte, saut au stick ; les touches de contrôle de la démo y sont refusées.
  - Vérification : tests unitaires de la capture ; test de fumée dans Edge (réassigner le saut, jouer avec, recharger la page, retrouver le choix).
  - Fichiers : `packages/input/src/capture.ts`, `packages/input/src/system.ts`, `packages/input/test/capture.test.ts`, `apps/demo/src/remap.ts`, `apps/demo/src/controls.ts`, `apps/demo/index.html`, `apps/demo/test/smoke.test.ts`

**Point de contrôle C** : relecture humaine. Vous réassignez vos commandes dans la démo.

## Phase D — Tenu

- [x] **T9 : Mesure et relecture finale** (Firefox et Safari non essayés : voir le bilan de la spec)
  - Acceptation : mesure de `sample` à 4 joueurs locaux (temps moyen, mémoire allouée sur 10 000 appels), en échec au-delà de 0,05 ms ou à la moindre allocation ; relecture des huit critères de succès de la spec, chacun marqué vérifié automatiquement, vérifié à la main, ou non vérifié ; essai manuel dans Firefox, et dans Safari si une machine est disponible, consigné tel quel ; carte des capacités mise à jour.
  - Vérification : `pnpm --filter @game/input bench` passe ; compte rendu des critères.
  - Fichiers : `packages/input/bench/sample.bench.ts`, `packages/input/package.json`, `CAPABILITY-MAP.md`

**Point de contrôle D** : relecture humaine, module terminé. Suite : spec du module `netcode`, ou plan audio de `render`.
