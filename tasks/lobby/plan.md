# Plan : module `lobby`

> Statut : **VALIDÉ le 2026-11-15**. Spec : [SPEC-lobby.md](../../SPEC-lobby.md). Tâches détaillées : [todo.md](todo.md).

## Approche

**Le relais d'abord, parce que c'est le plus risqué.** Deux changements touchent un module déjà fini et validé : le mode réservé (authentification) et surtout la reconnexion en pleine partie, qui fait rattraper à un client plusieurs minutes de jeu sans désynchroniser personne. Ils sont faits en premier, dans `netcode`, prouvés par son réseau simulé à horloge virtuelle, avant d'écrire une ligne de lobby. Si la reconnexion se révélait irréalisable telle que prévue, on le saurait avant d'avoir bâti dessus.

**Puis la logique pure, sans réseau.** Codes, limites, règles d'un salon, file d'attente, concordance des résultats et validation des messages sont des fonctions sans socket ni horloge réelle, écrites après leurs tests. Le service du lobby les assemble derrière des connexions abstraites, comme le relais : il se teste avec des connexions factices et une horloge virtuelle.

**Le bout en bout simulé est le filet principal.** Tickets signés par la vraie fonction de `accounts`, lobby, relais réservé et clients complets (client du lobby, client `netcode`, simulation `match-rules`) tournent dans un même processus, sur le réseau simulé de `netcode`. Des matchs entiers, reconnexions comprises, s'y jouent en quelques secondes, de façon reproductible.

**Le réel ne fait qu'assembler** : hôte `ws`, serveur complet, vrai serveur des comptes, puis la démo en ligne et Edge.

## Composants et dépendances

```
Relais : mode réservé (authenticate, reserve, cancel, événements)
   └─ Relais + client : reconnexion en pleine partie (historique complet, REJOINED)   ← point de contrôle A
Paquet lobby : protocole et validation, codes
   ├─ limites (seaux, jti, adresses)
   ├─ règles d'un salon
   ├─ file d'attente
   └─ concordance des résultats, enregistrement                                       ← point de contrôle B
         └─ service : identité, connexions, salons, grâce, hôte
               └─ service : lancement, partie, fin, partie rapide
                     └─ client du lobby
                           └─ bout en bout simulé (2 à 8 clients, reconnexions)        ← point de contrôle C
                                 ├─ hôte ws, serveur complet, admission, bout en bout réel
                                 └─ démo apps/online + trois onglets d'Edge            ← point de contrôle D
                                       └─ relecture de sécurité, bilan                 ← point de contrôle E
```

## Phases et points de contrôle

| Phase | Tâches | Ce que vous pouvez constater à la fin |
|---|---|---|
| **A. Relais authentifié** | T1, T2 | Dans les tests de `netcode` : connexions sans ticket ou sans place refusées, places imposées ; un joueur coupé en pleine partie revient, rattrape et finit avec les mêmes empreintes ; tous les tests existants de `netcode` passent inchangés |
| **B. Règles** | T3 à T7 | Chaque règle de la spec (salon, file, concordance, limites, codes, messages) couverte par un test |
| **C. Service, simulé** | T8 à T11 | Des matchs complets en salon privé et en partie rapide, de 2 à 8 joueurs, avec reconnexions, hôte parti, joueur qui ne rejoint pas, jusqu'au retour au salon et à `onMatchResult` |
| **D. Réel** | T12, T13 | Ouvrir la démo en ligne dans plusieurs onglets ou sur deux machines et faire tout le parcours. **Votre essai est attendu ici.** |
| **E. Bilan** | T14 | Relecture de sécurité consignée ; critères de succès relus et chiffrés ; module terminé |

## Séquentiel ou parallèle

- **Séquentiel** : les phases dans l'ordre. Dans la phase B, T4, T5, T6 et T7 ne dépendent que de T3 et pas les unes des autres ; elles restent petites et je les enchaîne. Dans la phase D, T12 (serveur réel) et T13 (démo) partagent l'hôte ; T13 vient après.
- **Autres sessions** : `ranking` étend le serveur des comptes en parallèle ; je n'en touche aucun fichier, je n'importe que `@game/accounts/ticket` (et le serveur des comptes dans les tests et le greffon de la démo, par son API publique). `fighters` et `stages-items` ne sont pas fusionnés : la démo garde le contenu de test de `sim-core` derrière un registre d'identifiants (un seul fichier à compléter à leur fusion).
- **Fichiers de `netcode` modifiés** : `relay.ts`, `protocol.ts`, `client.ts`, peut-être `rollback.ts`/`timeline.ts` pour le rattrapage. Les écarts sont consignés dans `SPEC-netcode.md` (section « Écarts »), pas dans la ligne « Specs existantes » de la carte.

## Risques et parades

| Risque | Parade |
|---|---|
| Le rattrapage d'un revenant est trop lent : l'anneau d'inputs du client (128 frames) borne ce qu'il accepte, et le relais ne renvoie qu'après 100 ms d'accusé immobile | Le relais envoie à un client en retard une fenêtre bornée à partir de son accusé à chaque pas (au lieu d'attendre le renvoi) ; débit mesuré dans le bout en bout simulé (critère : 5 min de jeu rattrapées en moins de 20 s) ; si insuffisant, je vous le signale avant d'aller plus loin (point de contrôle A) |
| La reconnexion casse le rollback ou la détection de désync (index de client, empreintes attendues d'un client parti) | Le revenant reprend l'index de son ancien client ; test de propriété : empreintes de tous égales à la rejoue hors ligne du journal du relais, avec un ou plusieurs revenants |
| Modifier `netcode` le fait régresser | Tous ses tests existants (unitaires, propriété, bout en bout simulé, réel, Edge) passent inchangés à chaque tâche ; sans `authenticate`, aucun chemin nouveau n'est emprunté |
| Fin de match détectée sur un état prédit, donc différente d'un client à l'autre | Le client attend que toutes les frames jusqu'à la fin soient confirmées avant de déclarer ; testé avec latence et gigue dans le bout en bout simulé |
| Mémoire du relais : historique complet de chaque partie | Blocs de 4 096 frames libérés à la fermeture ; durée maximale d'une partie bornée par le lobby (temps limite ou 30 min, plus 5 min) ; mesuré |
| Courses entre lobby et relais (un joueur arrive au relais avant la réservation, ou après l'annulation) | Réservation créée avant l'envoi de `matchStart` ; annulation qui ferme les connexions ; un test par ordre d'arrivée |
| Onglets d'Edge suspendus en arrière-plan pendant le test | Un contexte de navigation par onglet, comme le test de `netcode` ; si Edge les suspend quand même, je le constate et le signale |
| Un test Edge long (match de 30 s, trois onglets) instable | Match en mode Temps de 30 s (durée connue) ; attentes sur des états exposés par une prise de test, jamais sur des délais fixes |

## Prérequis

Dépendance `ws` dans `@game/lobby`, approuvée avec la spec (même version que `netcode`, `@types/ws` en développement). Rien à installer : Node.js, pnpm, Vitest, Playwright et Edge sont en place.
