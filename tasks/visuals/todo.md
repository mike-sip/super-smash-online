# Tâches : chantier `visuals` (graphismes v2)

> Spec : [SPEC-visuals.md](../../SPEC-visuals.md). Chaque phase se termine par un jeu jouable, tests, typecheck, lint et mesure de perf au vert, et un compte rendu avec captures.
>
> Vérification commune : `pnpm --filter @game/render test`, `pnpm --filter @game/app test`, `pnpm typecheck`, `pnpm lint` ; `pnpm --filter @game/app perf` (ou `PERF_QUALITY=<niveau>` pour un seul niveau).

## Phase 1 — Pipeline de rendu et qualité

- [x] **V1 : Préréglages de qualité** — `quality.ts` : 4 préréglages, densité de pixels, estimation d'après la carte graphique, ajustement automatique figé après ~5 s. Tests : `test/quality.test.ts`.
- [x] **V2 : Lumières et ombres** — `lighting.ts` : ciel, soleil à carte d'ombre calée sur la caméra (alignée sur les texels), contre-jour, lumière de contour (Fresnel) sur les matières des combattants, objets et entités ; ombre ronde gardée en `Bas`. Matières Lambert remplacées par des matières physiques. Tests : `test/lighting.test.ts`, `test/interpolation.test.ts`.
- [x] **V3 : Post-traitement** — `post/pipeline.ts`, `post/grading.ts` : image HDR anticrénelée (MSAA ×4), bloom, mappage de tons Neutral, étalonnage, vignette, léger bruit anti-bandes ; lumière d'ambiance par image (ciel du thème préfiltré) ; lueurs du décor au-delà de 1 pour rayonner.
- [x] **V4 : Branchement** — `RendererOptions.quality` / `autoStart`, `Renderer.setQuality` / `quality` ; réglage « Qualité graphique » dans l'écran Affichage, appliqué à chaud ; niveau retenu par l'automatique d'un match à l'autre ; `?quality=` dans la démo ; mesure de perf par niveau.

## Phase 2 — Effets et caméra

- [x] **V5 : Particules sur la carte graphique** — `vfx/particles.ts` : réserve tournante écrite une seule fois par particule, mouvement (vitesse, freinage, gravité) calculé par le shader à l'instant affiché ; deux couches (lumineuse additive, fumée) = deux appels de dessin ; formes point, trait, anneau, éclat, bouffée ; limite par qualité (1 000 à 10 000). Tests : `test/particles.test.ts`.
- [x] **V6 : Bibliothèque d'effets** — `vfx/library.ts` : coups (étincelles du côté opposé à l'attaquant, taille selon le hitlag, éclat, anneau, traits rayonnants des coups forts), bouclier touché, parade, contre, bris de bouclier (éclats qui retombent), KO (explosion au bord de l'écran, vers l'intérieur, à la couleur du joueur), saisie, rebord, ultime, soin ; poussière au dash, freinage, demi-tour, roulade, saut, atterrissage (selon la vitesse de chute), anneau d'air au double saut ; traînée de fumée derrière un combattant éjecté ; coup décisif (KO probable estimé à l'éjection) : éclat, lignes de vitesse, gros plan, éclair. Hasard reproductible, rien après un rollback. Tests : `test/vfx.test.ts`.
- [x] **V7 : Caméra** — `camera.ts` : inclinaison de 7° vers le bas (projection des étiquettes et de la vue technique identique à la caméra Three.js), secousses dosées, gros plan bref (au plus un toutes les 1,5 s), coupés dans la vue technique. Tests : `test/camera.test.ts`.
- [x] **V8 : Bouclier et éclair d'écran** — `effects.ts` : bulle à effet de Fresnel, teinte du joueur virant au rouge, fissures quand elle faiblit ; voile coloré porté par la caméra pour les éclairs.
- [x] **V9 : Branchement** — `RendererOptions.screenEffects` ; dans le jeu, coupé par « Mouvements réduits » (ou la préférence du système) ; crochet `place` dans la démo pour mettre en scène un coup.

## Phase 3 — Figurine

