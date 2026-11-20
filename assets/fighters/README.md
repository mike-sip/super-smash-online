# Modèles 3D des combattants (glTF)

Ce dossier reçoit les modèles animés à la main qui remplacent les figurines procédurales. Un
personnage sans modèle, ou dont le modèle est introuvable, garde sa figurine : on peut ajouter les
modèles un par un, et mêler figurines et modèles dans un même match.

Les hitbox restent dans la frame data (`packages/fighters`), jamais dans le modèle. Le modèle est
purement visuel : il ne peut pas changer le gameplay ni désynchroniser une partie en ligne.

## Mettre un modèle en jeu

1. Exporter `assets/fighters/<id>/model.glb` (`<id>` : `sorel`, `zephine`, `ferroc`, `nacre`…).
2. L'essayer sans rien déclarer : ouvrir le jeu avec `?modeles` dans l'adresse
   (`http://localhost:5185/?modeles`). Chaque personnage essaie alors `fighters/<id>/model.glb`.
3. Une fois validé, le déclarer dans les données du personnage
   (`packages/fighters/src/characters/<id>.ts`) : `look: { …, model: 'fighters/<id>/model.glb' }`.

Le jeu précharge les modèles déclarés pendant les menus. Un modèle qui n'est pas encore arrivé au
début d'un match laisse la figurine pour ce match.

## Format du fichier

| Point | Règle |
|---|---|
| Format | glTF 2.0 binaire (`.glb`), textures incluses dans le fichier |
| Axes | Y vers le haut, le personnage regarde vers **+Z** (Blender : vers −Y, exporteur glTF par défaut) |
| Origine | Entre les pieds, au sol |
| Taille | Libre : le jeu met le modèle à la hauteur du personnage dans la simulation (`def.height`) |
| Squelette | Une armature, maillages skinnés (4 influences par sommet au plus) |
| Matières | PBR métal/rugosité standard ; les couleurs de sommets sont acceptées |
| Animations | Une action par clip, **sur place** : la simulation déplace le personnage, pas l'animation |
| Cadence | 60 images par seconde : une frame de la simulation = une image du clip |

### Propriétés personnalisées (facultatives)

Dans Blender, « Custom Properties » de la **scène**, exportées en `extras` (cocher *Include → Custom
Properties* à l'export) :

| Propriété | Rôle | Par défaut |
|---|---|---|
| `height` | Hauteur du personnage dans les unités du modèle (pieds → sommet de la tête) | Mesurée sur la boîte englobante |
| `walkCycle` | Distance parcourue par un cycle complet du clip `walk`, en hauteurs de personnage | 0,9 |
| `runCycle` | Même chose pour `run` | 1,8 |
| `variants` | Couleurs alternatives : liste JSON d'objets `{ "nom de matière": "#rrggbb" }` | aucune |

Les cycles de pas évitent que les pieds glissent : le clip avance avec la distance réellement
parcourue, pas avec le temps. La couleur alternative choisie à la sélection prend l'entrée
`variants[n - 1]` (la couleur 0 est celle du fichier).

## Noms des clips

Le nom d'un clip dit quand il joue. Les noms sont en minuscules ; un préfixe d'armature
(« Armature|idle ») est ignoré. **Aucun clip n'est obligatoire** sauf `idle` : un clip absent
retombe sur un voisin (une attaque sur une attaque proche, puis sur `attack`, puis sur `idle`).
On peut donc commencer avec `idle`, `run`, `jump`, `fall`, `attack` et compléter ensuite.

Trois façons de régler le temps d'un clip :

- **Étiré sur l'action** : la simulation connaît la durée de l'action (attaques, esquives,
  atterrissage…). Le clip est étiré sur cette durée, quelle que soit sa longueur : sa première
  image tombe sur la frame 0 de l'action, sa dernière sur la dernière frame. Pour que les impacts
  tombent juste, animez à la longueur exacte en frames (`totalFrames` de la frame data, affichée
  dans le tableau de la démo) et placez le coup sur les frames actives.
- **En boucle** : joué en boucle sur l'horloge de la simulation (repos, garde, chute…).
- **Une fois** : joué à 60 images par seconde puis figé sur sa dernière image (montée d'un saut,
  choc), pour les actions dont la durée varie.

| Clip | Quand | Temps |
|---|---|---|
| `idle` | Au repos | Boucle |
| `walk`, `run` | Marche, course | Boucle sur la distance parcourue |
| `dash` | Départ de course | Étiré |
| `brake`, `turn` | Freinage, demi-tour | Étiré |
| `crouch` | Accroupi | Boucle |
| `jumpsquat` | Appel du saut | Étiré |
| `jump`, `double_jump` | Montée d'un saut, d'un double saut | Une fois |
| `fall` | Chute | Boucle |
| `land` | Atterrissage | Étiré |
| `hitstun`, `tumble` | Choc, éjection en vrille | Une fois, boucle |
| `tech`, `down` | Récupération au sol, au sol | Étiré |
| `shield`, `shieldstun`, `shield_drop`, `shield_break` | Bouclier | Boucle, une fois, étiré, une fois |
| `spotdodge`, `roll`, `airdodge` | Esquives | Étiré |
| `grab`, `grab_hold`, `grabbed`, `grab_release` | Saisies | Étiré, boucle, boucle, étiré |
| `throw_forward`, `throw_back`, `throw_up`, `throw_down` | Projections | Étiré |
| `ledge`, `ledge_getup`, `ledge_roll` | Rebord | Boucle, étiré, étiré |
| `item_throw`, `item_swing` | Objets | Étiré |
| `helpless` | Chute impuissante | Boucle |
| `jab1`, `jab2`, `jab3`, `ftilt`, `utilt`, `dtilt`, `dash_attack` | Attaques au sol | Étiré |
| `fsmash`, `usmash`, `dsmash` | Smash | Étiré |
| `fsmash_charge`, `usmash_charge`, `dsmash_charge` | Smash maintenu en charge | Boucle |
| `nair`, `fair`, `bair`, `uair`, `dair` | Aériennes | Étiré |
| `nspecial`, `sspecial`, `uspecial`, `dspecial`, `ultimate` | Spéciaux, ultime | Étiré |
| `ledge_attack`, `extra1`, `extra2` | Attaque de rebord, suites | Étiré |
| `attack` | Repli générique de toutes les attaques | Étiré |

La liste exacte et l'ordre des replis sont dans `packages/render/src/fighters/clips.ts`.

## Ce que le jeu ajoute lui-même

Inutile de l'animer : le jeu fond chaque clip dans le suivant (1,5 à 5 frames selon l'action),
écrase et étire le corps aux sauts et aux atterrissages, fait surgir le personnage en début de
match, le fait clignoter en blanc pendant le gel d'un coup, le pâlit quand il est intangible et
dessine un contour en qualité haute. Tout se règle sur l'état de la simulation : l'image reste
juste en pause, au ralenti et après un rollback en ligne.

