# Plan : module `render`

> Statut : **VALIDÉ le 2026-11-12**, après relecture contre la spec et le code de `sim-core` (corrections intégrées aux tâches). Spec : [SPEC-render.md](../../SPEC-render.md). Tâches détaillées : [todo.md](todo.md).

## Approche

**Jouable d'abord, beau ensuite.** La première phase livre un combat contrôlable avec des boîtes à la place des combattants. Tout le reste (mannequins, caméra, effets, outils) vient enrichir quelque chose qui tourne déjà, et chaque phase se termine par une démo que vous pouvez essayer.

La logique qui peut s'écrire sans WebGL (cadrage, interpolation, poses, filtre d'événements) est développée par les tests, comme `sim-core`. Ce qui touche à l'écran est vérifié dans la démo et par captures d'écran.

## Composants et dépendances

```
Outillage (paquets render et demo, Three.js, Vite)
   └─ renderer + interpolation ─┐
   └─ boucle à pas fixe + entrées provisoires ─┤
                                └─ démo jouable en boîtes        ← point de contrôle A
                                     ├─ caméra automatique
                                     ├─ mannequins et poses
                                     └─ entités et HUD            ← point de contrôle B
                                          ├─ événements et effets
                                          └─ vue technique et contrôles   ← point de contrôle C
                                               ├─ mesure et budget de performance
                                               └─ panneau de réglage        ← point de contrôle D
```

## Phases et points de contrôle

| Phase | Tâches | Ce que vous pouvez faire à la fin |
|---|---|---|
| **A. Jouable** | T1 à T3 | Lancer la démo et contrôler une boîte sur le stage, au clavier et à la manette, contre des boîtes immobiles |
| **B. Lisible** | T4 à T6 | Reconnaître chaque action à sa pose, suivre le combat grâce à la caméra, lire les pourcentages |
| **C. Outillé** | T7 à T8 | Voir les impacts, boucliers et KO ; afficher les hitbox ; mettre en pause, avancer image par image, ralentir. **C'est la phase où votre avis sur le ressenti est attendu.** |
| **D. Tenu** | T9 à T10 | Constater les 60 images par seconde mesurées à 8 combattants ; régler les valeurs de gameplay en direct |

L'audio fera l'objet d'un plan séparé, après le point de contrôle D.

## Séquentiel ou parallèle

- **Séquentiel** : la phase A, puis les phases dans l'ordre.
- **Indépendantes à l'intérieur d'une phase** : en B, caméra, mannequins et HUD ne touchent pas aux mêmes fichiers ; en C, effets et vue technique non plus. Elles seront tout de même faites l'une après l'autre : le gain du parallèle est faible à cette échelle, et chaque tâche se vérifie dans la démo.
- **Démarrable en parallèle par ailleurs** : la spec du module `input` peut être écrite dès la fin de la phase A, puisqu'elle remplacera `temp-input.ts`.

## Risques et parades

| Risque | Parade |
|---|---|
| Version de Three.js plus récente que mes connaissances | Lire la documentation de la version installée avant d'écrire le renderer ; la figer dans le lockfile |
| La mesure de performance en navigateur sans fenêtre utilise un rendu logiciel, donc des chiffres sans rapport avec la réalité | Vérifier d'abord quel moteur de rendu Edge utilise dans le test ; si c'est logiciel, mesurer dans une fenêtre visible, et le dire |
| Les poses procédurales ne suffisent pas à juger la « fluidité des animations » | Elles suffisent pour le ressenti des commandes et la lisibilité, pas pour l'esthétique : l'annoncer comme tel, et garder l'interface `FighterVisual` pour les vrais modèles |
| Le HUD en HTML coûte cher s'il est réécrit à chaque image | Ne toucher au DOM que lorsqu'une valeur change |
| Le clavier ne produit qu'un stick tout ou rien, ce qui fausse le jugement sur la marche et les tilts | Touche de modification pour un demi-stick ; recommander la manette pour juger le ressenti |
| Le réglage en direct modifie des données que `sim-core` considère figées | Le panneau travaille sur une copie de la configuration et recrée la simulation à chaque changement ; `sim-core` n'est pas modifié |
| Le budget de 100 appels de dessin est serré (8 mannequins de 6 pièces en consomment déjà 48) et n'est mesuré qu'en phase D | Membres dessinés par instances dès T5 ; compteur d'appels de dessin visible dans la vue technique dès T8 |
| `@game/sim-core` se résout vers `dist/`, non versionné : tests et démo cassent sur un dépôt fraîchement cloné | Alias vers les sources en développement et en test, build préalable pour le typecheck et le build (T1) |
| Une simulation recréée (réinitialisation, panneau de réglage) repart de la frame 0 et le filtre d'événements n'affiche plus aucun effet | Le renderer est recréé avec la simulation (T7, T10) |
| La vue technique recalcule rebords et hitbox au lieu de les lire dans la simulation, et peut diverger | Tests contre des cas connus de `sim-core` (T8) ; si l'écart devient gênant, proposer une lecture des rebords dans l'API de `sim-core`, avec votre accord |
| Je ne peux pas juger le ressenti à votre place | Les critères « lisible » et « ressenti » ne sont validés que par votre essai ; je fournis captures et mesures, pas un verdict |

## Prérequis

Aucun : Node.js, pnpm, Vite et Edge sont déjà en place. Three.js sera ajouté en T1, comme prévu par la spec. Le dossier `apps/` sera ajouté à l'espace de travail pnpm en T1.
