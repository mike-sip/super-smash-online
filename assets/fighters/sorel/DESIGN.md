# Sorel — bible de personnage

> Combattant de référence de Fracas. Toute décision visuelle ou d'animation sur Sorel se juge
> contre ce document. Les trois autres personnages se définiront par contraste avec lui.

## Intention

**Une phrase** : un jeune moine-messager qui se bat comme le vent souffle — sans effort apparent,
toujours en mouvement, jamais brutal.

**Ce que le joueur doit ressentir** : « je peux tout faire avec lui ». Sorel est le premier
personnage qu'on essaie et celui sur lequel on revient pour apprendre le jeu. Il doit être lisible
avant d'être spectaculaire : chaque coup annonce sa direction, chaque fin de coup rend la main
clairement.

**Mots-clés** : souple, vif, léger, serein, joueur.
**Anti-mots-clés** : lourd, crispé, agressif, mécanique.

## Silhouette

Reconnaissable en ombre chinoise, à 64 pixels de haut :

1. **Le bandeau et ses deux longs pans** : la signature. Ils traînent derrière lui et dessinent
   chaque mouvement en différé (le vent qui le suit). Ils ne restent jamais immobiles.
2. **Le chignon haut** : une boule nette au sommet du crâne, qui casse le rond de la tête.
3. **La tunique évasée** : un triangle du bassin aux cuisses, qui s'ouvre dans les sauts et les
   coups de pied.
4. **Membres fins, mains et pieds marqués** : proportions de figurine (tête ×1,16, mains ×1,35),
   lecture des coups par les extrémités.

Langage des formes : **courbes et gouttes** (le vent), aucun angle dur. Les seules lignes droites
sont les bandes aux avant-bras, qui guident l'œil vers les poings.

## Palette

| Zone | Couleur | Rôle |
|---|---|---|
| Tunique (`primary`) | Bleu ciel `#5AA9E6` | Couleur dominante, celle du joueur dans les couleurs alternatives |
| Sous-vêtement (`secondary`) | Blanc cassé `#F1F5F9` | Respiration, lisibilité sur les stages chauds |
| Bandeau (couleur du joueur) | Selon le joueur | Identifie le joueur sans casser le design |
| Ceinture, liseré (`accent`) | Ocre doré `#E8B44A` | Point chaud, attire l'œil au centre de gravité |
| Cheveux | Bleu nuit `#1E2433` | Contraste maximal avec la peau et le ciel |
| Peau | Pêche `#E6B38C` | — |

Règle : **deux couleurs dominent, une troisième pique**. Les huit couleurs alternatives suivent la
même hiérarchie (tunique, sous-vêtement, accent).

## Style d'animation

Sorel est animé « en fluide » : on lit des courbes, pas des positions.

| Principe | Application chez Sorel |
|---|---|
| **Anticipation** | Courte mais toujours présente (2 à 4 frames) : un léger recul, une épaule qui se charge. Jamais de préparation qui ralentit le startup réel. |
| **Frappe** | Le coup est en place à la première frame active, tenu jusqu'à la dernière. Pose extrême, lisible, membre tendu. |
| **Suivi** | Le corps continue après le coup (rotation, bras qui retombe), les pans du bandeau encore plus tard. |
| **Retour** | Ease-out long vers la garde : il « se pose » plutôt qu'il ne se remet en place. |
| **Arcs** | Les poings et les pieds tracent des arcs, jamais des lignes droites. |
| **Poids** | Léger : atterrissages amortis dans les genoux, pas d'écrasement lourd. |
| **Spirale** | Signature : beaucoup de coups tournent autour de l'axe vertical (Toupie, Spirale, Tempête). |

**Garde** : de trois quarts, poids sur la jambe arrière, main avant ouverte à hauteur du menton,
main arrière près de la ceinture. Le torse respire, le bandeau flotte.

## Intention de chaque coup

| Clip | Nom | Intention |
|---|---|---|
| `jab1` | Coup sec | Pique du poing avant, épaule en avant, très court |
| `jab2` | Revers | Revers de la main arrière, le buste pivote |
| `jab3` | Rafale du pied | Coup de pied avant haut, la tunique s'ouvre |
| `ftilt` | Pied fouetté | Coup de pied circulaire, hanches qui tournent |
| `utilt` | Arc ascendant | Bras qui balaie en arc au-dessus de la tête, d'avant en arrière |
| `dtilt` | Balayage | Accroupi, jambe avant qui fauche au ras du sol |
| `dash_attack` | Élan d'épaule | Épaule lancée, le corps entier projeté |
| `fsmash` | Poing-rafale | Grand recul du poing, puis coup de paume poussé par tout le corps |
| `usmash` | Colonne de vent | Accroupi puis jaillissement, deux paumes vers le ciel |
| `dsmash` | Double balayage | Grand écart tournant, devant puis derrière |
| `nair` | Toupie | Jambes écartées, tour complet sur lui-même |
| `fair` | Coup de taille | Tranchant de la main de haut en bas, devant lui |
| `bair` | Ruade | Coup de pied arrière, regard par-dessus l'épaule |
| `uair` | Ciseau | Ciseau des deux jambes au-dessus de la tête |
| `dair` | Pique du talon | Talon qui plonge, genou replié avant l'extension |
| `nspecial` | Trait de vent | Paumes jointes à la hanche, puis poussée vers l'avant |
| `sspecial` | Ruée | Fente horizontale, corps tendu comme une flèche |
| `uspecial` | Spirale | Ascension en tourbillon, bras écartés |
| `dspecial` | Contre | Garde ouverte, mains en pare-vent, attente calme |
| `extra1` | Riposte du vent | Contre réussi : volte-face et coup de paume |
| `ultimate` | Tempête | Tourbillon : rassemble, puis s'ouvre en étoile |
| `ledge_attack` | Remontée tournoyante | Remontée en pirouette, jambe tendue |

## Ce qu'on ne fait pas

- Pas d'arme, pas d'armure : Sorel se bat à mains nues, le vent est son seul effet.
- Pas de poses « badass » figées : même ses poses de victoire bougent.
- Aucune référence à un personnage existant : silhouette, nom et palette sont propres à Fracas.
