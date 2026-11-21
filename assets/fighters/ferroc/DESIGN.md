# Ferroc — bible de personnage

> Le personnage lourd de Fracas. Toute décision visuelle ou d'animation sur Ferroc se juge contre
> ce document, et par contraste avec Sorel (`../sorel/DESIGN.md`).

## Intention

**Une phrase** : un forgeron des volcans, bourru et chaleureux, qui se bat comme il frappe le fer
— chaque coup tombe comme un marteau sur l'enclume.

**Ce que le joueur doit ressentir** : « quand ça touche, ça fait mal ». Ferroc est lent à
démarrer et à se déplacer ; le joueur doit sentir ce poids dans les mains et être récompensé à
chaque impact. Deux de ses spéciaux ont de l'armure : il encaisse sans broncher, et son corps doit
le montrer (il ne recule pas, il serre les dents).

**Mots-clés** : massif, ancré, inébranlable, explosif, bon vivant.
**Anti-mots-clés** : agile, gracieux, nerveux, fragile.

**Contraste avec Sorel** : Sorel est léger et s'écoule ; Ferroc pèse et s'arrête. Sorel anticipe
à peine ; Ferroc arme ses coups longtemps et le montre. Sorel tourne sur lui-même ; Ferroc reste
planté (une seule toupie, aérienne).

## Silhouette

Reconnaissable en ombre chinoise, à 64 pixels de haut :

1. **Le buste en tonneau et les épaulières** : un trapèze large au-dessus de jambes courtes.
2. **Les gantelets incandescents** : deux poings énormes et lumineux, la lecture de tous ses coups.
3. **La barbe tressée** : un bloc sous le menton qui prolonge la mâchoire carrée.
4. **Le tablier de cuir** : un rectangle sombre du torse aux cuisses.

Langage des formes : **blocs et carrés**, arêtes adoucies. Rien de pointu, rien de fin.

## Palette

| Zone | Couleur | Rôle |
|---|---|---|
| Tunique (`primary`) | Brun brique `#9A4A2A` | Couleur dominante, chaude |
| Manches, bas (`secondary`) | Orange forge `#F28B30` | Chaleur, rappel du feu |
| Épaulières (couleur du joueur) | Selon le joueur, en métal | Identifie le joueur |
| Gantelets (`accent`, émissif) | Braise `#FF7A1A` | Le point le plus lumineux de l'écran : ses poings |
| Tablier, ceinturon (`dark`) | Cuir `#4A2F20` | Masse sombre qui ancre le centre |
| Fer (`light`) | Acier `#8D939C` | Bracelets, boucle, chaîne |
| Cheveux, barbe | Brun charbon `#2A1C14` | — |

## Style d'animation

Ferroc est animé « en poids » : on lit la masse qui se met en mouvement, puis qui s'arrête.

| Principe | Application chez Ferroc |
|---|---|
| **Anticipation** | Longue et visible (elle remplit son démarrage, lent dans la frame data) : le poing remonte, l'épaule recule, les genoux plient. |
| **Frappe** | Arrivée lourde, le corps entier derrière le poing ; le coup est en place à la première frame active. |
| **Suivi** | L'impact s'arrête net puis traîne : le poing reste enfoncé quelques frames, le corps vibre. |
| **Retour** | Lent : il se redresse, souffle, se remet en garde. Jamais de rebond. |
| **Arcs** | Larges et verticaux (marteau, massue), les poings passent par-dessus la tête. |
| **Poids** | Très lourd : atterrissages écrasés dans les genoux, pieds qui restent au sol. |
| **Signature** | Les deux poings ensemble, comme un marteau à deux mains. |

**Garde** : pieds larges, genoux pliés, dos voûté, deux poings serrés devant le ventre, coudes
écartés. Au repos, il respire lentement, fait rouler sa nuque, serre et desserre les poings.

## Intention de chaque coup

| Clip | Nom | Intention |
|---|---|---|
| `jab1` | Marteau | Le poing avant tombe comme un marteau |
| `jab2` | Enclume | Direct du poing arrière, épaule derrière |
| `jab3` | Coup de boutoir | Poussée des deux paumes, tout le corps avance |
| `ftilt` | Revers de pelle | Grand revers du bras avant, l'épaule s'ouvre |
| `utilt` | Uppercut | Uppercut du poing arrière depuis les genoux |
| `dtilt` | Coup de pied bas | Coup de pied de talon au ras du sol |
| `dash_attack` | Charge brute | Plaquage de l'épaule, tête baissée |
| `fsmash` | Masse d'armes | Les deux poings joints au-dessus de la tête, abattus devant lui |
| `usmash` | Éruption | Accroupi, puis les deux poings jaillissent vers le ciel |
| `dsmash` | Frappe au sol | Les deux poings frappent le sol, devant et derrière |
| `nair` | Toupie de fer | Bras tendus, il tourne comme une masse au bout d'une chaîne |
| `fair` | Coup de massue | Les poings joints tombent devant lui |
| `bair` | Coude arrière | Coude planté en arrière, regard par-dessus l'épaule |
| `uair` | Tête-bêche | Coup de tête vers le haut, le dos se cambre |
| `dair` | Enclume tombante | Les deux poings frappent sous lui, le corps en boule |
| `nspecial` | Bélier | Poing armé très loin en arrière, puis direct de tout le corps |
| `sspecial` | Rempart | Charge de l'épaule, l'avant-bras en bouclier |
| `uspecial` | Geyser | Uppercuts alternés en montant, puis les deux poings au ciel |
| `dspecial` | Séisme | Il se laisse tomber de tout son poids, poings en avant |
| `ultimate` | Fournaise | Poings dans le sol, il rassemble la chaleur, puis s'ouvre en explosion |
| `ledge_attack` | Remontée lourde | Il se hisse sur un genou et balaie d'un revers |

## Ce qu'on ne fait pas

- Pas d'outil en main : ses poings sont ses marteaux.
- Pas de rebond, pas de pirouette au sol : s'il paraît léger, c'est raté.
- Pas de colère : il frappe fort, mais avec bonne humeur.
- Aucune référence à un personnage existant : silhouette, nom et palette sont propres à Fracas.
