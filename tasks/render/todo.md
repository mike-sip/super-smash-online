# Tâches : module `render`

> Statut : **VALIDÉ le 2026-11-12**, après relecture contre la spec et le code de `sim-core`. Plan : [plan.md](plan.md).
>
> Vérification commune à chaque tâche : `pnpm --filter @game/render test`, `pnpm --filter @game/render typecheck` et `pnpm lint` passent, et la démo se lance sans erreur de console.

## Phase A — Jouable

- [x] **T1 : Paquets, Three.js et renderer vide**
  - Acceptation : paquets `@game/render` et `@game/demo` dans le monorepo (`apps/*` ajouté à l'espace de travail pnpm) ; `three` installé et figé ; `createRenderer` crée la scène, une caméra fixe et une lumière ; `draw` affiche un fond ; `resize` et `dispose` fonctionnent ; test de non-ingérence en place ; page de démo minimale qui crée une simulation et un renderer.
  - Résolution de `@game/sim-core` : son `package.json` pointe vers `dist/`, qui n'est pas versionné. En développement et en test, un alias Vite et Vitest vise son point d'entrée public dans les sources (une valeur modifiée dans `sim-core` est visible sans recompiler) ; le typecheck et le build passent par `dist/`, construit au préalable par un script. Le `package.json` de `sim-core` n'est pas modifié.
  - Vérification : test unitaire de non-ingérence (checksum identique avant et après `capture` et `draw`) ; la démo affiche un canvas non vide.
  - Fichiers : `pnpm-workspace.yaml`, `packages/render/package.json`, `packages/render/tsconfig.json`, `packages/render/vitest.config.ts`, `packages/render/src/index.ts`, `packages/render/src/renderer.ts`, `packages/render/test/non-intrusive.test.ts`, `apps/demo/package.json`, `apps/demo/vite.config.ts`, `apps/demo/index.html`, `apps/demo/src/main.ts`

- [x] **T2 : Stage, combattants en boîtes et interpolation**
  - Acceptation : le stage est construit à partir de `StageDef` (blocs pleins, plateformes) ; chaque combattant est une boîte à ses dimensions, colorée par joueur ; `capture` mémorise les deux dernières frames ; `draw(alpha)` interpole positions ; une téléportation n'est pas interpolée (pas de traînée à travers l'écran) : réapparition, accroche au rebord, remontée depuis le rebord ; ombre simple au sol sous chaque combattant (disque posé sur la surface en dessous, pas de shadow map).
  - Vérification : tests unitaires de l'interpolation (alpha 0, 0,5 et 1 ; réapparition ; accroche et remontée de rebord) ; capture d'écran.
  - Fichiers : `packages/render/src/stage.ts`, `packages/render/src/interpolation.ts`, `packages/render/src/fighters/visual.ts`, `packages/render/src/renderer.ts`, `packages/render/test/interpolation.test.ts`, `apps/demo/src/main.ts`

- [x] **T3 : Démo jouable**
  - Acceptation : boucle à pas fixe de 60 Hz avec accumulateur, plafonnée pour ne pas s'emballer après un onglet inactif ; clavier et manette provisoires selon les touches de la spec, `Maj` pour un demi-stick ; de 1 à 7 mannequins immobiles ou à inputs aléatoires, choisis par paramètre d'URL ; réapparition automatique après un KO.
  - Vérification : test de fumée Playwright dans Edge (chargement sans erreur, canvas non vide, une touche déplace le joueur 1) ; essai manuel au clavier.
  - Fichiers : `apps/demo/src/main.ts`, `apps/demo/src/temp-input.ts`, `apps/demo/src/dummies.ts`, `apps/demo/test/smoke.test.ts`

**Point de contrôle A** : vous lancez la démo et contrôlez une boîte. Relecture humaine.

## Phase B — Lisible

- [x] **T4 : Caméra automatique**
  - Acceptation : tous les combattants vivants restent à l'écran avec une marge ; zoom borné (ni trop près, ni au-delà des zones limites) ; déplacement et zoom adoucis ; un combattant mort n'est plus cadré.
  - Vérification : tests unitaires du cadrage (un, deux, huit combattants ; combattants aux quatre coins ; bornes) ; essai dans la démo à 8.
  - Fichiers : `packages/render/src/camera.ts`, `packages/render/test/camera.test.ts`, `packages/render/src/renderer.ts`

