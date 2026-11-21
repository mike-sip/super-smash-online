# Spec : `visuals` — graphismes v2 de Fracas, avant dévoilement

> Statut : **APPROUVÉE le 2026-11-18**. Tâches : [tasks/visuals/todo.md](tasks/visuals/todo.md). Phases 1 à 5 livrées le 2026-11-18, phases 6 et 7 le 2026-11-19. Chantier du module [`render`](SPEC-render.md) (et des écrans de [`app-shell`](SPEC-app-shell.md) pour la phase 7). Module de la [carte des capacités](CAPABILITY-MAP.md). Dépend de : `render`, `fighters`, `stages-items` (implémentés).

## Hypothèses

1. **Objectif : un jeu qui impressionne au dévoilement.** La référence de qualité visée est celle des grands jeux du genre (lumière riche, personnages lisses et expressifs, effets de coups spectaculaires, décors vivants). On reprend ce **niveau de finition**, jamais leur **contenu** : personnages, décors, effets et identité restent ceux de Fracas.
2. **Tout est généré par le code** (votre choix du 2026-11-18, conforme à la décision de la carte du 2026-11-13) : aucun modèle, texture, ni fichier d'artiste. Les formes, les squelettes, les textures et les animations sont produits en TypeScript, au chargement. L'interface `FighterVisuals` reste le point de branchement pour de vrais modèles plus tard.
3. **Limite assumée.** Des modèles sculptés à la main par une équipe d'artistes restent hors de portée du code seul. La cible réaliste est un **style stylisé très soigné** (« figurines » aux formes douces, matières lisibles, lumière de studio), cohérent et sans placeholder visible.
4. **Le rendu ne décide toujours de rien.** Aucune modification de `sim-core`, aucune valeur de gameplay touchée, hitbox jamais dérivées des os. Les animations restent des fonctions de l'action et de sa frame : elles restent justes en pause, au ralenti, image par image et après un rollback.
5. **Préréglages de qualité** (votre choix du 2026-11-18) : `Bas`, `Moyen`, `Haut`, `Ultra`, plus `Auto` par défaut. 60 fps à 8 joueurs à chaque niveau sur la machine visée par ce niveau.
6. **Aucune nouvelle dépendance.** Post-traitement et utilitaires viennent des modules complémentaires livrés avec `three` (`three/addons/…`), déjà installé et figé en 0.187.0.
7. **Livraison par phases jouables.** Chaque phase se termine par un jeu qui tourne, tests et mesure de performance au vert ; on peut s'arrêter après n'importe laquelle.

## Objectif

Faire passer Fracas de mannequins en boîtes et décors à facettes à un rendu digne d'une sortie publique, sans perdre un millième de la fluidité ni du déterminisme.

**Succès** : quelqu'un qui découvre une capture ou une vidéo de 30 secondes d'un combat à 4 ne voit ni prototype ni placeholder ; chaque personnage se reconnaît à sa silhouette ; chaque coup « pèse » à l'écran ; et le jeu tient 60 fps à 8 joueurs.

## Ce qui change à l'écran

### 1. Lumière, matières et post-traitement

