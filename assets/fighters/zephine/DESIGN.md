# Zéphine — bible de personnage

> Le personnage rapide de Fracas. Toute décision visuelle ou d'animation sur Zéphine se juge
> contre ce document, et par contraste avec Sorel (`../sorel/DESIGN.md`).

## Intention

**Une phrase** : une coursière des falaises qui livre ses messages de corniche en corniche et se
bat comme elle court — en flèche, sur la pointe des pieds, jamais à l'arrêt.

**Ce que le joueur doit ressentir** : « je suis plus rapide que tout le monde ». Elle récompense
les mains vives : coups courts, enchaînés, qui partent et reviennent aussitôt. Elle est fragile
et doit le paraître : légère, éjectée tôt, toujours en mouvement pour ne pas être touchée.

**Mots-clés** : vive, nerveuse, aérienne, espiègle, précise.
**Anti-mots-clés** : lente, lourde, ample, solennelle.

**Contraste avec Sorel** : Sorel dessine des courbes et s'écoule d'une pose à l'autre ; Zéphine
pique en lignes droites et claque d'une pose à l'autre. Sorel tourne autour de la verticale ;
Zéphine fait des saltos et des roues (autour de l'axe du profil).

## Silhouette

Reconnaissable en ombre chinoise, à 64 pixels de haut :

1. **La queue de cheval haute** : une virgule qui fouette derrière la tête à chaque changement de
   direction.
2. **L'écharpe** : un long pan à la couleur du joueur, à hauteur des épaules, qui file à
   l'horizontale dans la course.
3. **Les longues jambes et les bottes à plumes** : jambes 15 % plus longues que Sorel, la lecture
   des coups passe par les pieds.
4. **Les lunettes relevées** sur le front : une barre nette qui casse le rond de la tête.

Langage des formes : **flèches et triangles**. Le corps se penche toujours vers l'avant ; les
membres tendus font des lignes droites.

## Palette

| Zone | Couleur | Rôle |
|---|---|---|
| Veste (`primary`) | Vert d'eau `#5EE6B5` | Couleur dominante |
| Collant, bottes (`secondary`, `dark`) | Anthracite `#2B2F36` | Fait ressortir les jambes en mouvement |
| Écharpe (couleur du joueur) | Selon le joueur | Identifie le joueur |
| Verres, sacoche (`accent`) | Ambre `#F2B33D` | Point chaud, au visage et à la hanche |
| Cheveux | Roux `#D9663A` | Contraste avec la veste froide |
| Peau | `#F2C09A` | — |

## Style d'animation

Zéphine est animée « en staccato » : on lit des poses nettes et des changements secs.

| Principe | Application chez Zéphine |
|---|---|
| **Anticipation** | Minimale (1 à 3 frames), souvent une simple contraction : ses coups partent très tôt. |
| **Frappe** | Membre tendu en ligne droite, arrivée sèche (`snap`), aucune hésitation. |
| **Suivi** | Court : le membre revient presque aussitôt, prêt pour le coup suivant. Seules la queue de cheval et l'écharpe traînent. |
| **Retour** | Rapide, avec un petit rebond sur la pointe des pieds. |
| **Arcs** | Rares : estocs et coups de pied en ligne. Les arcs sont réservés aux roues et saltos. |
| **Poids** | Très légère : elle rebondit à l'atterrissage, ne s'écrase jamais. |
| **Signature** | Les acrobaties : roue, salto, vrille ; les pieds frappent plus que les mains. |

**Garde** : penchée vers l'avant comme une sprinteuse au départ, sur l'avant des pieds, jambes en
fente, mains basses et ouvertes. Au repos, elle sautille sur place.

## Intention de chaque coup

| Clip | Nom | Intention |
|---|---|---|
| `jab1` | Pique | Main avant en lame, doigts tendus, piqués droit devant |
| `jab2` | Contre-pique | Même geste de la main arrière, le buste pivote |
| `jab3` | Coup de talon | Coup de pied latéral, talon devant, corps à l'horizontale |
| `ftilt` | Fouet | Jambe avant qui fouette à hauteur de tête |
| `utilt` | Moulinet | La jambe passe en arc au-dessus de la tête, d'avant en arrière |
| `dtilt` | Fauchage | Sur une main, la jambe fauche au ras du sol |
| `dash_attack` | Glissade | Glissade pieds devant, appuyée sur une main |
| `fsmash` | Double estoc | Deux piques des mains, la seconde avec tout le corps derrière |
| `usmash` | Vrille | Sur la pointe d'un pied, vrille vers le ciel, bras tendus en flèche |
| `dsmash` | Éventail | Grand écart au sol, devant et derrière à la fois |
| `nair` | Roue | Une roue complète, bras et jambes en étoile |
| `fair` | Ciseaux | Deux coups de pied en ciseaux vers l'avant |
| `bair` | Talon arrière | Ruade sèche, regard par-dessus l'épaule |
| `uair` | Pirouette | Salto arrière, la jambe fouette au-dessus de la tête |
| `dair` | Piétinement | Trois coups de talon vers le bas, en alternant les pieds |
| `nspecial` | Plumes | Lancer de poignet, la plume part entre deux doigts |
| `sspecial` | Fente | Fente horizontale, corps et bras avant tendus comme une flèche |
| `uspecial` | Envol | Bond en diagonale, genou levé, puis salto |
| `dspecial` | Piqué | Plongeon du pied en diagonale, corps raide comme une flèche |
| `ultimate` | Mille rafales | Trois rafales en traversant, puis un coup de pied retourné |
| `ledge_attack` | Bond du rebord | Saut par-dessus le rebord et coup de pied latéral |

## Ce qu'on ne fait pas

- Pas d'arme : seules les plumes qu'elle lance, et ses pieds.
- Pas de pose lente ni de préparation longue : si un coup semble « peser », il est raté.
- Aucune référence à un personnage existant : silhouette, nom et palette sont propres à Fracas.
