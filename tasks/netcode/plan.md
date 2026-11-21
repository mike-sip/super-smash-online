# Plan : module `netcode`

> Statut : **VALIDÉ le 2026-11-13**. Spec : [SPEC-netcode.md](../../SPEC-netcode.md). Tâches détaillées : [todo.md](todo.md).

## Approche

**Du plus sûr au plus risqué, sans réseau d'abord.** Le cœur du module (historique des inputs, rollback, horloge, protocole, arbitrage du serveur) est de la logique pure, sans socket ni horloge réelle : il est développé par les tests, écrits avant le code, et assemblé dans un **réseau simulé** à horloge virtuelle. Ce réseau simulé permet de jouer dix minutes de partie à 8 clients en quelques secondes, avec latence, gigue, pertes, désordre et horloges qui dérivent, de façon reproductible : c'est le filet principal du module, et la preuve des trois premiers critères de succès.

Les vrais WebSocket, le navigateur et la démo ne viennent qu'ensuite, quand la logique est prouvée. Ils ne font qu'assembler.

**Le budget du rollback est mesuré tôt** : le banc bloquant arrive dès que le moteur de rollback existe (phase A), avant tout le reste, comme le demande la carte.

## Composants et dépendances

```
Paquet netcode + adaptateur sim-core
   ├─ protocole (encodage, validation)
   └─ historique des inputs ─ moteur de rollback ─ banc bloquant        ← point de contrôle A
         ├─ horloge (estimation, correction progressive)
         ├─ relais (parties, arbitrage, retards, désync), sans socket
         └─ session client
               └─ réseau simulé + bout en bout simulé (2 puis 8)        ← point de contrôle B
                     ├─ hôte WebSocket (ws) + transport + bout en bout réel
                     ├─ contrat rendu et rollback (test dans render)
                     └─ démo apps/online + deux onglets d'Edge           ← point de contrôle C
                           └─ bilan des critères                         ← point de contrôle D
```

## Phases et points de contrôle

| Phase | Tâches | Ce que vous pouvez constater à la fin |
|---|---|---|
| **A. Rollback** | T1 à T5 | Le moteur de rollback donne, sur 1 000 tirages d'arrivées désordonnées, exactement l'état d'une simulation directe ; le banc mesure le coût d'un rollback de 15 frames à 8 joueurs |
| **B. En ligne, simulé** | T6 à T9 | 2 puis 8 clients jouent dix minutes dans le réseau simulé, avec latence, gigue, pertes et horloges dérivantes, sans désync ; joueur lent, déconnecté ou onglet masqué : les autres n'attendent pas |
| **C. En ligne, réel** | T10 à T13 | Ouvrir la démo dans deux onglets ou sur deux machines du réseau local et jouer ensemble. **Votre essai est attendu ici.** |
| **D. Bilan** | T14 | Critères de succès relus et chiffrés ; module terminé |

## Séquentiel ou parallèle

- **Séquentiel** : les phases dans l'ordre. Dans la phase B, l'horloge (T6) et le relais (T7) sont indépendants l'un de l'autre ; la session client (T8) a besoin des deux.
- **Indépendant des autres modules en cours** : `fighters`, `stages-items`, `match-rules`, `accounts` et l'audio de `render` avancent sur d'autres branches. Ce module ne modifie aucun de leurs fichiers ; le seul fichier ajouté hors de `packages/netcode` et `apps/online` est un test dans `packages/render/test/`.

## Risques et parades

| Risque | Parade |
|---|---|
| Une désync qui n'apparaît qu'avec un ordre d'arrivée rare | Test de propriété sur 1 000 tirages au niveau du moteur ; bout en bout simulé de 36 000 frames comparé à une rejoue hors ligne du journal du serveur, frame par frame aux points de checksum |
| Un état hors de la simulation (comme le compteur de réapparition de `apps/demo`) rend le rollback faux | Interface `RollbackGame` : tout passe par `save`/`load` ; la réapparition de la démo en ligne est calculée depuis l'état (compteur de frames de l'action KO) ; le test de propriété l'inclut |
| Des tests réseau lents ou instables (minuteries, ports) | Horloge injectée partout ; le réseau simulé est déterministe (graine) ; les vrais WebSocket ne servent qu'à quelques tests courts sur des ports choisis par le système |
| Onglets d'arrière-plan suspendus par le navigateur pendant le test Playwright | Chaque onglet dans son propre contexte de navigation ; si Edge les suspend quand même, le test le constate et je le signale plutôt que de le masquer |
| Le rattrapage après un onglet masqué fige l'image | Rattrapage borné à 240 frames par image, sans rendu intermédiaire ; mesuré dans le bout en bout simulé |
| Le relayage immédiat multiplie les envois à 8 joueurs | Coût du relais mesuré dans le banc (messages traités par seconde pour une partie de 8) ; regroupement possible plus tard sans changer le protocole |
| `ws` garde une référence au tampon envoyé | Le serveur copie chaque message avant envoi ; contrat de `Transport.send` explicite (« `data` réutilisable au retour ») |
| Effets du rendu manqués ou joués à tort après correction | Contrat vérifié par un test dans `render` ; proportion chiffrée dans le bout en bout simulé et transmise à `render` |

## Prérequis

Ajout de la dépendance `ws` (et de ses types `@types/ws` en développement), approuvé avec la spec. Aucun autre outil à installer : Node.js 26, pnpm, Vitest, Playwright et Edge sont en place. Pour le point de contrôle C sur deux machines : le pare-feu Windows doit autoriser Node.js sur le réseau privé (Windows le demande au premier lancement).
