# Spec : `finition` — Fracas, de « jeu complet » à « rendu AAA »

> Statut : **APPROUVÉE le 2026-11-19** (questions ouvertes : réponses par défaut). Tâches : [tasks/finition/todo.md](tasks/finition/todo.md). Phases 1 à 4 livrées le 2026-11-19, phases 5 et 6 le 2026-11-20. Suite de [SPEC-visuals.md](SPEC-visuals.md) (phases 1 à 7 livrées, commit `a8b8e54`). Touche `render`, `fighters` (apparence seulement), `stages-items` (apparence seulement), `app-shell` ; ajoute un module `cpu`. Module de la [carte des capacités](CAPABILITY-MAP.md).

## Hypothèses

1. **Gameplay intouché.** Aucune modification de `sim-core`, des frame data, des hitbox ni des stages côté simulation. L'adversaire ordinateur ne fait que produire des `InputFrame`, comme une manette.
2. **Politique d'assets hybride** (décidée le 2026-11-19) :
   - **Personnages : 100 % générés par le code**, pour rester originaux et collés au squelette de la simulation.
   - **Décors : textures, éclairages d'ambiance (HDRI) et quelques modèles du domaine public (CC0)**, récupérés par moi, plus des pièces générées.
   - **Interface, sons, musique, IA : 100 % faits par le code.**
3. **Sources CC0 seulement** : Poly Haven (textures, HDRI, modèles), ambientCG (textures), Kenney et Quaternius (modèles stylisés). Aucune licence à attribution ou non commerciale. Chaque fichier est listé dans `assets/SOURCES.md` (URL, licence, date, taille).
4. **Téléchargements** : au début de chaque phase qui en a besoin, je présente une liste (fichier, source, taille) ; **vous l'approuvez une fois**, je télécharge et j'intègre. Vous ne récupérez jamais rien vous-même.
5. **Aucune nouvelle dépendance npm** : les chargeurs (glTF, textures) sont déjà dans `three`. Exception à demander si un besoin apparaît.
6. **Performance** : 60 fps en `Bas` sur puce graphique intégrée, `Ultra` à 60 fps sur carte dédiée à 8 joueurs ; la mesure de perf existante encadre chaque phase.
7. **Livraison par phases jouables**, comme `visuals` : chaque phase finit avec tests, lint, typecheck, perf au vert et captures ; on peut s'arrêter après n'importe laquelle.

## Constat (audit du 2026-11-19, en Ultra)

| Domaine | Aujourd'hui | Ce qui fait « pas AAA » |
|---|---|---|
| Décors | Géométrie low-poly à facettes, couleurs unies plus grain, brume orange partout | Vases-octaèdres, plateforme en boîte, palette monochrome délavée, pas de point focal, pas de matière (pierre, bois, eau) crédible |
| Personnages | Figurines lisses (~8 800 triangles), mains en moufles, petits visages, matière unie par zone | Silhouettes molles, visages illisibles à distance de jeu, aucun détail de tissu, cuir, métal ; pose de repos raide |
| Cadrage | Combattants petits à l'écran | On voit le décor plus que les personnages |
| Étalonnage | Contraste faible, teinte uniforme | Pas de séparation personnages / décor |
| Interface | Cartes sombres sobres, HUD en boîtes | Fonctionnel, mais sans identité ni animation |
| Son | Synthèse procédurale, une musique de combat à graine | À enrichir : impacts dosés, thèmes par stage et menus |
| Solo | Mannequins immobiles ou sauteurs | Aucun adversaire ordinateur |

## Ce qui change

### 1. Décors AAA (phase 1)

