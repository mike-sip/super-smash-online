# Tâches : module `stages-items`

> Statut : **APPROUVÉ le 2026-11-13**. Plan : [plan.md](plan.md).
>
> Vérification commune à chaque tâche : `pnpm --filter @game/stages-items test`, `pnpm --filter @game/sim-core test`, les typechecks des paquets touchés et `pnpm lint` passent.

## Phase A — Stages fixes

- [x] **T1 : Paquet et validation des stages**
  - Acceptation : paquet `@game/stages-items` (dépendance `@game/sim-core` seule, alias vers les sources en test comme `render`) ; `validateStage(stage, players)` signale : points d'apparition manquants, hors d'une surface ou confondus ; géométrie hors des zones limites ; plateforme inaccessible (ni d'un saut depuis le sol, ni depuis une autre plateforme, pour un saut de référence de 30 unités).
  - Vérification : tests unitaires sur des stages fautifs construits pour l'occasion, et sur le stage de test de `sim-core` (aucune erreur).
  - Fichiers : `packages/stages-items/{package.json,tsconfig*.json,vitest.config.ts}`, `src/index.ts`, `src/validate.ts`, `test/validate.test.ts`, `eslint.config.js` si nécessaire

- [x] **T2 : Belvédère, Récif et `applyStage`**
  - Acceptation : `StageDef` des deux stages selon la spec, 8 points d'apparition chacun, zones d'apparition d'objets déclarées (ignorées tant que `sim-core` ne les connaît pas) ; registre `STAGES`, `stageById` ; `applyStage(config, id)` renvoie une copie avec le stage remplacé.
  - Vérification : `validateStage` ne signale rien de 2 à 8 joueurs ; scénario : un combattant qui marche jusqu'au bord du Récif s'y accroche ; 600 frames à 8 joueurs à inputs aléatoires sans exception sur chaque stage.
  - Fichiers : `src/stages/belvedere.ts`, `src/stages/recif.ts`, `src/stages/registry.ts`, `src/config.ts`, `test/stages.test.ts`

- [x] **T3 : Choix du stage dans la démo**
  - Acceptation : paramètre d'URL `stage=` et liste déroulante dans la barre d'outils ; changer de stage recrée simulation et renderer ; le stage de test reste disponible (`stage=test`).
  - Vérification : test de fumée (chaque stage se charge sans erreur de console, canvas non vide) ; captures.
  - Fichiers : `apps/demo/src/stage-select.ts`, `apps/demo/src/main.ts`, `apps/demo/index.html`, `apps/demo/package.json`, `apps/demo/vite.config.ts`, `apps/demo/test/smoke.test.ts`

**Point de contrôle A** : commit, captures, relecture humaine.

## Phase B — Stages vivants

- [x] **T4 : Extension de `sim-core`, champs vides et checksums**
  - Acceptation : tous les ajouts de contrats, d'état, d'actions et d'événements de la spec, sans aucune logique ; `STATE_BYTES` mis à jour ; tests d'état adaptés.
  - Vérification : un script compare, sur les 5 séquences de référence et les séquences rapides, positions, vitesses, actions et dégâts finaux de chaque joueur avant et après (identiques) ; puis `golden:update` dans un commit dédié qui l'explique.
  - Fichiers : `packages/sim-core/src/{defs,state,actions,events,step,index}.ts`, `test/state.test.ts`, `test/determinism/golden.json`

- [x] **T5 : Plateformes mobiles**
  - Acceptation : position d'une plateforme = fonction pure de la frame (aller-retour adouci par un polynôme entier) ; surfaces recalculées en début de `step` ; combattants au sol et objets posés portés par leur surface ; atterrissage comparé à la hauteur de la frame précédente ; `readPlatform` pour le rendu ; rien ne change pour une plateforme fixe.
  - Vérification : tests unitaires de la trajectoire (bornes, période, continuité : jamais plus d'un pas maximal entre deux frames) ; scénarios : porté à l'horizontale et à la verticale, atterrissage sur une plateforme qui monte, chute à travers stick bas, quitter le bord d'une barge ; rollback au milieu d'un trajet.
  - Fichiers : `packages/sim-core/src/systems/stage-motion.ts`, `src/systems/collision.ts`, `src/step.ts`, `src/view.ts`, `test/stage-motion.test.ts`, `test/scenarios/moving.test.ts`

- [x] **T6 : Dangers périodiques**
  - Acceptation : `StageDef.hazards` crée, aux frames prévues, une entité sans propriétaire dont la zone de coup est une capsule verticale (`EntityDef.height`) ; le jet touche chaque combattant une fois ; bouclier et intangibilité s'appliquent comme pour un coup d'entité.
  - Vérification : scénarios : rien pendant le bouillonnement, coup au jet, une seule touche, bouclier, phase et période respectées sur plusieurs cycles.
  - Fichiers : `src/systems/stage-motion.ts`, `src/systems/hit.ts`, `test/scenarios/hazards.test.ts`

- [x] **T7 : Canal et Geysers**
  - Acceptation : `StageDef` des deux stages ; entité du jet de geyser ; `applyStage(config, id, { hazards })` ajoute les entités nécessaires après celles de la configuration ; `isHazardEntity`.
  - Vérification : `validateStage` sur les trajectoires complètes ; aucune plateforme mobile ne traverse un bloc plein ; double exécution identique sur 3 600 frames à 8 joueurs ; démo : les deux stages jouables (décor neutre).
  - Fichiers : `packages/stages-items/src/stages/{canal,geysers}.ts`, `src/stages/registry.ts`, `src/config.ts`, `test/stages.test.ts`

**Point de contrôle B** : commit, captures, relecture humaine.

## Phase C — Objets

- [x] **T8 : Apparition et physique des objets**
  - Acceptation : compteur `G_ITEM_TIMER`, délai tiré dans l'intervalle, objet tiré selon les poids, position tirée dans une zone d'apparition ; maximum respecté ; objet libre : gravité, pose sur les blocs et les plateformes (mobiles comprises), rebond sur les flancs, freinage au sol, disparition après sa durée de vie ; aucune apparition sans `SimConfig.items`.
  - Vérification : tests unitaires du tirage (délais, poids sur 10 000 tirages, maximum) ; scénarios : chute et pose sur plateforme, porté par une barge, disparition, sortie des zones limites.
  - Fichiers : `packages/sim-core/src/systems/items.ts`, `src/step.ts`, `test/items-spawn.test.ts`, `test/scenarios/items.test.ts`

- [x] **T9 : Ramasser, lancer, frapper**
  - Acceptation : ramassage à l'attaque au sol à portée ; lancer à la saisie (4 directions, en l'air aussi) et à l'attaque pour un objet à lancer, action `A_ITEM_THROW` ; coup de Bâton `A_ITEM_SWING` avec la hitbox de l'objet ; objet tenu qui suit le combattant ; objet lancé qui frappe (sauf son lanceur) puis redevient libre en touchant le sol ; lâché à l'accroche, détruit au KO.
  - Vérification : un scénario par comportement de la liste ; deux joueurs qui ramassent le même objet à la même frame (le plus petit index l'obtient).
  - Fichiers : `src/systems/items.ts`, `src/systems/movement.ts`, `src/systems/hit.ts`, `src/systems/ledge.ts`, `src/systems/blast.ts`, `test/scenarios/items.test.ts`

- [ ] **T10 : Soin, bris, explosion ; contenu des objets**
  - Acceptation : soin au contact plafonné à 0 % ; bris au contact (Galet) ; rebond et retour au sol (Bâton lancé) ; explosion au contact ou en fin de mèche (Pétard), qui touche aussi le lanceur ; les 5 objets et l'explosion définis dans le paquet ; `applyItems(config, settings)` et `itemOf` ; fréquences `off`, `low`, `normal`, `high`.
  - Vérification : scénarios par objet avec ses vraies données ; `applyItems` respecte `kinds` et ne renumérote pas les entités existantes ; démo : objets activables par `items=`.
  - Fichiers : `src/systems/items.ts`, `packages/stages-items/src/items.ts`, `src/config.ts`, `test/items.test.ts`, `apps/demo/src/main.ts`

- [ ] **T11 : Déterminisme, rollback et vitesse**
  - Acceptation : sur chaque stage, objets à `high`, 8 joueurs à inputs aléatoires : double exécution identique sur 36 000 frames ; propriété sauvegarde/restauration sur 200 tirages ; benchmark de `sim-core` complété d'un scénario avec objets et plateformes mobiles.
  - Vérification : tests passants ; benchmark sous les seuils de la spec.
  - Fichiers : `packages/stages-items/test/determinism.test.ts`, `packages/sim-core/bench/step.bench.ts`

**Point de contrôle C** : commit, compte rendu, relecture humaine. Votre avis sur le ressenti des objets est attendu ici.

## Phase D — Décors et bilan

- [ ] **T12 : Points d'extension de `render`**
  - Acceptation : interface `StageVisuals` (racine de scène, fond, lumières, `capture`, `update(frame, alpha)`, `dispose`) ; décor neutre par défaut identique à l'actuel ; plateformes mobiles interpolées d'après `readPlatform` ; objets dessinés par forme (instances), qui clignotent avant de disparaître, objet tenu devant le combattant ; jet de geyser et bouillonnement ; poses `A_ITEM_THROW` et `A_ITEM_SWING` ; hitbox du coup de Bâton dans la vue technique ; dépendance `@game/stages-items` ajoutée à `render`.
  - Vérification : tests unitaires (choix du décor, repli neutre, position d'une plateforme mobile affichée, non-ingérence sur chaque stage) ; mesure de base des appels de dessin avant et après.
  - Fichiers : `packages/render/src/stages/{decor,items}.ts`, `src/renderer.ts`, `src/fighters/poses.ts`, `src/debug.ts`, `packages/render/package.json`, `vitest.config.ts`, `test/stages.test.ts`

- [ ] **T13 : Quatre décors procéduraux**
  - Acceptation : un décor low-poly par stage, conforme au thème de la spec, généré par le code ; décor statique fusionné ; animations dérivées de la frame (nuages, eau, lanternes, vapeur), jamais de l'horloge ; blocs et plateformes habillés aux couleurs du thème.
  - Vérification : captures de chaque stage ; compteur d'appels de dessin dans la vue technique.
  - Fichiers : `packages/render/src/stages/{palette,belvedere,recif,canal,geysers}.ts`

- [ ] **T14 : Démo et performance**
  - Acceptation : barre d'outils : stage, fréquence des objets, dangers ; mesure de performance lancée sur les 4 stages, objets à `high`.
  - Vérification : `pnpm --filter @game/demo test` et `pnpm --filter @game/demo perf` passent ; captures.
  - Fichiers : `apps/demo/src/stage-select.ts`, `apps/demo/src/main.ts`, `apps/demo/test/{smoke,perf}.test.ts`

- [ ] **T15 : Bilan**
  - Acceptation : bilan des critères de succès et tableau des écarts en fin de spec ; statut de ce plan mis à jour ; note de fusion dans le dossier partagé (numéros à renuméroter, checksums à régénérer).
  - Fichiers : `SPEC-stages-items.md`, `tasks/stages-items/*.md`

**Point de contrôle D** : module terminé. Relecture humaine, avec captures.
