# Tâches : module `fighters`

> Statut : **VALIDÉ le 2026-11-13.** Plan : [plan.md](plan.md).
>
> Vérification commune à chaque tâche : `pnpm -r test` (paquets touchés), `pnpm -r typecheck` et `pnpm lint` passent. Pour les tâches de `sim-core` : scénarios existants inchangés et checksums de référence à jour.

## Phase A — Moteur (extensions de `sim-core`)

- [x] **T1 : Élan et invincibilité d'un coup (E1, E3)**
  - Acceptation : `MotionDef { start, end, velX?, velY? }` et `MoveDef.motion` ; pendant une fenêtre, la vitesse horizontale vaut `regard × velX` et/ou la verticale vaut `velY`, et le contrôle aérien est suspendu ; une vitesse verticale positive au sol fait décoller sans quitter l'attaque ; au sol, un coup qui avance s'arrête au bord du stage (règle existante). `MoveDef.intangible { start, end }` : aucun coup ni saisie ne touche pendant la fenêtre.
  - Vérification : scénarios écrits d'abord — fente au sol (distance parcourue), montée depuis le sol (décollage, hauteur atteinte), plongeon en l'air, coup sans `motion` inchangé, intangibilité qui fait passer une attaque adverse à travers.
  - Fichiers : `packages/sim-core/src/defs.ts`, `src/systems/movement.ts`, `src/index.ts`, `test/scenarios/specials.test.ts`, `src/testing/fixtures.ts` (coups de test supplémentaires dans un combattant de test séparé, `TEST_SPECIALIST`, pour ne pas changer `TEST_FIGHTER`)

- [x] **T2 : Chute impuissante (E2)**
  - Acceptation : `MoveDef.helpless` ; à la fin d'un tel coup en l'air, action `A_HELPLESS` (31) : dérive possible, ni saut, ni attaque, ni esquive ; accroche au rebord possible ; atterrissage avec le lag d'atterrissage du coup ; un coup reçu en fait sortir. Les tests de plage d'actions de `movement.ts`, `collision.ts` et `step.ts` excluent explicitement la nouvelle valeur.
  - Vérification : scénarios — sauts et attaques refusés en chute impuissante, accroche au rebord, lag d'atterrissage, sortie par un coup reçu ; même coup lancé et terminé au sol : retour au repos.
  - Fichiers : `packages/sim-core/src/actions.ts`, `src/defs.ts`, `src/systems/movement.ts`, `src/systems/collision.ts`, `src/systems/ledge.ts`, `src/index.ts`, `test/scenarios/specials.test.ts`

- [x] **T3 : Armure et contre (E4, E5)**
  - Acceptation : `MoveDef.armor { start, end, maxKnockback }` : sous le seuil, dégâts et gel subis, attaque non interrompue ; au-dessus, coup normal. `MoveDef.counter { start, end, to }`, emplacements `M_EXTRA1`, `M_EXTRA2`, événement `EV_COUNTER` : frappé pendant la fenêtre, aucun dégât, le défenseur se tourne vers l'attaquant et lance `to` ; l'attaquant reçoit le gel supplémentaire d'une parade ; un projectile déclenche aussi le contre. Priorité dans `hit.ts` : bouclier, parade, contre, armure, coup normal.
  - Vérification : scénarios — armure sous et au-dessus du seuil, contre sur une attaque et sur un projectile, contre hors fenêtre, deux attaquants simultanés.
  - Fichiers : `packages/sim-core/src/defs.ts`, `src/moves.ts`, `src/events.ts`, `src/systems/hit.ts`, `src/systems/movement.ts`, `src/index.ts`, `test/scenarios/specials.test.ts`

