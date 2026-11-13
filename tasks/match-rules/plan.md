# Plan : module `match-rules`

> Statut : **VALIDÉ le 2026-11-13.** Spec : [SPEC-match-rules.md](../../SPEC-match-rules.md). Tâches détaillées : [todo.md](todo.md).

## Approche

**Les fondations dans `sim-core` d'abord, isolées.** Les six ajouts accordés sont faits en premier, chacun avec son scénario, sans toucher au sens de l'existant. La phase se termine par la régénération des checksums de référence, dans un commit à part : c'est le seul endroit où la branche modifie un résultat de `sim-core`.

**Puis les règles, mode par mode.** Le paquet `match-rules` grandit par tranches jouables en test : Stock d'abord (le plus simple à vérifier), puis l'attribution des KO et les statistiques, puis Temps et Endurance, puis la fin de match (départage, mort subite, classement), puis la jauge d'ultime. Chaque règle commence par un scénario qui échoue, joué avec le combattant de test.

**La robustesse ensuite**, sur des matchs complets : rollback, déterminisme, coût. **L'affichage en dernier** : HUD dans `render`, puis choix du mode et écran de résultats dans la démo.

## Composants et dépendances

```
sim-core : crochet + zone réservée ─┬─ équipes et tir allié
                                    ├─ invincibilité, knockOut, setDamage
                                    └─ attaque ultime (+ ultime du combattant de test)
                                         └─ checksums de référence régénérés      ← point de contrôle A
match-rules : paquet + MatchConfig validée
   └─ mode Stock : KO, vies, réapparition, élimination
        └─ attribution des KO et statistiques
             └─ modes Temps et Endurance
                  └─ fin de match : départage, mort subite, classement, résultats
                       └─ jauge d'ultime                                         ← point de contrôle B
                            └─ rollback, déterminisme, coût                       ← point de contrôle C
                                 └─ HUD de match (render)
                                      └─ démo : choix du mode, équipes, résultats ← point de contrôle D
```

## Phases et points de contrôle

| Phase | Tâches | Ce que vous pouvez vérifier à la fin |
|---|---|---|
| **A. Fondations `sim-core`** | T1 à T5 | Les ajouts sont additifs : tous les tests existants de `sim-core` passent sans modification, chaque ajout a son scénario, les checksums sont régénérés dans un commit dédié |
| **B. Règles** | T6 à T11 | Chaque mode, chaque règle du tableau de la spec couvert par un scénario ; `MatchConfig` validée |
| **C. Robustesse** | T12 à T13 | Rollback sur 500 matchs tirés au hasard, 3 matchs de référence versionnés, coût du crochet mesuré |
| **D. Visible** | T14 à T16 | Jouer un match dans la démo en choisissant mode et équipes, voir le HUD et l'écran de résultats ; bilan des critères en fin de spec |

## Séquentiel ou parallèle

- **Séquentiel** : tout. Les tâches de la phase A touchent les mêmes fichiers de `sim-core` (`state.ts`, `step.ts`, `index.ts`) ; celles de la phase B s'empilent dans `rules.ts`.
- Le HUD (T14) pourrait partir dès la phase B, mais il dépend de la forme finale de `MatchView` : il attend la fin de B.

## Risques et parades

| Risque | Parade |
|---|---|
| Conflits de fusion dans `sim-core` avec les sessions `fighters`, `stages-items` et `netcode`, qui peuvent aussi l'étendre | Ajouts regroupés et commentés « match-rules » ; nouveaux champs ajoutés en fin de liste ; interface partagée dans le dossier de notes commun ; `golden.json` régénéré à la fusion, jamais fusionné à la main |
| La session `fighters` ajoute elle aussi l'emplacement de l'ultime | Proposition d'interface déjà envoyée ; si elle répond avec une autre forme, j'aligne avant T4 et je vous le signale |
| Une règle de match écrite hors du crochet (dans la démo) échapperait au rollback | Toute la logique est dans `afterStep` ; la démo ne fait que lire `readMatch` et `matchResult` ; le test de rollback couvre réapparition et fin |
| Fin de match pendant une re-simulation de `netcode` : un résultat « affiché » puis annulé | `matchResult` se lit sur l'état courant ; c'est à l'application de n'afficher l'écran de fin que sur une frame confirmée. Noté pour `netcode` |
| Événements perdus : la file de `sim-core` est plafonnée à 64 par frame | Les KO sont aussi détectés par l'état (`A_DEAD`) et non seulement par l'événement ; idem pour l'ultime (drapeau `ultimateReady` retombé) |
| Arrondis de la jauge et du partage des dégâts | Entiers en virgule fixe uniquement, règles de reste fixées dans la spec, testées |
| Mort subite sans fin si les joueurs ne se touchent pas | Assumé dans la v1 (comme la spec) ; à revoir avec le ressenti |

## Prérequis

Aucun : Node.js, pnpm, Vitest et Playwright (Edge) sont en place. Pas de nouvelle dépendance : le paquet `match-rules` n'utilise que `@game/sim-core` et l'outillage déjà présent dans le dépôt.
