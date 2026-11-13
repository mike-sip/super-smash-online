# Plan : module `sim-core`

> Statut : **APPROUVÉ le 2026-11-11**. Spec : [SPEC-sim-core.md](../../SPEC-sim-core.md). Tâches détaillées : [todo.md](todo.md).

## Approche

Le module se construit en **tranches verticales** : chaque tâche livre une mécanique complète (données, système, scénario de test) plutôt qu'une couche technique isolée. Les garde-fous de déterminisme et de performance sont posés **avant** la première mécanique, pour que chaque tranche soit vérifiée contre eux dès son arrivée.

## Composants et dépendances

```
Outillage (monorepo, lint anti-non-déterminisme)
   └─ fixed.ts (virgule fixe, tables trigo)
        └─ state.ts (mémoire, snapshot, checksum, aléatoire)
             └─ step.ts + input.ts + defs.ts (pipeline vide, combattant et stage de test)
                  └─ harnais : déterminisme (Node) + rollback + benchmark
                       └─ déplacement au sol → airs et plateformes → zones limites
                            └─ machine à états et attaques → hitbox → dégâts et éjection
                                 ├─ bouclier
                                 ├─ esquives
                                 ├─ saisies
                                 ├─ rebords
                                 └─ entités (projectiles, objets)
                                      └─ déterminisme inter-navigateurs → durcissement et API de lecture
```

## Phases et points de contrôle

| Phase | Tâches | Point de contrôle (tout doit passer avant la phase suivante) |
|---|---|---|
| **A. Fondations** | T1 à T5 | Un `step` vide à 8 joueurs est déterministe dans Node, le test de rollback passe, le benchmark tourne avec ses seuils, le lint refuse `Math.random` et consorts |
| **B. Mouvement** | T6 à T8 | Le combattant de test court, saute, traverse les plateformes et meurt hors des zones limites, par scénarios scriptés |
| **C. Combat** | T9 à T11 | Un coup touche, inflige des dégâts et éjecte selon la formule ; la DI modifie la trajectoire ; l'éjection à fort pourcentage provoque un KO |
| **D. Défense et options** | T12 à T16 | Chaque ligne du périmètre fonctionnel de la spec a au moins un scénario qui passe |
| **E. Durcissement** | T17 à T18 | Les 7 critères de succès de la spec sont vérifiés, sauf le n° 7 (jouabilité) qui dépend du module `render` |

Vous relisez à la fin de chaque phase. La phase B est le premier moment où il y a quelque chose de concret à observer (traces de trajectoires dans les tests) ; le ressenti manette en main arrive avec `render`.

## Séquentiel ou parallèle

- **Séquentiel obligatoire** : phases A, B et C, chacune repose sur la précédente.
- **Indépendantes en théorie** : les cinq tâches de la phase D. En pratique elles modifient toutes `state.ts` et `step.ts`, donc elles seront faites l'une après l'autre pour éviter les conflits. Ordre choisi : bouclier, esquives, saisies, rebords, entités (du plus utilisé en combat au plus isolé).
- **Parallélisable plus tard** : dès la fin de la phase A, l'API publique est figée, donc les modules `input` et `render` peuvent démarrer leur propre spec sans attendre la fin de `sim-core`.

## Risques et parades

| Risque | Parade |
|---|---|
| Débordement en virgule fixe (produit de deux grands nombres au-delà de 2⁵³) | Bornes documentées sur chaque grandeur, tests aux limites dans T2, assertions actives en mode test uniquement |
| La disposition mémoire change à chaque mécanique et casse les checksums de référence | Les checksums de référence longs ne sont figés qu'en phase E ; avant, le déterminisme est vérifié par double exécution |
| Un système alloue discrètement (closure, tableau temporaire) | Mesure du tas dans le benchmark dès T5, pas seulement à la fin |
| La machine à états pilotée par données devient trop rigide pour les 4 personnages réels | T9 inclut un second combattant de test volontairement différent (lourd, lent) pour éprouver le format `FighterDef` |
| Écart de comportement entre Node et un navigateur découvert tard | Un premier test Playwright minimal sur Chromium est branché dès la phase C, la matrice complète en phase E |
| Seuils de performance mesurés sur une seule machine | Seuils exprimés avec une marge de 4× par rapport à la mesure locale, à recalibrer quand une CI existera |

## Prérequis

Node.js LTS (≥ 24) et pnpm doivent être installés sur la machine. Rien d'autre ne peut démarrer avant.

## Hors de ce plan

Intégration continue hébergée (GitHub Actions), page de démonstration jouable, contenu réel des personnages : traités avec les modules `app-shell`, `render` et `fighters`.
