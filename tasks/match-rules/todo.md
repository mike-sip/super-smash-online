# Tâches : module `match-rules`

> Statut : **VALIDÉ le 2026-11-13.** Plan : [plan.md](plan.md).
>
> Vérification commune à chaque tâche : les tests des paquets touchés, `pnpm -r typecheck` et `pnpm lint` passent. En phase A, **tous les tests existants de `sim-core` passent sans modification** (hors checksums de référence, régénérés en T5).

## Phase A — Fondations dans `sim-core`

- [x] **T1 : Crochet de règles et zone d'état réservée**
  - Acceptation : `SimRules { init(sim); afterStep(sim) }` et `SimConfig.rules` facultatif ; `init` appelé à la fin de `createSim`, `afterStep` à la fin de `step` après l'incrément de frame ; `RULES_WORDS = 256` mots ajoutés à la fin du tampon ; `rulesState(sim)` renvoie une vue `Int32Array` sur cette zone, créée une fois ; sauvée, restaurée et comptée par le checksum comme le reste.
  - Vérification : scénarios (le crochet voit les événements de la frame ; une valeur écrite dans la zone survit à `saveState`/`loadState` et change le checksum ; sans crochet, aucun appel) ; test de rollback existant inchangé.
  - Fichiers : `packages/sim-core/src/state.ts`, `step.ts`, `index.ts`, `packages/sim-core/test/scenarios/rules.test.ts`

- [x] **T2 : Équipes et tir allié**
  - Acceptation : `SimConfig.teams` et `SimConfig.teamAttack` (vrai par défaut), validés à `createSim` (une équipe par joueur) ; sans tir allié, ni attaque, ni entité d'un coéquipier (d'après `eOwner`), ni saisie ne touche ; une entité sans propriétaire touche tout le monde.
  - Vérification : scénarios pour les trois cas, avec et sans tir allié, et adversaire d'une autre équipe toujours touché.
  - Fichiers : `packages/sim-core/src/step.ts`, `systems/hit.ts`, `systems/grab.ts`, `packages/sim-core/test/scenarios/teams.test.ts`