## Matières nommées

Le jeu reconnaît deux conventions de nom de matière :

- **`player`** : teinte à la couleur du joueur (rouge, bleu, jaune…), comme le bandeau de Sorel.
  C'est ce qui distingue deux joueurs sur le même personnage.
- **Le nom d'une zone** (`primary`, `secondary`, `accent`, `hair`, `skin`…) : les couleurs
  alternatives (`variants`) remplacent la couleur de base de ces matières.

## Animer à la main sans logiciel 3D

Les modèles des personnages du roster peuvent aussi s'écrire en code : sculpt par volumes, une
matière par zone, clés d'animation posées à la main. C'est ainsi qu'est fait Sorel.

| Fichier | Rôle |
|---|---|
| `assets/fighters/<id>/DESIGN.md` | Bible du personnage : intention, silhouette, palette, style d'animation, intention de chaque coup |
| `packages/render/tools/characters/<id>.ts` | Garde, mèches et détails du modèle, clés de chaque clip |
| `packages/render/tools/anim/keys.ts` | Format des clés : canaux, courbes, instants relatifs à la frame data |
| `packages/render/tools/bake-character.ts` | Export : maillage fin, matières par zone, clés, ressorts du bandeau et de la tunique |

Une clé ne donne que les canaux qui changent ; les autres reprennent la clé précédente. Ses
instants s'écrivent par rapport à la frame data : `'s'` (première frame active), `'e'`
(dernière), `'t'` (fin), `'c'` (charge), avec décalages ou fractions (`'s-3'`, `'t*0.5'`). Un coup
rééquilibré garde ainsi son impact sur la bonne frame sans retoucher l'animation.

Attention : les bras sont orientés par rapport au buste. Quand le buste se penche de `torso`, un
bras horizontal vaut `1.57 + torso`, sinon il retombe.

```bash
node packages/render/tools/bake-character.ts sorel
```

### Revoir les animations

La démo contient une visionneuse : `http://localhost:5173/anim.html?id=sorel` (serveur de la
démo). Liste des clips, lecture, ralenti, image par image, angle de vue. Paramètres utiles :

- `clip=fsmash&frame=14` : un clip figé sur une frame ;
- `zoom=3&focus=0.85` : gros plan sur la tête ;
- `sheet=jab1:3,ftilt:6,fsmash:14` : planche contact, poses côte à côte, vues comme en jeu.

## Point de départ : exporter une figurine

Pour partir d'un squelette aux bonnes proportions, avec tous les clips nommés et à la bonne
durée :

```bash
node packages/render/tools/bake-figurine.ts zephine
```

Le fichier produit est la figurine du personnage, animée par les
poses procédurales. Il s'importe dans Blender pour servir de référence ou de base de travail. Il
ne remplace pas la figurine en jeu tant qu'il n'est pas déclaré (essai : `?modeles`).