- [x] **T5 : Mannequins et poses**
  - Acceptation : mannequin procédural (torse, tête, bras, jambes) derrière l'interface `FighterVisual` ; une pose par action de `sim-core`, fonction de `actionFrame` ; orientation gauche ou droite ; les poses d'attaque suivent les phases de l'attaque (préparation, frames actives, récupération) lues dans `MoveDef` (et dans `GrabDef` et `ThrowDef` pour la saisie et les projections) ; transition adoucie entre deux actions ; les membres des 8 mannequins sont dessinés par instances, pour tenir le budget de 100 appels de dessin dès cette tâche.
  - Convention de frame : `actionFrame` lu après un `step` vaut le numéro de frame de l'attaque que ce `step` vient de tester (`HitDef.start` et `end` s'y comparent directement), sauf pendant le hitlag et la charge, où il n'avance pas. Une seule fonction pure porte cette règle ; T8 la réutilise.
  - Vérification : tests unitaires des poses (toutes les actions couvertes, aucune valeur non finie, continuité d'une frame à la suivante au sein d'une action) ; planche de captures des poses.
  - Fichiers : `packages/render/src/fighters/mannequin.ts`, `packages/render/src/fighters/poses.ts`, `packages/render/test/poses.test.ts`

- [x] **T6 : Entités et HUD**
  - Acceptation : projectiles et objets affichés d'après leur type, interpolés ; pourcentage de dégâts par joueur, mis à jour uniquement quand il change ; étiquette de joueur au-dessus de chaque combattant, suivant la caméra.
  - Vérification : test unitaire de la mise à jour minimale du HUD ; capture d'écran avec projectile et pourcentages.
  - Fichiers : `packages/render/src/entities.ts`, `packages/render/src/hud.ts`, `packages/render/test/hud.test.ts`

**Point de contrôle B** : relecture humaine, avec captures.

## Phase C — Outillé

- [x] **T7 : Événements et effets**
  - Acceptation : `capture` ne traite que les frames nouvelles (aucun doublon après re-simulation) ; effets pour coup porté, coup bloqué, parade, bris de bouclier, KO, saisie, accroche ; bulle de bouclier dont la taille suit la résistance ; combattant intangible visuellement distinct ; animation figée et léger tremblement pendant le hitlag ; réserve fixe d'effets, sans création d'objet par effet ; un coup porté par une entité sans propriétaire (attaquant `-1`) est géré.
  - Réinitialisation : une simulation recréée repart de la frame 0, que le filtre prendrait pour déjà vue. La démo détruit et recrée donc le renderer avec la simulation (`dispose` puis `createRenderer`) ; l'API de la spec ne change pas.
  - Vérification : tests unitaires du filtre d'événements (frames rejouées, retour en arrière puis avance, renderer neuf sur une simulation neuve) ; essai dans la démo, réinitialisation comprise.
  - Fichiers : `packages/render/src/events.ts`, `packages/render/src/effects.ts`, `packages/render/test/events.test.ts`

- [x] **T8 : Vue technique et contrôles de la démo**
  - Acceptation : affichage commutable des hitbox actives (attaques, saisie, entités), hurtbox, rebords et zones limites, calculés à partir des mêmes données que la simulation ; panneau d'état par combattant (action, frame, vitesse, dégâts) ; compteur d'appels de dessin et temps de dessin affichés, pour suivre le budget avant T9 ; pause, avance image par image, ralenti à 1/4 et 1/10, réinitialisation.
  - Rebords : `sim-core` n'expose pas leur position. Ils sont recalculés depuis `StageDef` (les deux coins supérieurs de chaque bloc plein, dans le même ordre), sans modifier `sim-core`.
  - Vérification : test unitaire de la position des hitbox affichées contre un cas connu de `sim-core` (jab aux frames 3 et 4, rien à la frame 2 ni à la 5) ; test des rebords contre l'index porté par `EV_LEDGE` sur le stage de test ; essai image par image dans la démo.
  - Fichiers : `packages/render/src/debug.ts`, `packages/render/test/debug.test.ts`, `apps/demo/src/controls.ts`

**Point de contrôle C** : relecture humaine. Votre avis sur le ressenti est attendu ici.

## Phase D — Tenu

- [x] **T9 : Mesure et budget de performance**
  - Acceptation : script de mesure dans Edge sur 10 secondes, 8 combattants à inputs aléatoires et 16 entités ; il rapporte le temps par image (moyenne, 95ᵉ centile), le coût du dessin, le nombre d'appels de dessin et la croissance du tas, et échoue si un seuil de la spec est dépassé ; il indique si le rendu était matériel ou logiciel.
  - Vérification : `pnpm --filter @game/demo perf` passe ; corrections appliquées si un seuil est dépassé.
  - Fichiers : `apps/demo/test/perf.test.ts`, `apps/demo/package.json`, fichiers du rendu à corriger au besoin

- [x] **T10 : Panneau de réglage**
  - Acceptation : panneau listant les valeurs de mouvement du combattant de test et les constantes d'éjection exposées ; une modification recrée la simulation et le renderer avec une copie de la configuration ; export des valeurs en texte, à reporter dans le code ; aucune modification de `sim-core`.
  - Vérification : essai manuel (changer la gravité change la hauteur de saut) ; test de fumée du panneau.
  - Fichiers : `apps/demo/src/tuning.ts`, `apps/demo/src/main.ts`, `apps/demo/test/smoke.test.ts`

**Point de contrôle D** : relecture humaine, module terminé hors audio. Suite : plan audio, ou spec du module `input`.