- [x] **T3 : Invincibilité de réapparition, `knockOut`, `setDamage`**
  - Acceptation : champ `invincible` en fin de liste, décrémenté chaque frame, vérifié avec `intangible` pour les coups, entités et saisies ; `respawn(sim, player, invincibleFrames = 0)` ; `FighterView.invincible` ; `knockOut` met le combattant en `A_DEAD` comme une sortie de zone limite et émet `EV_KO` (sans effet sur un combattant déjà KO) ; `setDamage` impose les dégâts.
  - Vérification : scénarios (invincible non touché puis touché à l'expiration ; une esquive pendant l'invincibilité ne la raccourcit pas ; `knockOut` ; `setDamage` change l'éjection reçue).
  - Fichiers : `packages/sim-core/src/state.ts`, `step.ts`, `view.ts`, `index.ts`, `systems/hit.ts`, `systems/grab.ts`, `systems/blast.ts`, `packages/sim-core/test/scenarios/match-support.test.ts`

- [x] **T4 : Attaque ultime**
  - Acceptation : `M_ULTIMATE = 20`, `MOVE_SLOTS = 21` ; champ `ultimateReady` ; `setUltimateReady` ; spécial neutre avec drapeau levé et coup défini → `M_ULTIMATE`, drapeau remis à 0, `EV_ULTIMATE` émis ; sans coup défini, spécial neutre normal et drapeau conservé ; `FighterView.ultimateReady` ; le combattant de test reçoit une ultime provisoire (coup puissant à large portée).
  - Vérification : scénarios (au sol, en l'air, sans drapeau, sans coup défini, spécial latéral avec drapeau → spécial latéral normal).
  - Fichiers : `packages/sim-core/src/moves.ts`, `state.ts`, `events.ts`, `systems/movement.ts`, `view.ts`, `index.ts`, `testing/fixtures.ts`, `packages/sim-core/test/scenarios/ultimate.test.ts`

- [x] **T5 : Checksums de référence et spec de `sim-core`**
  - Acceptation : `golden.json` régénéré dans un commit dédié qui explique pourquoi (taille de l'état et ultime du combattant de test) ; section « Ajouts demandés par `match-rules` » ajoutée à `SPEC-sim-core.md` (API et disposition mémoire) ; benchmark de `sim-core` toujours sous ses seuils.
  - Vérification : `pnpm --filter @game/sim-core test` (déterminisme Node et navigateurs disponibles) et `bench` passent.
  - Fichiers : `packages/sim-core/test/determinism/golden.json`, `SPEC-sim-core.md`

**Point de contrôle A** : relecture du diff de `sim-core` (additif uniquement).

> Fait le 2026-11-13. Écarts : les tests de forme `state.test.ts` et `view.test.ts` ont été étendus aux nouveaux champs (rien de retiré) ; le test de déterminisme WebKit ne démarre plus sur la machine (`spawn UNKNOWN`, comme Firefox), vérifié dans Node et Edge seulement.

## Phase B — Règles

- [x] **T6 : Paquet et `MatchConfig`**
  - Acceptation : paquet `@game/match-rules` (même outillage que `render` : alias vers les sources de `sim-core` en test, build préalable pour le typecheck) ; règle de lint anti-non-déterminisme étendue à `packages/match-rules/src` ; `MatchConfig`, `defaultMatchConfig`, `validateMatchConfig` (un message par erreur, champs inconnus refusés, bornes de la spec, au moins deux équipes distinctes en équipes) ; `createMatchSimConfig` (lève si invalide ; transmet équipes et tir allié à `sim-core`).
  - Vérification : tests de validation (chaque champ, chaque borne, types faux, aller-retour JSON, toutes les configurations par défaut acceptées).
  - Fichiers : `packages/match-rules/*`, `pnpm-workspace.yaml` si besoin, `eslint.config.js`, `src/config.ts`, `src/index.ts`, `test/config.test.ts`

- [x] **T7 : Mode Stock**
  - Acceptation : disposition de la zone réservée (`layout.ts`) ; KO détecté par l'état (`A_DEAD`) ; vie retirée ; réapparition après 90 frames avec 120 frames d'invincibilité ; élimination à 0 vie (plus de réapparition) ; fin quand il ne reste qu'un joueur ou une équipe ; après la fin, plus aucune modification ; `readMatch` et `createMatchView`.
  - Vérification : scénarios (KO puis réapparition au bon délai, invincible, élimination, victoire en chacun pour soi et en équipes).
  - Fichiers : `src/layout.ts`, `src/rules.ts`, `src/view.ts`, `test/scenarios/stock.test.ts`, `test/helpers.ts`

- [x] **T8 : Attribution des KO et statistiques**
  - Acceptation : dernier attaquant mémorisé sur `EV_HIT` (frame comprise), crédit dans les 480 frames, effacé à la réapparition ; KO, chutes, autodestructions, score ; KO par coéquipier sans crédit ; dégâts infligés et subis d'après la hausse des dégâts, partagés entre attaquants de la même frame selon la règle de la spec.
  - Vérification : tests (crédit, expiration, autodestruction, coéquipier, partage avec reste, soin ignoré).
  - Fichiers : `src/rules.ts`, `test/scenarios/credit.test.ts`

- [x] **T9 : Modes Temps et Endurance**
  - Acceptation : chronomètre en frames, décompté pendant la phase de jeu ; Temps : réapparition sans limite de vies, fin au temps ; Endurance : `knockOut` à 0 PV, vies, PV pleins à la réapparition ; limite de temps facultative en Stock et Endurance.
  - Vérification : scénarios (fin du temps à la frame exacte, Endurance à 0 PV, sortie de zone en Endurance, Stock avec limite de temps).
  - Fichiers : `src/rules.ts`, `test/scenarios/time.test.ts`, `test/scenarios/stamina.test.ts`

- [x] **T10 : Fin de match, mort subite et résultats**
  - Acceptation : départage à la fin du temps (vies puis dégâts, ou PV ; score en Temps, somme d'équipe) ; mort subite entre ex æquo (1 vie, 300 % ou 1 PV), répétée après élimination simultanée ; classement par ordre d'élimination inverse ou par score, ex æquo partagés, place d'équipe ; `matchResult` complet.
  - Vérification : tests de la logique pure de départage et de classement ; scénarios (élimination simultanée des deux derniers → mort subite ; égalité au temps → mort subite ; résultats d'un match en équipes).
  - Fichiers : `src/outcome.ts`, `src/rules.ts`, `src/view.ts`, `test/outcome.test.ts`, `test/scenarios/sudden-death.test.ts`

- [x] **T11 : Jauge d'ultime**
  - Acceptation : remplissage selon la spec en virgule fixe ; pleine → `setUltimateReady` ; ultime lancée (drapeau retombé) → jauge vidée, compteur `ultimatesUsed` ; conservée après une chute ; inactive si `ultimate` est faux.
  - Vérification : scénarios (remplissage exact par dégâts infligés et subis, déclenchement de l'ultime du combattant de test, jauge désactivée).
  - Fichiers : `src/rules.ts`, `test/scenarios/ultimate.test.ts`

**Point de contrôle B** : relecture des scénarios contre le tableau « Règles détaillées ».

> Fait le 2026-11-14. Écarts : tous les scénarios de T7 à T11 ont été écrits avant le moteur, puis le moteur (`rules.ts`) en une passe, commités ensemble (un commit pour la phase B au lieu d'un par tâche, à cause d'une interruption). Le partage des dégâts entre plusieurs attaquants n'est testé qu'en unitaire (`splitShare`) : `sim-core` ne signale qu'un propriétaire quand plusieurs projectiles touchent la même victime à la même frame. La détection d'une ultime lancée passe par `EV_ULTIMATE` (et non par le drapeau retombé, comme prévu au plan) pour fonctionner aussi avec la variante de `fighters` où `respawn` remet le drapeau à 0.

## Phase C — Robustesse

- [ ] **T12 : Rollback et déterminisme**
  - Acceptation : propriété de rollback sur 500 tirages (mode, équipes, joueurs, inputs aléatoires, points de sauvegarde au hasard, y compris après la fin) ; 3 matchs de référence à 8 joueurs (Stock, Temps en équipes, Endurance) dont checksums et résultats sont versionnés ; script de régénération.
  - Vérification : `pnpm --filter @game/match-rules test:determinism`.
  - Fichiers : `test/determinism/*`, `package.json`

- [ ] **T13 : Coût du crochet**
  - Acceptation : benchmark à 8 joueurs : coût moyen du crochet sous 0,02 ms (différence entre `step` avec et sans règles), croissance du tas sous 32 Ko sur 10 000 frames.
  - Vérification : `pnpm --filter @game/match-rules bench`.
  - Fichiers : `bench/rules.bench.ts`

**Point de contrôle C** : chiffres de rollback, déterminisme et coût.

## Phase D — Visible

- [ ] **T14 : HUD de match dans `render`**
  - Acceptation : nouveau fichier `match-hud.ts` ; interface de données propre (compatible avec `MatchView`) ; chronomètre (et « Mort subite »), vies ou PV, score en Temps, jauge avec état « prête », pastille d'équipe ; DOM touché seulement quand une valeur affichée change ; seul `index.ts` est modifié parmi les fichiers existants.
  - Vérification : test unitaire de la mise à jour minimale ; capture d'écran.
  - Fichiers : `packages/render/src/match-hud.ts`, `packages/render/src/index.ts`, `packages/render/test/match-hud.test.ts`

- [ ] **T15 : Démo : choix du match et règles**
  - Acceptation : panneau de choix (mode, vies, temps, PV, équipes et équipe de chaque joueur, tir allié, ultime) avant le match et à la réinitialisation, aussi pilotable par paramètres d'URL pour les tests ; simulation créée par `createMatchSimConfig` ; la réapparition automatique de la démo est remplacée par celle des règles ; HUD de match alimenté par `readMatch`.
  - Vérification : test de fumée existant inchangé ; essai manuel de chaque mode.
  - Fichiers : `apps/demo/src/match-setup.ts`, `apps/demo/src/main.ts`, `apps/demo/index.html`, `apps/demo/package.json`

- [ ] **T16 : Écran de résultats et bilan**
  - Acceptation : à la fin du match, écran listant classement, gagnants et statistiques ; bouton « Rejouer » (même configuration) et « Changer de règles » ; test Playwright dans Edge : match court en Stock à 1 vie avec adversaires aléatoires, ou en Temps de 30 s, jusqu'à l'écran de résultats ; bilan des critères de succès écrit en fin de spec.
  - Vérification : `pnpm --filter @game/demo test` ; captures du HUD et des résultats.
  - Fichiers : `apps/demo/src/results.ts`, `apps/demo/test/match.test.ts`, `SPEC-match-rules.md`

**Point de contrôle D** : essai de la démo par vous ; module terminé.