- **Matières réelles** : textures CC0 (couleur, relief, rugosité, occlusion) pour pierre, grès, bois, basalte, sable, métal, mappées en triplanaire (pas de coutures, pas d'UV à dessiner). Résolution selon la qualité : aucune en `Bas` (grain actuel), 1K en `Moyen`, 2K en `Haut` et `Ultra`.
- **Éclairage d'ambiance HDRI** par stage (coucher de soleil, nuit, crépuscule, vallée), à la place du ciel préfiltré actuel, en gardant le dôme par shader comme fond.
- **Géométrie « héroïque »** générée : plateforme principale sculptée (rebords biseautés, pierres taillées, racines, mousse), garde-corps et accessoires détaillés, props CC0 stylisés pour l'arrière-plan (ruines, rochers, végétation).
- **Composition** : un point focal par stage, 3 plans de profondeur nets (premier plan sombre, plan de jeu éclairé, lointain atmosphérique), brouillard de hauteur, rayons de lumière (god rays) en `Haut` et `Ultra`.
- **Étalonnage par stage** : contraste et teinte propres, personnages détachés du décor (légère désaturation et assombrissement du lointain, lumière de contour plus forte sur les combattants).
- **Cadrage** : combattants ~25 % plus grands à l'écran à 2 joueurs (zoom minimal resserré), sans changer les zones limites ni ce qui reste visible de l'action.

| Stage | Direction |
|---|---|
| **Belvédère des Brumes** | Terrasse de grès taillé, mer de nuages volumétrique, îles flottantes avec végétation, soleil rasant et rayons |
| **Récif Nocturne** | Dalle de basalte mouillée (reflets), lagon sombre, coraux lumineux, lune et caustiques |
| **Canal des Lanternes** | Quai en bois patiné et pavés, façades détaillées, eau qui reflète les lanternes, brume de crépuscule |
| **Bassin des Geysers** | Terrasses minérales colorées (concrétions), roche humide, vapeur dense, braises et lueur volcanique |
| **Entraînement** | Salle lumineuse, sol en carrelage texturé, grille nette |

### 2. Personnages v2 (phase 2)

- **Proportions héroïques stylisées** : têtes et mains plus grandes, épaules et silhouettes plus marquées, lisibles à distance de jeu. Volumes de collision inchangés : seule l'apparence bouge.
- **Mains à doigts** (pouce et doigts groupés), poses de main (poing, ouverte, tenue d'arme).
- **Maillage plus fin** en `Haut` et `Ultra` (~20 000 triangles), allégé en `Bas`.
- **Détail généré par le code** : textures de relief et de rugosité calculées au chargement (trame de tissu, coutures, grain de cuir, métal brossé et rayé, peau douce), par zone de couleur.
- **Matières** : peau à éclairage enveloppant (imitation de diffusion sous la surface), tissu à reflet doux sur les bords, métal réfléchissant l'HDRI du stage.
- **Visages** : yeux plus grands avec reflet, sourcils, bouche expressive ; expressions plus marquées (colère à l'attaque, douleur, joie à la victoire).
- **Pose de repos vivante** : respiration, transfert de poids, regard qui suit l'adversaire le plus proche.

### 3. Effets et caméra, finition (phase 3)

- **Impacts stylisés** : formes d'éclat générées en texture (étoiles, anneaux brisés, éclaboussures d'encre), dosées par la force du coup.
- **Coup final** : à l'éjection décisive du dernier combattant, gros plan, ralenti **d'affichage** puis retour (en local seulement ; en ligne, éclair et gros plan existants).
- **Éjection** : traînée de fumée plus dense, étoile au loin pour les éjections par le haut.
- **Bouclier, soin, objets** : matières et effets repris au niveau des nouveaux personnages.

### 4. Interface et menus (phase 4)

- **Écran titre animé** : logo « Fracas » en 3D généré, combat de fond en démonstration, caméra lente.
- **Sélection des personnages en 3D** : les figurines sur des socles, vivantes (pose de repos, réaction quand on les choisit), grille d'icônes générées, couleur visible tout de suite.
- **Sélection du stage** avec aperçu animé de chaque stage.
- **HUD redessiné** : pourcentages en grand chiffre stylisé qui tremble et chauffe (blanc, jaune, rouge) avec les dégâts, portrait du personnage, vies en icônes, jauge d'ultime animée.
- **Transitions** entre écrans (volets, fondus), animations d'entrée des menus, typographie unifiée. Police : une police libre (licence OFL) téléchargée avec les assets de la phase 1, ou à défaut les polices système.
- **Accessibilité conservée** : navigation clavier et manette, lecteur d'écran, « Mouvements réduits » coupe les animations.

### 5. Son et musique (phase 5)

- **Impacts en couches** : attaque (claquement), corps (grave), queue (souffle), dosés par la force et le type de coup ; sons propres aux thèmes (vent, plume, braise, perle).
- **Réverbération par stage** (terrasse ouverte, lagon, canal, vallée), générée.
- **Un thème par stage, un thème de menu, un jingle de victoire par personnage**, composés par le code (générateur existant étendu : sections, instruments, transitions).
- **Musique qui réagit** : montée d'intensité au dernier stock ou à la dernière minute.

### 6. Solo contre l'ordinateur (phase 6)

- **Nouveau module `cpu`** : lit l'état de la simulation (lecteurs existants, lecture seule) et produit un `InputFrame` par frame pour chaque combattant ordinateur. Déterministe (hasard à graine), donc rejouable et sans effet sur le rollback.
- **9 niveaux** : temps de réaction (de 30 à 4 frames), précision, lecture des frame data (portée, frames actives, punition), usage du bouclier, des esquives et de la parade.
- **Comportements** : approche et espacement, choix du coup selon la distance et la frame data, punition après bouclier, saisies, retour au rebord, garde du bord, ramassage d'objets, usage de l'ultime. Un profil par personnage (Zéphine harcèle, Ferroc charge ses smashs, Nacre garde ses distances).
- **Intégration** : dans la sélection locale, un emplacement peut devenir « Ordinateur » (niveau 1 à 9) ; à l'entraînement, mode « Ordinateur » pour les mannequins. **Hors ligne seulement.**

## Pipeline d'assets

```
assets/
  SOURCES.md            ← chaque fichier : URL, licence CC0, date, taille
  textures/<matière>/   ← 1K et 2K, WebP (couleur) et PNG (relief, rugosité)
  hdri/<stage>.hdr      ← 1K, préfiltré au chargement
  models/<nom>.glb      ← props de décor uniquement
  fonts/                ← police OFL (phase 4)
```

- Chargés **à la demande, par stage**, après l'écran de chargement ; le jeu reste jouable avec les matières actuelles tant qu'un fichier manque (et en `Bas`).
- Budget : ≤ 8 Mo téléchargés par stage en `Haut`, ≤ 3 Mo en `Moyen` ; client principal inchangé (~250 Ko compressé).
- Tout fichier est relu (contenu, licence) avant intégration.

## Structure (nouveaux fichiers principaux)

```
packages/render/src/assets/      loader.ts (à la demande, cache), textures.ts (triplanaire), hdri.ts
packages/render/src/stages/      hero/<stage>.ts (géométrie héroïque générée), fog.ts, rays.ts
packages/render/src/fighters/    hands.ts, detail.ts (relief généré), skin.ts
packages/render/src/vfx/         impacts.ts (formes générées), finale.ts (coup final)
packages/render/src/audio/       layers.ts, reverb.ts, themes.ts
packages/cpu/                    nouveau module : bot.ts, levels.ts, profiles.ts, tests
apps/game/src/ui/                title.ts, select-3d.ts, stage-preview.ts, transitions.ts
assets/                          fichiers CC0 et SOURCES.md
```

## Phases

| # | Phase | Ce qu'on voit à la fin | Téléchargements |
|---|---|---|---|
| 1 | Décors AAA | Quatre stages refaits : matières réelles, HDRI, géométrie héroïque, composition, étalonnage, cadrage resserré | Oui (textures, HDRI, quelques props, police) |
| 2 | Personnages v2 | Proportions héroïques, mains, détail des matières, visages expressifs, repos vivant | Non |
| 3 | Effets et caméra | Impacts stylisés, coup final, éjections spectaculaires | Non |
| 4 | Interface et menus | Titre 3D, sélection 3D, aperçus de stages, HUD redessiné, transitions | Non (police déjà en phase 1) |
| 5 | Son et musique | Impacts en couches, réverbération, thèmes par stage et menus, musique réactive | Non |
| 6 | Solo contre l'ordinateur | Module `cpu`, 9 niveaux, profils par personnage, branché en local et à l'entraînement | Non |

Ordre choisi pour l'impact visible : les décors sont le plus gros écart et profitent à tous les écrans ; l'IA vient en dernier car elle ne change pas l'apparence et se teste indépendamment.

## Stratégie de test

- Tests unitaires pour chaque module nouveau (chargeur avec repli, textures générées, mains et squelette, couches sonores, IA).
- **IA** : matchs ordinateur contre ordinateur sans rendu, déterminisme vérifié (même graine, même checksum), un niveau plus élevé gagne majoritairement contre un niveau plus faible, aucun suicide (sortie volontaire de l'arène) aux niveaux ≥ 3.
- Mesure de perf à chaque phase, sur tous les niveaux de qualité ; poids téléchargé par stage mesuré.
- Vérification visuelle dans le navigateur, captures avant / après dans chaque compte rendu.

## Limites

- **Toujours** : tests, typecheck, lint avant chaque commit ; perf à chaque phase ; `SOURCES.md` à jour pour chaque fichier ajouté.
- **Demander d'abord** : chaque lot de téléchargements ; toute nouvelle dépendance ; tout changement qui toucherait la simulation.
- **Jamais** : asset sous licence autre que CC0 (ou OFL pour la police) ; personnage, décor, nom ou son repris d'un jeu existant ; hitbox tirée des modèles ; commit sans votre demande.

## Critères de succès

1. Côte à côte avec les captures du 2026-11-19, chaque stage et chaque personnage est nettement plus riche (matières, détail, lumière, composition).
2. Perf : tous les contrôles existants au vert, 60 fps en `Bas` sur intégrée.
3. Téléchargement par stage dans le budget ; jeu jouable sans les assets.
4. L'ordinateur de niveau 9 bat le niveau 1 dans au moins 95 % des matchs simulés ; aucun désaccord de checksum.
5. Toutes les sources d'assets listées et CC0.
6. **Votre verdict** après chaque phase.

## Décisions prises à la validation

- **Politique d'assets** : hybride (voir Hypothèses).
- **Cadrage resserré** : oui. **Coup final au ralenti** : en local seulement. **Ordre des phases** : tel quel.
- **Lot de téléchargements de la phase 1** : approuvé tel que présenté (11 matières, 5 HDRI, une police ; ~28 Mo).

## Écarts de la phase 1

| Prévu | Fait | Pourquoi |
|---|---|---|
| Textures 1K en `Moyen`, 2K en `Haut` et `Ultra` | 1K partout où il y a des textures (`Moyen` à `Ultra`), filtrage anisotrope 4 à 16 | À la distance de la caméra, textures répétées, le 2K ne se voit pas ; il aurait coûté ~7 Mo par matière dans le dépôt et le téléchargement. ≤ 6 Mo par stage. |
| Quelques props CC0 (modèles glTF) | Aucun : toute la géométrie est générée (`stages/sculpt.ts`) | Pierres taillées, balustres tournés, roches déformées, orgues basaltiques, maisons, arbres et volcan générés tiennent mieux le style et l'éclairage communs que des modèles réalistes mélangés ; pas de dossier `assets/models/`. |
| HDRI pour chaque stage | HDRI pour Belvédère, Canal, Bassin et l'Entraînement ; Récif garde l'ambiance tirée de son ciel | L'image de nuit contient une lumière vive qui blanchissait l'eau sans rien apporter de plus. |
| Brouillard de hauteur, caustiques, bancs de poissons | Brouillard de distance par stage (plus lointain qu'avant), mer de nuages en nappes, particules existantes | Le brouillard de distance suffit à séparer les plans ; caustiques et poissons restent possibles plus tard. |
| Rayons de lumière volumétriques | Faisceaux additifs dessinés par shader (Belvédère, Bassin), en `Haut` et `Ultra` | Même lecture pour un appel de dessin, sans passe de rendu en plus. |
| Combattants ~25 % plus grands | Hauteur de vue minimale 90 → 72, marges de la caméra réduites (24/34/14 → 20/30/12) | ~23 % plus grands à 2 joueurs proches ; zones limites et dézoom à plusieurs inchangés. |
| — | L'eau reflète le ciel du stage par sa propre carte d'environnement | Avec une ambiance de scène, Three ignore la force de reflet propre à chaque matière (`envMapIntensity`) : l'horizon clair de l'HDRI blanchissait l'eau du Canal. Nouveau réglage `WaterLook.reflect`. |
| — | Bassin : terrasses du fond abaissées sous le sol de jeu, sans concrétions sur les murs | Les terrasses se confondaient avec les plateformes ; les concrétions régulières se lisaient comme des pointes (danger). |
| Budget de pièces à dessiner du décor : 10 | 14 | Une pièce par matière texturée (2 à 4 par stage), plus nuages et rayons. |

## Écarts de la phase 2

| Prévu | Fait | Pourquoi |
|---|---|---|
| Maillage plus fin en `Haut`/`Ultra`, allégé en `Bas` | Un seul maillage pour tous les niveaux, maillé par régions : corps au 1/70, tête au 1/100, mains au 1/170 (~18 800 triangles par figurine) | Le coût de dessin reste négligeable même en `Bas` ; un maillage par niveau aurait demandé un nouveau calcul (~200 ms) quand l'automatique baisse la qualité en début de match. |
| Textures de relief calculées au chargement | Relief calculé dans le shader (trame, grain de cuir, brossage, mèches), d'après la position en pose de référence, effacé quand il devient plus fin qu'un pixel | Aucune image à générer ni à garder en mémoire, et pas de coordonnées de texture à dessiner sur des maillages générés. |
| Peau à diffusion sous la surface | Lumière chaude ajoutée à la peau | Même lecture (peau qui ne paraît pas en plastique) pour un coût nul. |
| Regard qui suit l'adversaire le plus proche | Iris, pupilles et reflets suivent l'adversaire ; la tête garde sa rotation vers la caméra | Tourner la tête cacherait le visage, qui doit rester lisible. |
| Transfert de poids au repos | Respiration seulement (buste, cou, épaules, bassin) | Déplacer le bassin de côté ferait glisser les pieds. |
| Expressions « joie à la victoire » | Sourcils (colère à l'attaque, inquiétude quand on est touché) ; poings serrés et bouche ouverte sur les portraits de victoire | La scène de victoire est un portrait fixe (voir SPEC-visuals.md, phase 7). |
| — | Matière par zone que chaque personnage peut changer (`FighterLook.materials`) : fer de Ferroc, soie de Nacre, verres de Zéphine | Les zones de couleur ne disent pas de quoi la pièce est faite. |
| — | 4 os de plus (doigts et pouces), 25 au total ; poses de main selon l'action (poing, prise, ouverte, repos) | Nécessaires aux mains à doigts. |

## Écarts de la phase 3

| Prévu | Fait | Pourquoi |
|---|---|---|
| Formes d'impact générées en texture | Formes dessinées par le shader des particules (éclat à pointes, anneau brisé, éclaboussure d'encre, scintillement), tournées au hasard | Même rendu sans image à générer ; un seul appel de dessin par couche comme avant. |
| Coup final : gros plan et ralenti d'affichage, en local | Fait : l'éjection qui doit finir le match (dernière vie du dernier duel, `isFinalKo`) déclenche un gros plan long, un grand éclat, un éclair blanc, et le match local simule à 20 % de sa vitesse pendant 10 frames, puis revient en douceur (`Renderer.timeScale`) | Coupé par « Mouvements réduits » comme les autres effets d'écran ; absent en ligne. L'annonce repose sur l'estimation du KO probable : si le combattant survit malgré tout, le ralenti a lieu quand même, pour les deux joueurs à la fois. |
| Éjections spectaculaires | Fumée deux fois plus dense, braises sur les éjections violentes, étoile qui scintille en haut de l'écran pour un KO par le haut | — |
| Bouclier, soin, objets repris | Bouclier : anneau d'éclats à l'impact ; bris : éclat et éclats ; soin : anneau et scintillements | Les effets des objets (`stages/items.ts`) restent ceux de la phase 2 de SPEC-visuals : ils se lisent déjà. |

## Écarts de la phase 4

| Prévu | Fait | Pourquoi |
|---|---|---|
| Logo « Fracas » en 3D généré | Logo en CSS : police Lilita One, dégradé, relief en ombres empilées, reflet qui passe, entrée en rebond | Aussi lisible, sans géométrie de texte (il faudrait une police au format JSON de Three ou une nouvelle dépendance). Animer le texte en dégradé lui-même le rend invisible dans Chromium : c'est son cadre qui porte l'entrée. |
| Sélection des personnages en 3D sur des socles | La scène de fond des menus montre les personnages choisis, dans leurs couleurs, côte à côte, avec leur respiration, leurs yeux et leur entrée en scène à chaque changement ; le portrait de la carte passe en pose de victoire quand le joueur est prêt | Un seul contexte WebGL (celui du fond) au lieu d'un par carte ; la scène est reconstruite 260 ms après le dernier changement. |
| Aperçu animé de chaque stage | Survoler un stage fait passer la scène de fond sur ce stage, avec les personnages choisis | Même mécanisme ; l'aperçu est le vrai stage, en grand. |
| HUD redessiné | Cartes de joueur plus larges, grand pourcentage en Lilita One cerné de sombre, couleur qui chauffe (blanc, jaune, orange, rouge, rouge sombre), secousse à chaque coup reçu (coupée par « Mouvements réduits ») ; cartes des vies alignées, icône de tête agrandie | Les vies restent en pastilles sous l'icône du personnage (phase 7 de SPEC-visuals). |
| Transitions entre écrans, typographie unifiée | Volet et fondu à l'entrée de chaque écran, entrées des menus en cascade, boutons et cartes en relief avec lueur au focus ; titres en Lilita One | Pas de transition de sortie : les écrans sont remplacés immédiatement par la pile d'écrans. |

## Écarts de la phase 5

| Prévu | Fait | Pourquoi |
|---|---|---|
| Impacts en couches (attaque, corps, queue) | Les trois forces d'impact existantes, plus un souffle sur les coups forts et la touche du thème du lanceur sur les coups spéciaux (rafale, plume, braise, perle) ; KO par le haut : son d'étoile ; coup final : grondement joué au début du ralenti | Les couches s'ajoutent comme des sons à part (le mélangeur gère voix et priorités), sans retoucher les recettes existantes. |
| Réverbération par stage | Réponse impulsionnelle générée par lieu (terrasse, lagon, rue au bord de l'eau, vallée, salle d'essai), sur les effets seulement ; aucune dans les menus | La musique a déjà son écho ; réverbérée en plus, elle se brouillait. La réponse est calculée à la fréquence du contexte audio (exigence du navigateur) ; si c'est impossible, le son reste sec. |
| Un thème par stage, un thème de menu, un jingle par personnage | Six boucles (menus, arène, quatre stages) aux gammes, tempos et batteries différents (\`drive\`, \`half\`, \`sparse\`), quatre jingles de victoire (un par thème d'effets) | Seul le thème des menus est rendu au démarrage ; les autres le sont à la première demande (\`SoundBank.ensure\`), pour ne pas allonger le chargement. L'ancien morceau continue tant que le suivant n'est pas prêt. |
| Musique qui réagit | Dernière vie du dernier duel, 30 dernières secondes, ou mort subite : la musique monte d'un demi-ton et s'éclaircit (\`setIntensity\`, \`musicTension\`) | Une seule boucle par morceau (pas de seconde version « intense » à garder en mémoire). |
| Écoute | Vérifié par les tests (graphe audio, sons, salles, musiques) et dans le navigateur (aucune erreur) ; non écouté par moi | Je ne peux pas écouter : votre oreille décide des réglages. |

## Écarts de la phase 6

| Prévu | Fait | Pourquoi |
|---|---|---|
| Module `cpu` déterministe, 9 niveaux | Fait (`packages/cpu`) : le bot ne produit que des inputs ; il voit ses adversaires avec le retard de son niveau (30 frames au niveau 1, 4 au niveau 9) et lit portée, démarrage et puissance de ses coups dans les données des personnages ; hasard à graine | — |
| Comportements : approche, espacement, choix du coup, punition, saisies, retour au rebord, garde du bord, objets, ultime | Tous sauf les objets : le bot ignore les objets (ni ramassage ni lancer) | Le ramassage demande de lire les entités et leurs règles propres ; reporté. |
| Profils par personnage | Sorel équilibré, Zéphine aérienne et collante, Ferroc qui cherche le smash tôt, Nacre à distance avec son projectile | — |
| Un niveau par place dans la sélection | Un nombre d'ordinateurs (0 à 3, sur les places libres) et un niveau commun à tous, au clavier ou à la manette ; un joueur qui rejoint prend la place d'un ordinateur | Plus simple à régler sans souris ; un niveau par place reste possible. |
| Mode « Ordinateur » à l'entraînement | Trois préréglages dans « Comportement » : facile (niv. 3), moyen (6), difficile (9) | Même raison. |
| Tests : le niveau 9 bat le niveau 1 dans ≥ 95 % des matchs, aucun suicide à partir du niveau 3 | 20 matchs miroirs (4 personnages × 5 graines) : 20 victoires du niveau 9 ; 12 matchs du niveau 3 au niveau 9 : aucune autodestruction ; déterminisme vérifié (même graine, même checksum) | Réglé sur des centaines de matchs simulés : récupération sous le rebord, culbute, élan des coups et de l'ultime (Zéphine), garde du bord seulement avec une remontée qui ramène. |