| Élément | Aujourd'hui | Après |
|---|---|---|
| Couleurs | Sortie linéaire brute | Rendu HDR, mappage de tons Neutral, étalonnage par stage (saturation, contraste, teintes) |
| Lumière | Ciel + soleil, sans ombres portées | Ciel + soleil + **lumière de contour** (rim) qui détache les combattants du fond ; ombres portées réelles des combattants et des objets sur le décor (carte d'ombre serrée sur le cadrage de la caméra) ; ombre ronde conservée en `Bas` |
| Matières | Lambert, couleurs plates | Matières physiques (rugosité, métal) pour décor et personnages ; textures de détail générées (bruit, pierre, bois, métal martelé, écailles) avec cartes de relief |
| Lueurs | Aucune | **Bloom** sélectif : lanternes, coraux, effets de coups, attaque ultime, bouclier |
| Profondeur | Brouillard linéaire | Brouillard de hauteur + perspective atmosphérique ; **flou de profondeur léger** sur l'arrière-plan lointain (`Haut`, `Ultra`) |
| Occlusion | Aucune | Occlusion ambiante à l'écran (`Ultra`) |
| Bords | Anticrénelage du navigateur | MSAA ×4 sur l'image intermédiaire ; contour fin des personnages (coque inversée) pour la lisibilité |
| Cadre | — | Vignette douce, grain très léger (désactivables) |

### 2. Personnages : des figurines au lieu des boîtes

- **Formes douces générées** : chaque personnage est décrit par une combinaison de volumes (capsules, ellipsoïdes, cônes arrondis, fusionnés en douceur). Au chargement, ces volumes sont convertis en maillage lisse (champ de distance signée → maillage), une fois par personnage, puis mis en cache. Budget : 6 000 à 10 000 triangles par personnage en `Ultra`, une version allégée en `Bas`.
- **Vrai squelette** : maillage déformé par des os (`SkinnedMesh`) au lieu de pièces rigides. Le squelette étend la pose actuelle : colonne en deux segments, cou, poignets, mains, chevilles, pieds, plus des os « secondaires » (cheveux, pans de tissu, plumes, cape).
- **Visages expressifs** : yeux et bouche dessinés dans une texture générée, avec expressions (neutre, concentré, effort pendant la charge du smash, douleur en hitstun, sonné au bris de bouclier, KO, victoire). Les yeux clignent et suivent l'adversaire le plus proche.
- **Identité par personnage** (concepts à valider) :

| Personnage | Silhouette et matières | Pièces animées |
|---|---|---|
| **Sorel** — messager des vents | Moine-voyageur svelte, tunique croisée, bandes de tissu aux avant-bras, sandales | Bandeau à deux longs pans, ceinture à franges ; traînées d'air spiralées sur ses coups |
| **Zéphine** — coursière des falaises | Petite, jambes longues, combinaison ajustée, lunettes d'aviatrice relevées, sacoche | Queue de cheval haute, écharpe, plumes aux bottes ; traînées de plumes |
| **Ferroc** — forgeron | Massif, torse en barrique, tablier de cuir, bras cerclés de fer, gantelets incandescents | Braises qui s'échappent des gantelets, chaîne au ceinturon ; métal qui rougeoit pendant les charges |
| **Nacre** — zoneuse des récifs | Silhouette fluide, robe-coquillage irisée, couronne de corail | Voiles flottants, mèches ondulantes ; matière nacrée (irisation selon l'angle) |

- **Couleurs alternatives** : 8 palettes par personnage (au lieu d'une teinte par joueur), choisies à la sélection. La couleur du joueur reste lisible par l'étiquette, le contour et un liseré.
- **Coût** : tous les personnages d'un même modèle partagent géométrie et matière ; cible de 3 à 4 appels de dessin par personnage, ombre comprise.

### 3. Animation : fluidité et poids

- **Poses clés enrichies** : chaque coup reçoit une anticipation, un impact marqué et un relâchement (courbes d'accélération par segment au lieu d'interpolations linéaires), calés sur la frame data : la pose de frappe tombe exactement sur les frames actives.
- **Fondus intelligents** entre actions : durée selon la transition (immédiat vers un coup, plus long vers l'inaction), fondu dans l'espace des rotations (quaternions) pour supprimer les torsions.
- **Écrasement et étirement** au saut, à l'atterrissage, à la projection et aux impacts forts.
- **Traînées de mouvement** (« smears ») : ruban lumineux qui suit le membre ou l'arme pendant les frames actives, à la couleur du personnage.
- **Mouvements secondaires** : ressorts amortis sur cheveux, tissus, plumes, chaîne ; respiration au repos ; inclinaison du corps dans les virages et la course ; regard. Calculés par pas de simulation affiché, remis à zéro proprement après un rollback ou une téléportation.
- **Pieds posés** : les pieds ne glissent plus pendant la marche et la course (cadence calée sur la vitesse lue dans la simulation) et se posent sur le bord des plateformes.
- **Poses à part entière** pour les actions aujourd'hui génériques : entrée en scène, provocations, victoire (3 par personnage), défaite.

### 4. Effets visuels : chaque coup pèse

Un système de particules sur la carte graphique (un appel de dessin pour toutes les particules) et une bibliothèque d'effets générés :

| Moment | Effet |
|---|---|
| Coup porté | Étincelle d'impact orientée selon l'angle d'éjection, taille selon la force ; anneau de choc ; flash blanc bref de la victime ; secousse de caméra au-delà d'un seuil |
| Coup fort / coup qui tue | Lignes de vitesse radiales, éclair coloré à l'écran, **gros plan bref de la caméra** sur l'impact (visuel uniquement : la simulation n'est jamais ralentie) |
| Éjection | Traînée de fumée qui suit la trajectoire, plus dense avec la vitesse |
| KO | Colonne d'explosion colorée au bord de l'écran, onde de choc, secousse |
| Bouclier | Bulle à effet de Fresnel, teinte selon la résistance, fissures quand elle faiblit ; éclats au bris |
| Parade / contre | Onde nette, flash, petit gel visuel de l'éclat |
| Déplacements | Poussière au dash, au demi-tour, à l'atterrissage, à la roulade ; anneau d'air au double saut |
| Spéciaux | Effets propres : rafales de Sorel, plumes de Zéphine, braises et ondes de Ferroc, bulles et éclats nacrés de Nacre |
| Attaque ultime | Assombrissement du décor, halo autour du lanceur, effets plein écran propres à chacun |
| Objets | Halo d'apparition, rotation et reflets |

Tous les effets passent par le filtre d'événements existant (`events.ts`) : une frame re-simulée ne rejoue rien.

### 5. Caméra

- Secousses dosées par la force du coup (désactivables dans les options, pour le confort).
- Gros plan sur les coups décisifs (voir ci-dessus) et dézoom lors de l'ultime.
- Léger parallaxe et légère inclinaison selon le cadrage pour donner du volume au décor, sans jamais nuire à la lisibilité du plan de jeu.

### 6. Décors vivants

Chaque stage existant est refait autour de sa géométrie de jeu (inchangée) :

| Stage | Direction |
|---|---|
| **Belvédère des Brumes** | Ciel de fin de jour, mer de nuages animée, îles flottantes en couches de parallaxe, rayons de soleil, oiseaux, bannières qui ondulent, pierre et bois texturés |
| **Récif Nocturne** | Sous la surface de nuit : caustiques sur le sol, coraux et algues lumineux qui ondulent, bancs de poissons, particules en suspension, rayons de lune |
| **Canal des Lanternes** | Ville sur l'eau au crépuscule : reflets dans une eau animée, lanternes qui se balancent et brillent, fenêtres qui s'allument, pluie légère facultative |
| **Bassin des Geysers** | Vallée volcanique : vapeur volumétrique, roche humide, éruptions annoncées par des bulles et un grondement visuel, braises dans l'air |
| **Test** | Salle d'entraînement lumineuse et nette, avec grille |

Fond : ciel par shader (dégradé, nuages, astres) plus 3 à 5 couches de décor lointain en parallaxe, toutes animées par la frame de simulation affichée.

### 7. Assets d'interface (avec `app-shell`)

- **Portraits et rendus des personnages** pour la sélection, générés au chargement en photographiant les figurines hors écran (pas d'image stockée).
- **Icônes de vies** à l'effigie de chaque personnage et palette.
- **Écran de victoire en 3D** : le vainqueur dans sa pose, caméra animée, puis le tableau des résultats existant.
- **Fond animé des menus** reprenant le style des stages.

## Préréglages de qualité

| | Bas | Moyen | Haut | Ultra |
|---|---|---|---|---|
| Machine visée | Portable à puce graphique intégrée | Intégrée récente | Carte dédiée d'entrée de gamme | Carte dédiée |
| Résolution interne | 75 %, densité 1 | 100 %, densité ≤ 1,25 | 100 %, densité ≤ 1,5 | 100 %, densité ≤ 2 |
| Ombres | Rondes | Carte 1024 | Carte 2048, douces | Carte 2048, douces |
| Post-traitement | Mappage de tons seul | + bloom, MSAA ×4 | + étalonnage (flou de fond en phase 6) | + occlusion ambiante (phase 6) |
| Personnages | Maillage allégé, sans contour | Complet | Complet + contour | Complet + contour |
| Mouvements secondaires | Pans principaux | Tous | Tous | Tous |
| Particules (max) | 1 000 | 3 000 | 6 000 | 10 000 |
| Décor | Parallaxe sans animation lourde | Complet | Complet | Complet + effets volumétriques |

- **Auto** (par défaut) : choisit un niveau d'après la carte graphique annoncée par WebGL, puis le **baisse d'un cran** si le temps de dessin moyen dépasse le budget pendant les premières secondes de combat. Jamais de changement en plein échange : uniquement au début du match.
- Le réglage vit dans les options de `app-shell`, enregistré comme les autres réglages.

## API publique (ajouts)

```ts
export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export interface RendererOptions {
  // … champs existants inchangés
  /** Niveau de qualité ; `'auto'` par défaut. */
  readonly quality?: Quality | 'auto';
  /** Palette choisie par joueur (index dans les palettes du personnage), 0 par défaut. */
  readonly palettes?: readonly number[];
  /** Secousses de caméra et flashs d'écran ; vrai par défaut. */
  readonly screenEffects?: boolean;
}

export interface Renderer {
  // … méthodes existantes inchangées
  /** Change le niveau entre deux matchs. */
  setQuality(quality: Quality | 'auto'): void;
  /** Niveau effectivement appliqué (utile quand `auto` a choisi). */
  readonly quality: Quality;
}

/** Rendu hors écran d'un personnage pour les menus (portrait, icône de vie, victoire). */
export function renderPortrait(
  character: string,
  palette: number,
  kind: 'portrait' | 'stock' | 'victory',
  size: number,
): Promise<ImageBitmap>;
```

Côté `fighters`, `FighterLook` gagne une description en volumes (`sculpt`), des palettes (`palettes`) et des pièces animées (`dynamics`) ; les champs actuels (`build`, `parts`) restent lus pour le mannequin, conservé comme repli et pour les tests.

## Structure (nouveaux fichiers)

```
packages/render/src/
  quality.ts              → préréglages, détection et ajustement automatique (logique pure)
  post/
    pipeline.ts           → chaîne de post-traitement selon la qualité
    grading.ts            → tables d'étalonnage générées par stage
  lighting.ts             → soleil, contour, carte d'ombre calée sur la caméra
  textures/
    noise.ts              → bruits et motifs procéduraux (logique pure)
    materials.ts          → matières du décor et des personnages
  fighters/
    sdf.ts                → volumes et fusion douce (logique pure)
    mesher.ts             → champ de distance → maillage, poids de peau (logique pure, dans un Worker)
    skeleton.ts           → squelette étendu, pose → os
    figurine.ts           → implémentation de FighterVisuals avec SkinnedMesh
    face.ts               → texture du visage et expressions
    dynamics.ts           → ressorts des pièces secondaires (logique pure)
    curves.ts             → courbes d'accélération des poses clés (logique pure)
    trails.ts             → traînées de mouvement
    poses.ts              → (existant) poses enrichies
  vfx/
    particles.ts          → système de particules sur GPU
    library.ts            → effets par événement et par personnage
    shield.ts             → bulle de bouclier
  camera.ts               → (existant) + secousses et gros plans (logique pure)
  stages/
    sky.ts                → ciel par shader
    parallax.ts           → couches lointaines
    water.ts              → eau, reflets, caustiques
    *.ts                  → (existants) décors refaits
  portraits.ts            → rendus hors écran pour les menus
packages/fighters/src/characters/*.ts → volumes, palettes et pièces animées de chaque personnage
```

## Phases

| # | Phase | Ce qu'on voit à la fin |
|---|---|---|
| 1 | **Pipeline de rendu et qualité** : HDR, mappage de tons, ombres réelles, lumière de contour, bloom, anticrénelage, préréglages et `Auto`, mesure de perf par niveau | Les mannequins et décors actuels, mais déjà nettement plus beaux |
| 2 | **Effets et caméra** : particules, bibliothèque d'effets de coups, KO, bouclier, poussières, secousses, gros plans | Chaque coup pèse |
| 3 | **Figurine générique** : volumes → maillage, squelette étendu, peau, matière, contour, visage | Sorel en figurine lisse, les trois autres encore en mannequins |
| 4 | **Les quatre personnages** : volumes, pièces animées, visages, 8 palettes chacun, effets de spéciaux et d'ultime | Le roster complet |
| 5 | **Animation** : poses clés enrichies et courbes, fondus en quaternions, écrasement, traînées, ressorts, pieds posés, provocations, victoires | La fluidité |
| 6 | **Décors** : ciel, parallaxe, eau, textures, animation des 4 stages et du stage de test | Le monde |
| 7 | **Assets d'interface** : portraits, icônes de vies, écran de victoire 3D, fond des menus | Le jeu complet, prêt à montrer |

Ordre choisi pour que le gain visible arrive tôt (phases 1 et 2 profitent à tout ce qui existe) et que la mesure de performance encadre chaque ajout.

## Commandes

Celles de `render` et de `app-shell`, inchangées, plus :

```
Perf, tous niveaux :  pnpm --filter @game/app perf
Perf, un niveau :    PERF_QUALITY=low|medium|high|ultra pnpm --filter @game/app perf
```

## Stratégie de test

- **Logique pure testée dans Node** (Vitest), test écrit avant le code : préréglages et ajustement auto, bruits, volumes et maillage (étanchéité, nombre de triangles, poids de peau normalisés), courbes, ressorts (stabilité, remise à zéro), secousses et gros plans de caméra, choix des effets par événement, absence de redéclenchement après rollback.
- **Images de référence** (Playwright + Edge) : une capture par personnage × palette en pose fixe, et une par stage, comparées à une référence avec tolérance, pour attraper les régressions visuelles. Les références sont regénérées volontairement, jamais en silence.
- **Performance** : le test de perf existant, étendu aux 4 niveaux, sur les 5 stages, à 8 combattants avec objets.
- **Non-ingérence** : le test existant (le rendu ne modifie pas la simulation) continue de passer ; les checksums de référence de `sim-core` sont inchangés.
- **À la main** : ce qui ne se mesure pas (beauté, lisibilité, ressenti) est vérifié dans le jeu et dit dans le compte rendu, avec captures.

## Limites

- **Toujours** : tests, typecheck et lint avant chaque commit ; mesure de perf à la fin de chaque phase ; captures d'écran dans le compte rendu de phase.
- **Demander d'abord** : ajouter une dépendance ; toucher à `sim-core` ou à une valeur de gameplay ; relever un seuil de performance ; changer la géométrie de jeu d'un stage ; changer le nom, l'archétype ou le concept d'un personnage au-delà de ce que décrit cette spec.
- **Jamais** : importer un modèle, une texture, une police ou un son tiers ; reprendre un personnage, un décor, un effet ou une interface reconnaissable d'un jeu existant ; dériver une hitbox d'un os ; ralentir ou modifier la simulation pour un effet.

## Critères de succès

1. **Fluide** : sur la machine de développement, dans Edge, 8 combattants, objets à « high », sur chacun des 5 stages : en `Ultra`, 95 % des images en moins de 16,7 ms et dessin moyen sous 8 ms ; en `Bas`, dessin moyen sous 4 ms (le seuil actuel).
2. **Économe** : en `Ultra`, moins de 150 appels de dessin par image dans ce scénario ; tas JavaScript qui grandit de moins de 256 Ko sur 600 images ; chargement d'un match (génération des maillages comprise) sous 1,5 s, ou masqué par l'écran de chargement.
3. **Sans placeholder** : aucune boîte, aucune facette brute, aucun personnage sans visage dans un match en `Moyen` et au-dessus ; le mannequin n'apparaît plus qu'en repli et dans la vue technique.
4. **Reconnaissable** : à la silhouette seule (captures en ombre chinoise), on distingue les 4 personnages ; les 8 palettes de chacun se distinguent entre elles.
5. **Lisible** : avec tous les effets, les combattants restent visibles et la vue technique reste alignée sur la simulation ; la secousse et les flashs se coupent dans les options.
6. **Juste** : les animations restent exactes en pause, image par image, au ralenti et après rollback ; le test de non-ingérence passe ; aucun checksum de `sim-core` ne change.
7. **Votre verdict** : vous avez joué et regardé chaque phase ; le dévoilement attend votre accord sur l'ensemble.

## Décisions prises à la validation

Validée le 2026-11-18 sans réponse aux questions ci-dessous : les propositions par défaut s'appliquent, révisables à tout moment.

- **Direction artistique** : figurines stylisées.
- **Concepts des personnages** : tels que proposés, à revoir avant la phase 3.
- **Gros plan sur les coups décisifs** : local et en ligne, au plus un toutes les 1,5 s, coupé avec les secousses et les éclairs par « Mouvements réduits ».
- **Ordre des phases** : tel quel.

## Écarts de la phase 1

| Prévu | Fait | Pourquoi |
|---|---|---|
| Mappage de tons AgX | Neutral (Khronos PBR Neutral) | AgX désature et assombrit les couleurs franches des thèmes ; Neutral les garde jusqu'aux hautes lumières, ce qui laisse les lueurs rayonner sans changer la direction artistique. |
| SMAA | MSAA ×4 sur l'image intermédiaire HDR | Meilleur sur les arêtes de la géométrie, sans flou des textures, et natif en WebGL 2. |
| Ombres portées lisibles au sol | Présentes, mais peu visibles | La caméra regarde le plan de jeu de face : le dessus des plateformes est vu par la tranche. La légère inclinaison de la caméra (section 5) passe en phase 2, avec la caméra, car l'étiquette des joueurs et la vue technique dépendent de la projection. |
| Lumière d'ambiance | Ajoutée : ciel du thème préfiltré (IBL) | Donne aux matières physiques un modelé doux et cohérent avec le décor. |

## Écarts de la phase 2

| Prévu | Fait | Pourquoi |
|---|---|---|
| Étincelle orientée selon l'angle d'éjection | Orientée à l'opposé de l'attaquant | L'angle d'éjection n'est pas lisible dans l'API publique de `sim-core` pendant le hitlag (il n'est appliqué qu'à sa fin) ; la direction de la traînée, elle, suit la vraie trajectoire. |
| Flash blanc de la victime | Éclat blanc sur la victime | Même lecture à l'écran, sans repeindre les couleurs du mannequin à chaque image ; la figurine de la phase 3 pourra porter un vrai flash de matière. |
| Gros plan sur le coup qui tue | Gros plan sur l'éjection probablement fatale | Le KO n'est connu qu'au franchissement de la zone limite ; l'éjection est estimée au moment où elle part (freinage et gravité de la simulation). |
| Option « secousses et flashs » | Branchée sur « Mouvements réduits » | Réglage d'accessibilité déjà présent, qui suit aussi la préférence du système. |
| Effets propres aux spéciaux et à l'ultime | Effet commun d'ultime ; spéciaux en phase 4 | Ils dépendent de l'identité visuelle des personnages. |

## Écarts de la phase 3

| Prévu | Fait | Pourquoi |
|---|---|---|
| Sorel en figurine, les trois autres en mannequins | Les quatre en figurines ; Sorel avec ses volumes propres, les trois autres avec le corps commun et leurs pièces arrondies | Le même code les sert tous : plus aucune boîte à l'écran dès cette phase. Leurs volumes propres restent pour la phase 4. |
| Visage dessiné dans une texture | Yeux et bouche en volumes, posés sur la tête | Lisibles sous tous les angles, sans coordonnées de texture sur un maillage généré ; deux appels de dessin pour tous les joueurs. |
| Maillage calculé dans un Worker | Calculé au chargement, une fois par personnage, puis gardé en mémoire | ~100 ms par personnage : un Worker n'apporte rien tant que ce temps reste sous l'écran de chargement. À revoir si la phase 4 l'allonge. |
| Version allégée en Bas | Un seul maillage (~8 800 triangles) | Le coût mesuré reste faible ; le contour, lui, est coupé sous Haut. |
| Corps tourné vers la caméra | Corps de 20°, tête de 29° de plus | Tourner le corps entier raccourcirait visuellement les coups par rapport à leurs hitbox ; tourner la tête montre le visage sans fausser la portée. |

## Écarts de la phase 4

| Prévu | Fait | Pourquoi |
|---|---|---|
| `RendererOptions.palettes` | Couleur passée à la fabrique des figurines (`createFigurines(style, palette)`) | Seule la figurine en a l'usage ; l'API du renderer reste inchangée. |
| Couleur choisie aussi en ligne | En ligne : couleurs distinctes automatiques | Transmettre le choix demanderait de modifier le protocole de `lobby` ; à prévoir avec ce module. |
| Effets propres à chaque spécial | Un effet de thème par personnage, commun à ses spéciaux et à son ultime | Lisible et cohérent ; des effets coup par coup (onde du Séisme, galet qui rebondit…) restent possibles en phase 5. |
| Couleur de la victime en flash et matières par personnage | Zone incandescente et zone irisée dans le shader commun | Pas de matière ni d'appel de dessin en plus. |

## Écarts de la phase 5

| Prévu | Fait | Pourquoi |
|---|---|---|
| Fondus dans l'espace des rotations (quaternions) | Fondus d'angles, durée selon la transition | Les poses sont des angles dans le plan du profil, déjà ramenés au plus proche avant chaque fondu (`unwindPose`) : aucune torsion à corriger. |
| Pieds posés sur le bord des plateformes | Pieds qui ne glissent plus (cycle calé sur la distance) | Le bord des plateformes demanderait de lire la géométrie du stage sous chaque pied ; gain faible à cette distance de caméra. |
| Entrée en scène, provocations, victoires, défaite | Reportées en phase 7 | Elles servent l'écran de victoire en 3D ; la simulation n'a pas d'action « provocation » à afficher. |
| Effets coup par coup | Traînée sur les frames actives de tous les coups | Couvre tous les coups de tous les personnages sans données nouvelles. |

## Écarts de la phase 6

| Prévu | Fait | Pourquoi |
|---|---|---|
| Flou de fond (Haut) et occlusion ambiante (Ultra) | Aucun des deux | Les deux lisent la profondeur, que les particules additives n'écrivent pas : halos et contours qui sautent autour des effets. En vue de profil, le décor est déjà loin derrière le plan de jeu ; le gain ne vaut pas le coût. |
| 3 à 5 couches de décor lointain en parallaxe | Ciel par shader (dégradé, nuages qui dérivent, étoiles, soleil ou lune lumineux) devant le décor lointain existant | Le décor lointain existant (îles, façades, récifs, falaises) joue déjà ce rôle ; le ciel remplace les anciens plans plats. |
| Oiseaux, bancs de poissons, caustiques, rayons, pluie, bannières | Particules d'ambiance en boucle propres à chaque stage : poussière dorée (Belvédère), lucioles (Canal), plancton (Récif), braises (Bassin) | Une seule couche de particules par stage, calculée par le shader, couvre « l'air vivant » de chaque décor pour un appel de dessin. |
| Pierre et bois texturés | Grain procédural dans le shader des matières du décor (teinte et relief), qui s'efface au loin | Aucune texture stockée ; sans l'effacement, le grain scintillait sur les terrasses lointaines. |
| Eau animée | Eau à vagues (Gerstner) qui reflète le ciel, au Canal et au Récif | Conforme. |

## Écarts de la phase 7

| Prévu | Fait | Pourquoi |
|---|---|---|
| Portraits générés au chargement | Générés à la première demande, puis gardés en mémoire (`createPortraitStudio`, un seul contexte WebGL hors écran) | Aucun coût au démarrage ; un portrait coûte quelques millisecondes. Sans WebGL, les écrans s'affichent sans portrait. |
| Écran de victoire en 3D, caméra animée | Le vainqueur photographié dans l'une des trois poses de victoire, tirée au hasard, qui entre avec une animation CSS (coupée par « Mouvements réduits ») | Même lecture, sans second rendu 3D ni chargement entre le combat et les résultats. |
| Provocations | Aucune | La simulation n'a pas d'action « provocation » à afficher. |
| Entrées en scène | Apparition en éclat blanc et petit rebond pendant les 30 premières frames du combat | Ne touche que l'affichage, comme les autres effets. |
| — | Correctif : le menu de pause masqué assombrissait tout le combat local (règle CSS `display: grid` plus forte que l'attribut `hidden`) | Défaut antérieur au chantier, trouvé à la vérification de cette phase. |

## Questions ouvertes

1. **Direction artistique** : je propose **« figurines stylisées »** (matières physiques douces, forte lumière de contour, contour fin), plus proche du niveau visé qu'un rendu cartoon à aplats (« cel-shading »). L'alternative cel-shading est plus graphique et un peu moins coûteuse. Laquelle ?
2. **Concepts des personnages** (tableau de la section 2) : à valider ou à corriger avant la phase 3.
3. **Gros plan sur les coups décisifs** : en ligne aussi, ou seulement en local ? Il ne touche pas la simulation, mais il masque brièvement le reste de l'écran à tous les joueurs.
4. **Ordre des phases** : tel quel, ou les personnages (3–4) avant les effets (2) ?
