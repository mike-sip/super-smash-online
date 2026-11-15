# Plan : module `stages-items`

> Statut : **APPROUVÉ le 2026-11-13, terminé le 2026-11-15** (bilan en fin de spec). Spec : [SPEC-stages-items.md](../../SPEC-stages-items.md). Tâches détaillées : [todo.md](todo.md).

## Approche

**Du statique au dynamique, de la simulation à l'image.** On commence par ce qui ne demande aucune modification de `sim-core` (le paquet, la validation, les deux stages fixes, le choix du stage dans la démo), pour avoir tout de suite quelque chose à essayer. Viennent ensuite l'extension de `sim-core`, en deux temps (le stage qui bouge, puis les objets), et enfin les décors et la mesure de performance.

Toute la logique qui tourne dans `step` est écrite **scénario d'abord**, comme dans `sim-core`. Les décors sont vérifiés par captures.

L'extension de `sim-core` commence par un commit qui n'ajoute que des champs vides (contrats optionnels, champs d'état, constantes) et régénère les checksums de référence, après avoir vérifié que le comportement des séquences existantes est inchangé. Ainsi, chaque mécanique ajoutée ensuite ne change que ce qu'elle doit changer, et la fusion avec les autres branches reste lisible.

## Composants et dépendances

```
Paquet @game/stages-items + validateStage
   └─ Belvédère et Récif (statiques) + applyStage
        └─ démo : choix du stage                                   ← point de contrôle A
             └─ sim-core : champs vides + checksums régénérés
                  ├─ plateformes mobiles (stage-motion.ts)
                  └─ dangers (stage-motion.ts, capsule verticale)
                       └─ Canal et Geysers                         ← point de contrôle B
                            └─ objets : apparition et physique (items.ts)
                                 └─ ramasser, lancer, frapper
                                      └─ soin, bris, explosion ; contenu des 5 objets ; applyItems
                                           └─ déterminisme, rollback, benchmark       ← point de contrôle C
                                                └─ render : points d'extension (StageVisuals, objets, poses)
                                                     └─ 4 décors procéduraux
                                                          └─ démo : objets et dangers ; perf sur 4 stages ; bilan  ← point de contrôle D
```

## Phases et points de contrôle

| Phase | Tâches | Ce que vous pouvez faire à la fin |
|---|---|---|
| **A. Stages fixes** | T1 à T3 | Choisir le Belvédère ou le Récif dans la démo et y jouer (décor neutre) |
| **B. Stages vivants** | T4 à T7 | Monter sur une barge du Canal, se faire éjecter par un geyser (décor neutre, entités en sphères) |
| **C. Objets** | T8 à T11 | Activer les objets dans la démo, ramasser, lancer, frapper, se soigner (objets en sphères) |
| **D. Décors et bilan** | T12 à T15 | Jouer sur les 4 décors, voir chaque objet sous sa forme ; mesure de performance passante sur les 4 stages ; bilan écrit en fin de spec |

Chaque point de contrôle : tests, typecheck et lint passants, commit, captures et compte rendu à votre intention.

## Séquentiel ou parallèle

Séquentiel. Les phases B et C modifient les mêmes fichiers de `sim-core` (`step.ts`, `state.ts`, `hit.ts`) ; la phase D dépend des positions et modes d'objets exposés par C. À l'intérieur de la phase D, les 4 décors sont indépendants, mais ils partagent `palette.ts` et le budget d'appels de dessin : je les fais à la suite.

## Risques et parades

| Risque | Parade |
|---|---|
| Une branche parallèle (`fighters`, `match-rules`) ajoute des actions, événements ou champs d'état aux mêmes numéros | Ajouts toujours en fin de liste ; liste déposée dans le dossier de notes partagé ; renumérotation à la fusion, checksums régénérés à ce moment-là |
| La régénération des checksums masque un changement de comportement involontaire | Avant de régénérer : rejouer les séquences de référence avec l'ancien et le nouvel état et comparer positions, actions et dégâts finaux, joueur par joueur (T4) |
| Une plateforme mobile laisse passer un combattant qui tombe, ou le fait glisser | Atterrissage comparé à la hauteur de la frame précédente ; scénarios dédiés (plateforme qui monte, qui descend, qui part de côté) |
| Un objet posé sur une plateforme mobile, ou un combattant porté, désynchronise après un rollback | Position des plateformes fonction pure de la frame ; test de propriété sauvegarde/restauration sur le Canal avec objets |
| Le tirage aléatoire dépend d'un ordre d'itération non déterministe | Un seul générateur (`G_RNG`), emplacements d'entités parcourus par index croissant ; test de répartition des poids |
| Le budget de 100 appels de dessin est dépassé par les décors et les objets | Mesurer la base actuelle en T12 ; décor statique fusionné en une ou deux géométries à couleurs par sommet ; une instance par forme d'objet ; compteur de la vue technique suivi à chaque décor |
| Le coût de `step` grimpe avec les objets | Benchmark de `sim-core` étendu en T11 avec objets et plateformes mobiles, seuil de la spec |
| Le rendu des objets tenus « flotte » à côté de la main du mannequin | Accepté pour la v1 (le mannequin n'a pas d'os) : l'objet suit un point devant le combattant ; signalé dans les écarts |
| Le ressenti des objets (portée, vitesse de lancer) ne se juge pas par test | Valeurs regroupées dans `items.ts` du paquet, faciles à régler ; votre avis demandé au point de contrôle C |

## Prérequis

Aucun : Node.js, pnpm, Vite, Three.js et Edge sont en place.