- [x] **T4 : Attaque ultime (E6) et checksums**
  - Acceptation : `M_ULTIMATE` (20), `MOVE_SLOTS` = 23 ; champ d'état `ultimateReady` en fin de liste ; `setUltimateReady(sim, player, ready)` ; `FighterView.ultimateReady` ; spécial neutre avec drapeau levé → ultime, drapeau baissé, `EV_ULTIMATE` émis ; drapeau levé sans ultime définie → spécial neutre normal, drapeau conservé ; `respawn` baisse le drapeau. Checksums de référence régénérés dans un commit dédié.
  - Vérification : scénarios — déclenchement, drapeau baissé, événement, spéciaux de côté et haut non détournés, rollback conserve le drapeau ; tests de déterminisme et de rollback passent avec les nouvelles références ; benchmark sous ses seuils.
  - Fichiers : `packages/sim-core/src/moves.ts`, `src/state.ts`, `src/step.ts`, `src/view.ts`, `src/events.ts`, `src/systems/movement.ts`, `src/index.ts`, `test/scenarios/specials.test.ts`, `test/determinism/golden.json`, `SPEC-sim-core.md` (API publique et tableau des écarts, en mentionnant la spec de `fighters`)

**Point de contrôle A** : relecture des scénarios des six extensions ; suite complète de `sim-core` au vert.

## Phase B — Outillage

