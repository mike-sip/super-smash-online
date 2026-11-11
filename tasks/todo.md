# Tâches : module `sim-core`

> Statut : **APPROUVÉ le 2026-11-11**. Plan : [plan.md](plan.md). Tous les chemins sont relatifs à `packages/sim-core/` sauf mention contraire.
>
> Vérification commune à chaque tâche : `pnpm --filter @game/sim-core test` et `pnpm --filter @game/sim-core typecheck` passent.

## Phase A — Fondations

- [x] **T1 : Monorepo et outillage**
  - Acceptation : `pnpm install` fonctionne ; le paquet `@game/sim-core` compile ; un test trivial passe ; une règle ESLint fait échouer tout usage de `Math.random`, `Math.sin`, `Math.cos`, `Math.atan2`, `Math.pow`, `Date` et `performance` dans `src/`.
  - Vérification : `pnpm lint` échoue sur un fichier témoin contenant `Math.random()`, puis passe une fois le témoin retiré.
  - Fichiers : `/package.json`, `/pnpm-workspace.yaml`, `/tsconfig.base.json`, `/eslint.config.js`, `package.json`, `tsconfig.json`, `vitest.config.ts`

- [x] **T2 : Virgule fixe**
  - Acceptation : type `Fx` (Q20.12), `fxMul`, `fxDiv`, `fxSqrt`, `fxSin`, `fxCos` par table versionnée (angles en degrés entiers), conversions depuis des littéraux ; bornes de validité documentées.
  - Vérification : tests unitaires, dont cas aux limites (valeurs négatives, bornes, arrondi vers zéro).
  - Fichiers : `src/fixed.ts`, `src/trig-table.ts`, `test/fixed.test.ts`

- [x] **T3 : État, snapshot, checksum, aléatoire**
  - Acceptation : état en tableaux typés sur un seul `ArrayBuffer` pour 8 joueurs et 32 entités ; `saveState`, `loadState`, `checksum` ; générateur xorshift32 dont la graine vit dans l'état.
  - Vérification : test aller-retour sauvegarde/restauration ; deux états identiques ont le même checksum, un octet modifié le change.
  - Fichiers : `src/state.ts`, `src/rng.ts`, `test/state.test.ts`

- [x] **T4 : Contrats et pipeline vide**
  - Acceptation : `InputFrame` (codage et décodage), `FighterDef`, `StageDef` (`MoveDef` reporté à T9, où il a son premier usage) ; `createSim` et `step` exécutent un pipeline de systèmes vide et incrémentent le compteur de frames ; combattant et stage de test minimalistes ; `index.ts` expose l'API de la spec.
  - Vérification : `createSim` avec 2 puis 8 joueurs, 100 `step`, compteur à 100.
  - Fichiers : `src/input.ts`, `src/defs.ts`, `src/step.ts`, `src/index.ts`, `src/testing/fixtures.ts`

- [x] **T5 : Harnais de déterminisme, de rollback et de performance**
  - Acceptation : générateur de séquences d'inputs à graine ; test de double exécution (même checksum) ; test de propriété `step×N → save → step×M → load → step×M` ; benchmark mesurant temps moyen et 99ᵉ centile de `step`, coût de `saveState`/`loadState` et croissance du tas, avec seuils bloquants.
  - Vérification : `pnpm --filter @game/sim-core test:determinism` et `pnpm --filter @game/sim-core bench` passent.
  - Fichiers : `test/determinism/harness.ts`, `test/determinism/replay.test.ts`, `test/rollback.test.ts`, `bench/step.bench.ts`

**Point de contrôle A** : relecture humaine. L'API publique est figée à partir d'ici.

## Phase B — Mouvement

- [ ] **T6 : Déplacement au sol**
  - Acceptation : marche, dash, course, demi-tour, accroupi, friction ; collision avec un sol plat ; le combattant ne tombe pas du bord en marchant vers un rebord sans input de chute.
  - Vérification : scénarios scriptés (positions attendues frame par frame).
  - Fichiers : `src/systems/movement.ts`, `src/systems/collision.ts`, `test/scenarios/ground.test.ts`

- [ ] **T7 : Sauts, airs et plateformes**
  - Acceptation : pré-saut, saut, short hop (bouton relâché pendant le pré-saut), double saut, dérive aérienne, gravité, fast fall ; murs et plafonds ; plateformes traversables par le bas et par stick bas.
  - Vérification : scénarios scriptés, dont hauteur de saut complet et de short hop.
  - Fichiers : `src/systems/movement.ts`, `src/systems/collision.ts`, `test/scenarios/air.test.ts`

- [ ] **T8 : Zones limites et événements**
  - Acceptation : sortie des zones limites émet un événement KO ; file d'événements par frame, vidée à chaque `step` ; commande de réapparition utilisable par le futur module `match-rules`.
  - Vérification : scénario où un combattant est poussé hors zone, événement KO reçu une seule fois.
  - Fichiers : `src/systems/blast.ts`, `src/events.ts`, `test/scenarios/blast.test.ts`

**Point de contrôle B** : relecture humaine.

## Phase C — Combat

