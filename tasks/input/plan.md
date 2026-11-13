# Plan : module `input`

> Statut : **VALIDÉ le 2026-11-13**. Spec : [SPEC-input.md](../../SPEC-input.md). Tâches détaillées : [todo.md](todo.md).

## Approche

**Remplacer sans jamais casser la démo.** La lecture provisoire (`temp-input.ts`) est retirée en deux temps : le clavier d'abord, la manette ensuite. À chaque point de contrôle, la démo se joue au moins aussi bien qu'avant.

Presque tout le module est de la logique pure : mise en forme du stick, dispositions, directions opposées, format d'enregistrement. Elle est développée par les tests, écrits avant le code. Les fichiers qui touchent au navigateur (événements clavier, API Gamepad, `localStorage`) restent minces et sont vérifiés dans Edge.

Le **test de contrat** est le filet principal : il joue dans la vraie simulation les `InputFrame` produits par le module et vérifie que chaque action de `sim-core` se déclenche. Il est posé dès la phase A pour le clavier et étendu à la manette en phase B.

## Composants et dépendances

```
Outillage (paquet input) + actions et dispositions par défaut
   └─ état du clavier (appuis brefs, directions opposées) ─┐
   └─ createInput + sample ───────────────────────────────┤
                                └─ démo au clavier par le module     ← point de contrôle A
                                     ├─ mise en forme du stick
                                     ├─ manettes, joueurs, branchement à chaud
                                     └─ démo sans temp-input, 4 joueurs  ← point de contrôle B
                                          ├─ enregistrement, réglages, saut au stick
                                          └─ remappage et son écran       ← point de contrôle C
                                               └─ mesure et relecture finale  ← point de contrôle D
```

## Phases et points de contrôle

| Phase | Tâches | Ce que vous pouvez faire à la fin |
|---|---|---|
| **A. Clavier** | T1 à T3 | Jouer à la démo au clavier par le nouveau module : demi-tour immédiat quand gauche et droite se croisent, appuis brefs jamais perdus |
| **B. Manette** | T4 à T6 | Brancher une manette, appuyer sur un bouton, jouer ; dash et smash en diagonale ; jusqu'à 4 joueurs sur la machine. **Votre essai avec votre manette est attendu ici.** |
| **C. Remappable** | T7 à T8 | Réassigner chaque commande dans la démo, retrouver vos choix après rechargement, régler la zone morte, activer le saut au stick |
| **D. Tenu** | T9 | Constater que la lecture des inputs n'alloue rien et coûte moins de 0,05 ms ; module terminé |

## Séquentiel ou parallèle

- **Séquentiel** : les phases dans l'ordre. T4 (stick) ne dépend de rien d'autre et pourrait se faire en parallèle de la phase A ; le gain est faible, il sera fait à son tour.
- **Indépendant de ce module** : le plan audio de `render`, et la spec de `netcode`, qui peut s'écrire dès la fin de la phase A puisque l'API `sample` sera en place.

## Risques et parades

| Risque | Parade |
|---|---|
| Une manette réelle ne s'automatise pas : les tests ne prouvent que notre lecture, pas le matériel | Manette simulée dans Edge pour la lecture ; votre essai au point de contrôle B pour le reste, et je le dis dans chaque compte rendu |
| L'étirement des diagonales rend le stick trop sensible près des axes | Fonction pure testée sur toute la course (monotone, sans saut) ; forme réglable ; jugée à votre essai |
| Les manettes non reconnues comme « standard » ont des boutons dans un autre ordre | Elles restent jouables après remappage (phase C) ; en phase B, je signale la manette comme non standard plutôt que de deviner |
| Firefox et Safari s'écartent de l'API Gamepad sur certains points | Lecture écrite contre la spécification, pas contre Edge seul ; vérification manuelle annoncée comme telle, non automatisée |
| Le nom affiché d'une touche n'est connu que dans les navigateurs Chromium | Ailleurs, on affiche le nom de la position physique ; les commandes restent liées à la position, donc rien ne se dérègle |
| Enregistrement indisponible (navigation privée, quota) | Le module fonctionne sans, avec les dispositions par défaut ; aucune erreur visible |
| Une touche du jeu réassignée sur une touche de contrôle de la démo (`P`, `R`, `H`…) | L'écran de remappage de la démo refuse ces touches ; le module lui-même n'en sait rien, son API reste celle de la spec |
| Des raccourcis du navigateur (fermer l'onglet, recharger) ne peuvent pas être soustraits | Les touches accompagnées de Ctrl, Alt ou Méta ne sont jamais prises comme commande de jeu |
| Régression du ressenti au clavier en changeant de module | La disposition par défaut est celle validée ; le test de fumée existant (déplacement, saut) doit passer inchangé à la fin de T3 |

## Prérequis

Aucun outil à installer : Node.js, pnpm, Vitest, Playwright et Edge sont en place. Une manette branchée à votre machine est nécessaire pour le point de contrôle B.
