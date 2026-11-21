# Nacre — bible de personnage

> La zoneuse de Fracas. Toute décision visuelle ou d'animation sur Nacre se juge contre ce
> document, et par contraste avec Sorel (`../sorel/DESIGN.md`).

## Intention

**Une phrase** : la gardienne des récifs, qui tient les intrus à distance d'un bâton de corail et
de perles lancées, avec le calme d'une marée qui monte.

**Ce que le joueur doit ressentir** : « personne ne m'approche ». Nacre contrôle l'espace : la
plus grande allonge du roster, des projectiles qui portent loin. Elle est faible au corps à corps
et le joueur doit sentir qu'elle préfère la distance : elle recule, elle balaie, elle ne se jette
jamais.

**Mots-clés** : gracieuse, ample, posée, souveraine, ondoyante.
**Anti-mots-clés** : brusque, ramassée, pressée, brutale.

**Contraste avec Sorel** : Sorel se bat à mains nues, près de l'adversaire ; Nacre se bat au bout
de son bâton, à distance. Sorel est vif et léger ; Nacre est lente et ample, comme une algue dans
le courant. Ses coups sont des arcs larges dessinés par la pointe du bâton.

## Silhouette

Reconnaissable en ombre chinoise, à 64 pixels de haut :

1. **Le bâton de corail** : une longue ligne tenue dans la main avant, terminée par des branches
   et une perle. Il prolonge tous ses gestes et dessine ses coups.
2. **La couronne de corail** : trois pointes au sommet de la tête, à la couleur du joueur.
3. **La robe-coquillage** évasée jusqu'aux genoux : une cloche sous la taille.
4. **Les longues mèches et les voiles** qui flottent dans le dos, comme dans l'eau.

Langage des formes : **vagues et spirales**. La ligne du bâton est la seule droite, et elle bouge
toujours en arc.

## Palette

| Zone | Couleur | Rôle |
|---|---|---|
| Robe (`primary`) | Turquoise `#2EC4C4` | Couleur dominante, l'eau du récif |
| Voiles, col (`secondary`) | Écume `#F3EAD8` | Légèreté |
| Couronne (couleur du joueur) | Selon le joueur | Identifie le joueur |
| Robe-coquillage (`accent`, irisée) | Nacre `#E9F1F0` | Change de teinte avec l'angle de vue |
| Bâton (`dark`) | Corail `#E25A5A` | Point chaud : la ligne du bâton se lit sur tous les fonds |
| Perles (`light`) | Blanc perle `#FFFAF0` | Collier, bout du bâton |
| Cheveux | Bleu abysse `#1D3B5A` | — |

## Style d'animation

Nacre est animée « en houle » : on lit des vagues qui montent, se déploient et se retirent.

| Principe | Application chez Nacre |
|---|---|
| **Anticipation** | Moyenne : le bâton recule ou se lève d'abord, le corps suit, comme une vague qui se creuse. |
| **Frappe** | Le bâton arrive en bout de course par un arc ample ; arrivée douce (`out`) plutôt que sèche, sauf pour les estocs. |
| **Suivi** | Long : la pointe continue sa course, les voiles et les mèches traînent encore plus. |
| **Retour** | Fluide et lent, la vague se retire. |
| **Arcs** | Partout : la pointe du bâton trace des arcs et des cercles. |
| **Poids** | Légère mais posée : elle glisse plus qu'elle ne marche, elle se pose sans bruit. |
| **Signature** | Le bâton qui tournoie (tourbillon, bulle, écume) ; la main arrière ouverte qui lance les perles. |

**Garde** : droite et calme, de trois quarts, le bâton en diagonale devant elle, pointe vers
l'adversaire ; la main arrière ouverte à hauteur de poitrine, prête à lancer une perle. Au repos,
elle ondule doucement, comme dans un courant.

## Intention de chaque coup

| Clip | Nom | Intention |
|---|---|---|
| `jab1` | Bâton | Petit coup de pointe, droit devant |
| `jab2` | Revers de bâton | Le bâton se lève et retombe en diagonale |
| `jab3` | Tourbillon | Le bâton tournoie devant elle, comme une hélice |
| `ftilt` | Estoc | Fente, le bâton tendu à l'horizontale, toute l'allonge |
| `utilt` | Arc de corail | Le bâton passe en arc au-dessus de sa tête, d'avant en arrière |
| `dtilt` | Balayage long | Accroupie, le bâton balaie le sol d'arrière en avant |
| `dash_attack` | Glissement | Elle glisse, le bâton pointé devant |
| `fsmash` | Lance de corail | Bâton ramené loin en arrière, puis estoc de tout le corps |
| `usmash` | Gerbe | Bâton dressé au-dessus de la tête, elle tourne sur elle-même |
| `dsmash` | Ressac | Le bâton balaie le sol en cercle, devant puis derrière |
| `nair` | Bulle | Le bâton tournoie tout autour d'elle |
| `fair` | Pointe | Estoc aérien, droit devant |
| `bair` | Contre-courant | Le bâton fouette vers l'arrière |
| `uair` | Vague haute | Le bâton passe en arc au-dessus de sa tête, d'arrière en avant |
| `dair` | Plongée | Le bâton plonge à la verticale sous elle |
| `nspecial` | Perle | La main arrière ouverte pousse la perle droit devant |
| `sspecial` | Galet | Lancer par en dessous, en cloche |
| `uspecial` | Écume | Ascension en spirale, le bâton dressé au-dessus de la tête |
| `dspecial` | Corail | Elle plante la pointe du bâton dans le sol devant elle |
| `ultimate` | Grande perle | Elle rassemble l'eau entre ses mains, puis pousse une perle immense |
| `ledge_attack` | Remontée en vague | Remontée et balayage bas du bâton |

## Ce qu'on ne fait pas

- Pas de coup de poing ni de coup de pied : le bâton ou les perles, toujours.
- Pas de geste sec sans raison : seuls les estocs claquent, tout le reste ondule.
- Le bâton ne quitte jamais sa main avant.
- Aucune référence à un personnage existant : silhouette, nom et palette sont propres à Fracas.