- [x] **V10 : Volumes** — `fighters/sdf.ts` : capsules (cônes arrondis), ellipsoïdes, boîtes arrondies, chacun sur un os et dans une zone de couleur, copies symétriques, union douce ; distance signée. Tests : `test/sculpt.test.ts`.
- [x] **V11 : Maillage** — `fighters/mesher.ts` : surface nets sur la grille du champ, sommets ramenés sur la surface, normales par gradient, zone de couleur et zone voisine (transition douce), quatre os et poids par sommet. Surface étanche vérifiée par test. Environ 8 800 triangles par figurine, ~100 ms par personnage, une fois (cache par style).
- [x] **V12 : Squelette** — `fighters/skeleton.ts` : 16 os reprenant exactement la géométrie des poses du mannequin (mêmes pivots, longueurs et angles), membres écartés en pose de référence pour ne pas souder bras et tronc ; `fighters/driver.ts` : pilotage de la pose extrait du mannequin.
- [x] **V13 : Figurine** — `fighters/figurine.ts`, `fighters/body.ts`, `fighters/face.ts` : corps commun d'après les proportions du personnage, pièces du mannequin converties en boîtes arrondies, ou volumes propres du personnage ; matière par joueur (palette par zone dans le shader, pâleur d'intangibilité, éclat blanc pendant le gel d'un coup) ; contour en Haut et Ultra ; yeux et bouche en 3D (deux appels de dessin pour tous), expressions (touché, chute, effort, sonné) et clignement ; corps tourné de 20° vers la caméra, tête de 29° de plus. Tests : `test/figurine.test.ts`.
- [x] **V14 : Sorel** — volumes propres (bandeau et ses pans, chignon, tunique évasée, encolure croisée, ceinture dorée, bandes d'avant-bras, lanières de sandales) et teintes, dans `@game/fighters` (`FighterLook.sculpt`, `palette`).
- [x] **V15 : Branchement** — `createFigurines` remplace `createStyledMannequins` dans le jeu et la démo ; crochet `inspect` (caméra figée) pour la vérification visuelle et les futurs portraits.

## Phase 4 — Les quatre personnages

- [x] **V16 : Volumes propres** — Zéphine (queue de cheval, frange, lunettes relevées, écharpe, sacoche, bottes à plumes), Ferroc (barbe, tablier de cuir, épaulières, bracelets de fer, gantelets incandescents, ceinturon et chaîne, bottes), Nacre (couronne de corail, longues mèches, robe-coquillage irisée, collier de perles, voiles, bâton de corail), dans `@game/fighters`.
- [x] **V17 : Couleurs alternatives** — huit par personnage (`FighterLook.palettes`) ; choix à la sélection locale (↑ ↓, pastille et « couleur n/8 ») ; `distinctPalettes` : deux joueurs sur le même personnage diffèrent toujours (local, en ligne, démo, fond des menus). Tests : `test/figurine.test.ts`, `apps/game/test/local-setup.test.ts`.
- [x] **V18 : Matières** — zone incandescente (gantelets de Ferroc, qui s'embrasent pendant la charge d'un smash) et zone irisée (robe de Nacre), dans le shader de la figurine.
- [x] **V19 : Effets propres** — thèmes rafale (Sorel), plume (Zéphine), braise (Ferroc), perle (Nacre) : spirale autour du corps pendant les spéciaux et l'ultime, touches au repos (braises, bulles) et à la course (plumes, souffles) ; gerbe de l'ultime au thème ; projectiles lumineux à la couleur du thème de leur lanceur, avec traînée ; assombrissement du décor pendant l'ultime. Tests : `test/vfx.test.ts`.

## Phase 5 — Animation

- [x] **V20 : Coups** — `poses.ts` : préparation tenue en douceur, départ sec vers le coup (`snap`, borné à 2,6 rad par frame), retombée avec léger dépassement (`settle`). Tests : `test/animation.test.ts`, `test/poses.test.ts`.
- [x] **V21 : Fondus et pas** — `driver.ts` : durée du fondu selon l'action visée (1,5 frame vers un coup, un choc ou la garde ; 5 vers le repos, la marche, l'atterrissage) ; cycle des jambes calé sur la distance parcourue (marche, dash, course) : les pieds ne glissent plus.
- [x] **V22 : Écrasement et étirement** — `squash.ts` : tassement avant le saut et à l'atterrissage, étirement en montée, compression sous l'impact ; volume conservé, depuis les pieds.
- [x] **V23 : Mouvements secondaires** — `dynamics.ts` : chaînes à deux segments sur ressorts amortis (inertie de l'accélération, pendaison malgré l'inclinaison du corps, bornées) ; cinq os secondaires (cheveux, pans de tissu, jupe) ; pièces portées par ces os (`SculptPart.frame`) : pans du bandeau et tunique de Sorel, queue de cheval et écharpe de Zéphine, mèches, voiles et robe de Nacre, tablier et chaîne de Ferroc.
- [x] **V24 : Traînées** — `trails.ts` : ruban lumineux qui suit la main ou le pied le plus rapide pendant les frames actives, à la couleur du thème du personnage ; un appel de dessin pour tous.

## Phase 6 — Décors vivants

- [x] **V25 : Ciel** — `stages/sky.ts` : dôme par shader (dégradé, nuages qui dérivent, étoiles, soleil ou lune lumineux) ; remplace les plans de ciel, soleil, lune et étoiles des quatre stages (`Theme.skyLook`).
- [x] **V26 : Eau** — `stages/water.ts` : vagues (Gerstner) dans une matière physique, reflet du ciel ; Canal et Récif (`Theme.water`).
- [x] **V27 : Grain des matières** — `stages/surface.ts` : teinte et relief procéduraux en espace monde sur la pierre, le bois et la roche, effacés au loin (110 à 300 unités) ; aucune texture stockée.
- [x] **V28 : Air vivant** — `createMotes` : particules d'ambiance en boucle, propres à chaque stage (poussière dorée, lucioles, plancton, braises), animées par le shader.
- [x] **V29 : Salle d'entraînement** — `stages/grid.ts` : ciel clair et grille de fond. Tests : `test/stage-visuals.test.ts`.
- Non fait (voir les écarts de la spec) : flou de fond, occlusion ambiante, oiseaux et autres animaux.

## Phase 7 — Assets d'interface

- [x] **V30 : Studio de portraits** — `portraits.ts` : photographie hors écran d'une figurine (buste, tête, corps entier dans une pose de victoire), fond transparent, gardée en mémoire ; `apps/game/src/portraits.ts` : aucun portrait sans WebGL.
- [x] **V31 : Sélection** — portrait de chaque personnage dans sa couleur sur la carte du joueur.
- [x] **V32 : HUD** — tête du personnage en haut de la carte de chaque joueur (`createMatchDomSink(…, icons)`), en local et en ligne.
- [x] **V33 : Victoire** — le vainqueur en figurine dans une pose de victoire tirée au hasard (`VICTORY_POSES`), animation d'entrée coupée par « Mouvements réduits ».
- [x] **V34 : Entrée en scène** — la figurine surgit avec un léger rebond et un éclat blanc pendant les 30 premières frames (`entrance`). Tests : `test/animation.test.ts`.
- [x] **Correctif** — le menu de pause masqué assombrissait tout le combat local (`.dialog[hidden]`).
- Non fait : provocations (aucune action dans la simulation), scène de victoire en 3D animée.