- [ ] **T9 : Machine à états et attaques pilotées par données**
  - Acceptation : états et transitions décrits dans `FighterDef` ; attaque = démarrage, frames actives, récupération ; annulations autorisées par fenêtres ; tampon d'inputs de 6 frames ; attaques au sol, aériennes (avec lag d'atterrissage) et chargées ; un second combattant de test lourd et lent.
  - Vérification : scénarios vérifiant durées exactes, tampon et annulations.
  - Fichiers : `src/systems/fsm.ts`, `src/defs.ts`, `src/testing/fixtures.ts`, `test/scenarios/moves.test.ts`

- [ ] **T10 : Hitbox, hurtbox et hitlag**
  - Acceptation : cercles et capsules par frame ; priorité entre hitbox ; un coup ne touche qu'une fois par cible sauf coups multiples déclarés ; hitlag pour l'attaquant et la cible ; résultat indépendant de l'ordre des joueurs en cas d'échange simultané.
  - Vérification : scénarios, dont échange simultané à 2 joueurs rejoué en inversant les index.
  - Fichiers : `src/systems/hit.ts`, `src/geometry.ts`, `test/scenarios/hit.test.ts`, `test/geometry.test.ts`

- [ ] **T11 : Dégâts, éjection, hitstun, DI, tech**
  - Acceptation : pourcentage ; formule d'éjection (dégâts, poids, base, croissance, angle) ; hitstun proportionnel ; DI ; chute libre désordonnée ; tech au sol et au mur ; rebond ; premier test Playwright de déterminisme sur Chromium.
  - Vérification : test unitaire de la formule sur une table de valeurs ; scénarios DI et tech ; KO obtenu à fort pourcentage.
  - Fichiers : `src/systems/knockback.ts`, `test/knockback.test.ts`, `test/scenarios/knockback.test.ts`, `test/determinism/browser.spec.ts`, `playwright.config.ts`

**Point de contrôle C** : relecture humaine.

## Phase D — Défense et options

- [ ] **T12 : Bouclier**
  - Acceptation : usure à l'usage et aux coups, régénération, bris et étourdissement, shieldstun et recul, parade parfaite au relâchement.
  - Vérification : scénarios, dont bris après N coups connus.
  - Fichiers : `src/systems/shield.ts`, `test/scenarios/shield.test.ts`

- [ ] **T13 : Esquives et invincibilité**
  - Acceptation : esquive sur place, roulades avant et arrière, esquive aérienne neutre et directionnelle, frames d'invincibilité, pénalité en cas d'esquives répétées.
  - Vérification : scénarios où un coup traverse pendant les frames d'invincibilité et touche en dehors.
  - Fichiers : `src/systems/dodge.ts`, `test/scenarios/dodge.test.ts`

- [ ] **T14 : Saisies et projections**
  - Acceptation : saisie (ignore le bouclier), coups pendant la saisie, 4 projections, dégagement selon le pourcentage, saisie simultanée résolue de façon déterministe.
  - Vérification : scénarios pour chaque issue.
  - Fichiers : `src/systems/grab.ts`, `test/scenarios/grab.test.ts`

- [ ] **T15 : Rebords**
  - Acceptation : accroche, un seul occupant par rebord, invincibilité décroissante aux accroches répétées, 5 options de remontée (montée, roulade, attaque, saut, lâcher).
  - Vérification : scénarios pour chaque option.
  - Fichiers : `src/systems/ledge.ts`, `test/scenarios/ledge.test.ts`

- [ ] **T16 : Entités (projectiles et objets)**
  - Acceptation : création et destruction sans allocation (réserve fixe de 32), mouvement, gravité optionnelle, hitbox, durée de vie, propriétaire, collision avec le décor ; un projectile de test.
  - Vérification : scénarios, dont réserve pleine (la création échoue proprement, sans erreur).
  - Fichiers : `src/systems/entities.ts`, `src/testing/fixtures.ts`, `test/scenarios/entities.test.ts`

**Point de contrôle D** : relecture humaine. Chaque ligne du périmètre fonctionnel a son scénario.

## Phase E — Durcissement

- [ ] **T17 : Déterminisme inter-navigateurs**
  - Acceptation : 5 séquences de référence de 36 000 frames à 8 joueurs, checksums versionnés ; identiques dans Node, Chromium, Firefox et WebKit.
  - Vérification : `pnpm --filter @game/sim-core test:determinism` passe sur les 4 environnements.
  - Fichiers : `test/determinism/golden.json`, `test/determinism/browser.spec.ts`, `test/determinism/replay.test.ts`

- [ ] **T18 : Performance, API de lecture et build**
  - Acceptation : seuils de la spec tenus (0,25 ms en moyenne, 1 ms au 99ᵉ centile, snapshot sous 0,05 ms, état sous 64 Ko, aucune allocation) ; `readFighter` et `events` finalisés pour `render` ; build ESM avec déclarations de types ; couverture ≥ 90 %.
  - Vérification : `pnpm --filter @game/sim-core bench`, `pnpm --filter @game/sim-core build`, `pnpm --filter @game/sim-core test -- --coverage`.
  - Fichiers : `src/view.ts`, `src/index.ts`, `bench/step.bench.ts`, `package.json`

**Point de contrôle E** : relecture humaine, module terminé. Spec suivante : `input` ou `render`.