- [x] **T5 : Paquet, constructeurs, roster et assemblage du match**
  - Acceptation : paquet `@game/fighters` (même organisation que `render` : alias vers les sources de `sim-core` en test, build préalable pour le typecheck) ; constructeurs `hit`, `move`, `moveset` ; type `Character`, `ROSTER` (vide de personnages réels à ce stade, le combattant de test sert aux tests d'outillage), `character(id)` ; `buildMatchConfig` avec renumérotation des projectiles après les entités du stage ; données figées en profondeur.
  - Vérification : tests d'assemblage — 2 et 8 joueurs, entités de stage en tête, même personnage plusieurs fois (ses projectiles une seule fois dans la liste), `kind` renumérotés pointant vers le bon type ; la `FighterDef` d'origine n'est pas modifiée.
  - Fichiers : `packages/fighters/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `src/index.ts`, `src/build.ts`, `src/roster.ts`, `src/match.ts`, `test/match.test.ts`

- [x] **T6 : Validation**
  - Acceptation : `validateCharacter` applique toutes les règles de la spec, chaque problème nommant personnage, coup et champ ; script `pnpm --filter @game/fighters validate` qui liste les problèmes et échoue s'il y en a.
  - Vérification : un test par règle avec une donnée fautive construite pour la déclencher ; le combattant de test de `sim-core` habillé en `Character` ne lève que les problèmes attendus (moveset incomplet).
  - Fichiers : `packages/fighters/src/validate.ts`, `scripts/validate.ts`, `test/validate.test.ts`

- [x] **T7 : Frame data et empreinte**
  - Acceptation : `frameData` et `frameDataMarkdown` (valeurs de mouvement, puis une ligne par coup : démarrage, actives, total, dégâts avec charge max, angle, éjection, lag d'atterrissage, notes) ; script qui régénère `FRAMEDATA.md` ; `fingerprint` stable sur 32 bits, sensible à toute valeur.
  - Vérification : test des lignes sur des coups connus (jab de test : démarrage 3, actives 3–4, total 16) ; test « tableau versionné à jour » ; empreinte identique sur deux constructions, différente après modification d'une seule valeur.
  - Fichiers : `packages/fighters/src/framedata.ts`, `src/fingerprint.ts`, `scripts/framedata.ts`, `FRAMEDATA.md`, `test/framedata.test.ts`

**Point de contrôle B** : vous lancez `validate` et lisez un tableau de frame data.

## Phase C — Sorel, personnage de référence

- [x] **T8 : Sorel, données et scénarios**
  - Acceptation : moveset complet (21 emplacements, saisie, 4 projections, riposte du contre en `M_EXTRA1`), valeurs de mouvement de la spec, projectile *Trait de vent* ; validation sans problème ; tableau de frame data régénéré.
  - Vérification : scénarios — chaque emplacement déclenché par son input touche un adversaire placé devant ; projectile créé ; contre ; ultime avec le drapeau ; retour sur le stage depuis 50 unités au-delà et 30 sous le rebord.
  - Fichiers : `packages/fighters/src/characters/sorel.ts`, `src/roster.ts`, `test/characters/helpers.ts`, `test/characters/sorel.test.ts`, `FRAMEDATA.md`

- [x] **T9 : Mannequin stylé et poses**
  - Acceptation : `createStyledMannequins(styleOf)` dans `render` ; le mannequin par défaut reste identique ; style = couleurs, proportions, pièces ajoutées (dont une à la couleur du joueur), toujours dans les deux maillages instanciés ; poses génériques pour `M_SSPECIAL`, `M_USPECIAL`, `M_DSPECIAL`, `M_ULTIMATE`, `M_EXTRA1/2` et `A_HELPLESS` ; `FighterLook` de Sorel.
  - Vérification : tests de poses (finies, continues) ; test du style (dimensions et couleurs des pièces, pièces masquées sans style) ; capture de Sorel ; compteur d'appels de dessin inchangé.
  - Fichiers : `packages/render/src/fighters/mannequin.ts`, `src/fighters/poses.ts`, `src/index.ts`, `test/poses.test.ts`, `test/scene.test.ts`, `packages/fighters/src/characters/sorel.ts`

- [ ] **T10 : Démo : choix du personnage, ultime, frame data**
  - Acceptation : panneau « Personnages » (un choix par joueur, aussi par URL `?p1=sorel&p2=…`), qui recrée simulation et renderer ; le combattant de test reste choisissable ; bouton « ultime prête » qui lève le drapeau de tous les joueurs ; affichage du tableau de frame data du personnage de J1 ; le panneau de réglage s'applique au personnage choisi.
  - Vérification : test Playwright dans Edge (choisir Sorel pour J1 : nom et taille lus dans la simulation ; lancer l'ultime après le bouton) ; essai manuel.
  - Fichiers : `apps/demo/package.json`, `apps/demo/vite.config.ts`, `apps/demo/index.html`, `apps/demo/src/main.ts`, `apps/demo/src/roster-panel.ts`, `apps/demo/test/smoke.test.ts`

**Point de contrôle C** : **vous jouez Sorel dans la démo et donnez votre avis sur le ressenti.** J'applique les réglages demandés, puis je n'engage la phase D qu'avec votre accord.

## Phase D — Les trois autres et le bilan

- [ ] **T11 : Zéphine** — données, projectile *Plumes*, `FighterLook`, scénarios (mêmes vérifications que T8, retour sur le stage compris) ; frame data régénéré.
  - Fichiers : `packages/fighters/src/characters/zephine.ts`, `src/roster.ts`, `test/characters/zephine.test.ts`, `FRAMEDATA.md`

- [ ] **T12 : Ferroc** — données (armure du *Bélier* et du *Rempart*), `FighterLook`, scénarios (armure comprise) ; frame data régénéré.
  - Fichiers : `packages/fighters/src/characters/ferroc.ts`, `src/roster.ts`, `test/characters/ferroc.test.ts`, `FRAMEDATA.md`

- [ ] **T13 : Nacre** — données, projectiles *Perle*, *Galet*, *Corail* et *Grande perle*, `FighterLook`, scénarios (pièges, projectile en cloche) ; frame data régénéré.
  - Fichiers : `packages/fighters/src/characters/nacre.ts`, `src/roster.ts`, `test/characters/nacre.test.ts`, `FRAMEDATA.md`

- [ ] **T14 : Identité, 8 joueurs, performance et bilan**
  - Acceptation : tests d'identité des archétypes ; séquence de 3 600 frames à 8 joueurs mêlant les quatre (déterminisme sur deux exécutions, propriété de rollback) ; mesure d'un `step` à 8 joueurs avec ces personnages ; bilan des critères de succès en fin de spec ; écarts constatés consignés.
  - Vérification : la suite complète au vert ; mesure consignée dans le bilan.
  - Fichiers : `packages/fighters/test/archetypes.test.ts`, `test/match.test.ts`, `bench/step.bench.ts`, `SPEC-fighters.md`

**Point de contrôle D** : vous jouez les quatre, à plusieurs ; relecture du bilan.
