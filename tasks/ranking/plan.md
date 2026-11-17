# Plan : module `ranking`

> Statut : **VALIDÉ le 2026-11-15**. Spec : [SPEC-ranking.md](../../SPEC-ranking.md). Tâches détaillées : [todo.md](todo.md).

## Approche

**La formule d'abord, prouvée seule.** `rating.ts` est une fonction pure : cas connus écrits avant le code (valeurs de la spec), puis propriétés sur 10 000 matchs aléatoires (somme nulle exacte, pas de dérive, partant jamais gagnant). Viennent ensuite la validation des rapports et leur signature, autres fonctions pures ; puis le stockage (suite de contrat sur mémoire et SQLite) et les règles métier (idempotence, file, synchronisation des compteurs, suppression), testés sans réseau avec une horloge factice et un `AccountService` réel sur stockage mémoire.

**Toucher `accounts` le moins possible, et une seule fois.** Les deux ajouts (extension HTTP par préfixe, `publicNames`) forment une seule tâche, avec leurs tests dans `accounts`, et ne changent aucun comportement existant : toute la suite d'`accounts` doit passer inchangée.

**Bout en bout sur un vrai serveur.** Comptes et classement dans le même processus HTTP, port libre ; chaque protection (signature, fraîcheur, origine, session) et chaque parcours a son test. La démo n'est touchée qu'à la fin, n'appelle le serveur qu'à l'ouverture du panneau, et ses tests existants ne voient aucune différence.

## Composants et dépendances

```
Paquet @game/ranking : protocole, validation, reportFromResult
   ├─ formule (rating.ts) + propriétés
   └─ signature des rapports (report.ts)                  ← point de contrôle A : règles prouvées
        └─ interface de stockage + mémoire + suite de contrat
             └─ stockage SQLite et migrations
                  └─ règles métier (service)               ← point de contrôle B : métier prouvé sans réseau
                       └─ extension HTTP et publicNames dans accounts
                            └─ routes /api/ranking, createRanking, dev/start/seed   ← point de contrôle C : serveur lançable
                                 ├─ client navigateur
                                 └─ panneau Classement de la démo                  ← point de contrôle D : visible dans la démo
                                      └─ relecture de sécurité, bilan, note à lobby ← point de contrôle E : module terminé
```

## Phases et points de contrôle

| Phase | Tâches | Ce que vous pouvez faire à la fin |
|---|---|---|
| **A. Règles** | T1 à T3 | Lire les tests de la formule (valeurs à 2, 8 joueurs, équipes, égalités, abandons) et de la signature |
| **B. Métier** | T4 à T6 | Constater que la suite de contrat passe sur les deux stockages, et que doublons, conflits, suppression et reprise de synchronisation sont couverts |
| **C. Serveur** | T7 à T8 | Lancer `pnpm --filter @game/ranking dev`, semer des matchs avec `seed`, interroger `/api/ranking/v1/leaderboard` |
| **D. Démo** | T9 à T10 | Ouvrir le panneau Classement de la démo : tableau, ma cote, mon historique |
| **E. Terminé** | T11 | Lire la relecture de sécurité et le bilan des critères de succès |

## Séquentiel ou parallèle

- **Séquentiel** : les phases dans l'ordre.
- **Avec `lobby`** : l'interface (rapport, signature, `submitMatch`) est décrite dans la spec et dans la note `ranking-interface-for-lobby.md` du dossier partagé. `lobby` peut coder contre elle dès maintenant ; le branchement réel se fera à la fusion des deux branches. Si `lobby` demande un changement, il passera par la spec et par vous.

## Risques et parades

| Risque | Parade |
|---|---|
| Arrondi qui fait dériver le total | Plus fort reste, somme nulle vérifiée à chaque match dans les tests de propriétés, et à l'exécution (le service refuse d'appliquer une variation de somme non nulle) |
| Deux soumissions simultanées du même match | File en mémoire (une soumission à la fois) **et** clé primaire en base ; test de soumissions simultanées |
| Échec entre la transaction du classement et `recordMatch` d'`accounts` | Participants marqués « synchronisés » ; reprise au démarrage et périodiquement ; test avec un `recordMatch` qui échoue |
| `accounts` n'appelle pas `onAccountDeleted` pour les invités purgés ou effacés à la déconnexion | Balayage périodique : les identifiants absents de `publicNames` sont traités comme supprimés ; test |
| L'extension d'`accounts` change un comportement existant | Ajouts facultatifs uniquement ; suite complète d'`accounts` rejouée inchangée |
| Erreurs 4xx dans la console du navigateur qui feraient échouer les tests de fumée de la démo | `GET /me` sans session répond `200 { profile: null }` ; panneau chargé à l'ouverture seulement |
| `lobby` produit un résultat que `ranking` refuse | Validation détaillée (`problems`), `reportFromResult` fourni pour construire le rapport à coup sûr |

## Prérequis

Aucun : Node 24+, pnpm, Vitest, Playwright et Edge sont en place ; aucune dépendance externe nouvelle (seulement les paquets du dépôt `@game/accounts` et `@game/match-rules`).
