# Tâches : chantier `finition` (rendu AAA)

> Spec : [SPEC-finition.md](../../SPEC-finition.md). Chaque phase se termine par un jeu jouable, tests, typecheck, lint et mesure de perf au vert, et un compte rendu avec captures.
>
> Vérification commune : `pnpm --filter @game/render test`, `pnpm --filter @game/app test`, `pnpm --filter @game/app typecheck`, `pnpm lint` ; `pnpm --filter @game/app perf`.

## Phase 1 — Décors AAA

- [x] **F1 : Assets libres** — lot approuvé, récupéré et relu : 11 matières Poly Haven (couleur, relief, occlusion-rugosité-métal, 1K), 5 HDRI 1K, police Lilita One (OFL) ; [assets/SOURCES.md](../../assets/SOURCES.md) ; servis à la racine du jeu et de la démo (`publicDir` de Vite), copiés dans l'image Docker.
- [x] **F2 : Chargeur** — `assets/loader.ts` : `configureAssets`, matières utilisables tout de suite (images d'un pixel remplacées à l'arrivée, sans recompilation), libération de la mémoire graphique des matières d'autres stages, anisotropie selon la qualité, HDRI à la demande. Tests : `test/stage-assets.test.ts`.
- [x] **F3 : Matière triplanaire** — `stages/triplanar.ts` : couleur, relief (mélange UDN), rugosité et occlusion projetés sur les trois axes du monde, nuances des sommets gardées, bruit à grande échelle contre la répétition ; repère de l'objet pour les plateformes mobiles.
- [x] **F4 : Branchement** — `Theme.surfaces` / `ctx.surface(name)` (une pièce par matière), `Theme.hdri` (ambiance remplacée à l'arrivée), `platformShape`, `moverShape`, `cloudSea`, `rays` ; préréglages `textures` et `anisotropy` (`Bas` : couleurs et grain) ; `StageVisuals.setQuality` / `dispose`.
- [x] **F5 : Géométrie sculptée** — `stages/sculpt.ts` : bruit 3D, déformation sans fissure, peinture douce par sommet, pavés arrondis, pièces tournées (balustres, colonnes), rochers.
- [x] **F6 : Belvédère** — terrasse de grès (dalle fissurée, corniche, bandeau de blocs, moulure), balustrade tournée à piliers, éperon de roche moussue, planchers de bois sur corbeaux, falaises au plan moyen, îles flottantes avec arbres et colonnes brisées, mer de nuages en nappes (`stages/cloudsea.ts`), rayons.
- [x] **F7 : Récif** — dalle de basalte mouillée, orgues hexagonales jointives en tronçons, gradins jusqu'à l'eau, deux grands pitons, coraux ramifiés, en boule et en éventail.
- [x] **F8 : Canal** — quai pavé, margelle, mur de briques, escaliers vers l'eau, pieux, bornes ; maisons de briques à pignon, fenêtres encadrées, reflets des fenêtres sur l'eau ; toits et clochers au loin ; barge à coque, nacelles à cordes ; lanternes en papier sur corde.
- [x] **F9 : Bassin** — dessus minéral, strates bordées de travertin, évents encroûtés, vapeur douce ; plateformes de travertin à concrétions ; terrasses à bassins sous le sol de jeu ; volcan au cratère rougeoyant ; rayons.
- [x] **F10 : Entraînement** — carrelage texturé, HDRI de plein jour.
- [x] **F11 : Cadrage et eau** — combattants ~23 % plus grands ; eau qui reflète le ciel du stage (`WaterLook.reflect`).

## Phase 2 — Personnages v2

- [x] **F12 : Proportions héroïques** — `body.ts` : tête (×1,16), mains (×1,35) et pieds (×1,12) agrandis autour de leur jointure, pièces du personnage comprises (`figurineDims`, `boosted`) ; hitbox inchangées (simulation).
- [x] **F13 : Mains à doigts** — paume, quatre doigts et pouce sur deux nouveaux os par main (`fingersF/B`, `thumbF/B`) ; `Rig.setHands` ; `handCurl` : poing pendant un coup, prise (saisie, rebord, objet), ouverte quand on est touché, à demi fermée au repos.
- [x] **F14 : Maillage par régions** — `mesher.ts` : `meshRegions`, `mergeMeshes`, estompe de peau par région (doigts nets) ; corps 1/70, tête 1/100, mains 1/170.
- [x] **F15 : Matières** — `materials.ts` : tissu, soie, cuir, métal, peau, cheveux, lisse ; rugosité, métal, relief et lustre par zone ; relief généré dans le shader (bump de Mikkelsen) ; `FighterLook.materials` (Ferroc, Nacre, Zéphine).
- [x] **F16 : Visages** — `face.ts`, `face-meshes.ts` : grands yeux, iris à la couleur tirée des cheveux, pupilles, reflets, sourcils expressifs (`Expression.brow`), bouche ; quatre appels de dessin pour tous les joueurs ; mêmes visages sur les portraits.
- [x] **F17 : Repos vivant** — respiration (buste, cou, épaules, bassin) ; regard vers l'adversaire le plus proche (`gazeOf`). Tests : `test/figurine-v2.test.ts`.

## Phase 3 — Effets et caméra

- [x] **F18 : Formes d'impact** — `particles.ts` : `P_BURST` (éclat à pointes), `P_SHARD` (anneau brisé qui tourne), `P_SPLAT` (encre), `P_TWINKLE` (scintillement), rotation au hasard par particule.
- [x] **F19 : Coups** — `library.ts` : éclat à pointes à chaque coup, à la taille de sa force ; coup fort : anneau brisé et encre à la couleur du thème de l'attaquant.
- [x] **F20 : Coup final** — `Cues.finale`, `VfxOptions.isFinal`, `RendererOptions.isFinal`, `Renderer.timeScale` / `finaleScale` ; `apps/game/src/finale.ts` (`isFinalKo`) ; ralenti appliqué par le match local.
- [x] **F21 : Éjections et KO** — fumée dense, braises ; KO par le haut : étoile qui scintille.
- [x] **F22 : Bouclier, bris, soin** — éclats et scintillements. Tests : `test/impacts.test.ts`, `apps/game/test/finale.test.ts`.

## Phase 4 — Interface et menus

- [x] **F23 : Typographie** — police Lilita One (`assets/fonts`, OFL) en `@font-face` ; titres, noms, logo et chiffres du HUD.
- [x] **F24 : Écran titre** — logo en dégradé et relief, reflet qui passe, entrée en rebond (`.logo-frame`).
- [x] **F25 : Transitions** — volet et fondu à l'entrée des écrans, entrées des menus en cascade, boutons et cartes en relief ; tout est coupé par « Mouvements réduits ».
- [x] **F26 : Sélection vivante** — `background.ts` : `show(scene)` (stage, personnages, couleurs), reconstruction après 260 ms, vitrine sur la moitié droite ; `App.showBackground` ; portrait en pose de victoire quand le joueur est prêt.
- [x] **F27 : Aperçu des stages** — la scène de fond suit le stage survolé.
- [x] **F28 : HUD** — `hud.ts` (`heatColor`, secousse à chaque coup), `match-hud.ts` (cartes alignées, icône agrandie). Tests : `test/impacts.test.ts`.

## Phase 5 — Son et musique

- [x] **F29 : Sons** — `SND_WHOOSH`, `SND_THEME_*` (rafale, plume, braise, perle), `SND_FINALE`, `SND_STAR` : recettes, volumes, priorités ; souffle sur les coups forts, touche du thème sur les spéciaux (`CueTracker.themes`, `GameAudio.setThemes`), étoile pour un KO par le haut.
- [x] **F30 : Réverbération** — `audio/reverb.ts` (`ROOMS`, `impulseResponse`) ; `GameAudio.setRoom` ; départ des effets vers un convolueur.
- [x] **F31 : Musiques** — styles `drums`, `arp`, `leadWave` ; gammes majeure, mixolydienne, lydienne, phrygienne ; `TRACK_STYLES` (menus, arène, quatre stages), `JINGLE_STYLES`, `composeJingle` ; banque paresseuse (`ensure`) ; `GameAudio.playJingle`.
- [x] **F32 : Tension** — `GameAudio.setIntensity` (demi-ton, filtre) ; `apps/game/src/finale.ts` (`musicTension`).
- [x] **F33 : Branchement** — thème des menus, thème et salle du stage en local et en ligne, grondement du coup final, jingle du vainqueur sur les résultats (`apps/game/src/music.ts`). Tests : `test/audio-v2.test.ts`, `apps/game/test/finale.test.ts`.

## Phase 6 — Solo contre l'ordinateur

- [x] **F34 : Module `cpu`** — `packages/cpu` : `createBot` (un `InputFrame` par frame, lecture seule de la simulation, hasard à graine), `analyzeMoves` / `analyzeUltimate` / `recoveryRise` (portée, démarrage, puissance, élan tirés des données).
- [x] **F35 : Niveaux et profils** — `levelParams` (réaction 30 → 4 frames, précision, agressivité, défense, punition, tech, influence, garde du bord, cadence) ; `PROFILES` par personnage.
- [x] **F36 : Comportements** — influence et tech, retour au stage (viser l'extérieur du rebord sous le sol, sauts et remontée au bon moment), rebord, projections, bouclier, saisie d'un bouclier, punition, ultime (portée et élan vérifiés), garde du bord prudente, jeu neutre (coup qui touche d'après les données, placement sans jamais quitter le stage à pied).
- [x] **F37 : Branchement** — sélection locale (« Ordinateurs », « Niveau des ordinateurs », places `CPU_DEVICE` toujours prêtes, cédées à un joueur qui rejoint) ; entraînement (facile, moyen, difficile) ; `LocalMatchOptions.cpu`.
- [x] **F38 : Tests** — `packages/cpu/test/cpu.test.ts` (matchs simulés : déterminisme, niveau 9 contre niveau 1, aucune autodestruction), `test/diagnostic.test.ts` (outil de réglage, `CPU_DIAG=1`), `apps/game/test/local-setup.test.ts`.

Le chantier `finition` est terminé (phases 1 à 6).
