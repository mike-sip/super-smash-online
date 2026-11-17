# Plan : module `app-shell`

> Statut : **SOUMIS le 2026-11-17**. Spec : [SPEC-app-shell.md](../../SPEC-app-shell.md) (approuvée le 2026-11-17, décisions par défaut, nom « Fracas »). Tâches détaillées : [todo.md](todo.md).

## Approche

**L'intégration serveur d'abord.** Le branchement `lobby` → `ranking` est petit, mais c'est la seule pièce qui fait parler deux modules déjà finis ; il conditionne le dernier pas du parcours joueur (« classement mis à jour »). L'expéditeur est une logique pure à horloge et `fetch` injectés, testée seule, puis prouvée par un bout en bout réel avec les vrais serveurs, avant toute ligne d'interface.

**Puis la logique de l'application, sans DOM.** Pile d'écrans, navigation par direction, manette des menus, réglages, construction d'un match et traduction des erreurs sont des fonctions pures, écrites après leurs tests et vérifiées dans Node. Le DOM n'est qu'un affichage mince par-dessus.

**Les écrans dans l'ordre du parcours joueur** : titre et menu (on peut naviguer), combat local et options (on peut jouer seul ou à plusieurs), en ligne puis profil et classement (on peut jouer contre d'autres et voir sa cote). Chaque écran arrive avec son test dans Edge.

**La production à la fin, mais vérifiée pour de vrai.** Le parcours complet de la spec tourne sur le build de production, avec les vrais processus serveur et une passerelle locale qui reproduit les routes du frontal. Les fichiers Docker et Caddy sont écrits ensuite ; un test vérifie que la passerelle et le `Caddyfile` disent la même chose. Docker n'étant pas installé ici, la construction des images reste à faire chez vous ou sur le serveur, et c'est dit.

## Composants et dépendances

```
Expéditeur des rapports (lobby)
   └─ branchement dans le serveur de jeu + bout en bout réel lobby → classement   ← point de contrôle A
Paquet @game/app : Vite, greffon de dev (tous les serveurs en mémoire), palette
   ├─ logique pure : écrans, navigation, manette des menus
   ├─ logique pure : réglages, contenu, erreurs
   └─ écran titre, menu principal, composants, crédits                           ← point de contrôle B
         ├─ moteur de combat local (boucle, pause, fin, son, scène de fond)
         │     └─ sélection locale, stage, règles, entraînement, résultats
         └─ options : commandes, son, affichage                                  ← point de contrôle C
               └─ en ligne : connexion, accueil, bandeaux d'erreur
                     └─ salon privé, partie rapide, match en ligne, résultats
                           └─ profil, historique, classement, compte              ← point de contrôle D
                                 └─ build de production, passerelle, parcours complet dans Edge
                                       ├─ performance
                                       └─ deploy/ et DEPLOIEMENT.md               ← point de contrôle E
                                             └─ relecture de sécurité, bilan, carte ← point de contrôle F
```

## Phases et points de contrôle

| Phase | Tâches | Ce que vous pouvez constater à la fin |
|---|---|---|
| **A. Résultats classés** | T1, T2 | Dans le test réel : deux inscrits jouent une partie rapide, leurs cotes passent à 1016 et 984, l'historique se remplit, un doublon ne change rien, un salon privé n'est pas classé, une panne du serveur des comptes est rattrapée |
| **B. L'application s'ouvre** | T3 à T6 | `pnpm --filter @game/app dev` : écran titre « Fracas », menu principal navigable au clavier, à la manette et à la souris |
| **C. On joue en local** | T7 à T9 | Combat local de 2 à 4 joueurs jusqu'aux résultats, entraînement, options persistantes. **Votre essai manette en main est utile ici** |
| **D. On joue en ligne** | T10 à T12 | Deux onglets : connexion, salon privé ou partie rapide, match, résultats, profil et classement à jour |
| **E. Prêt pour la production** | T13 à T15 | Parcours complet sur le build de production dans Edge ; perf tenue ; `deploy/` et `DEPLOIEMENT.md` à relire. **Rien n'est déployé sans votre accord** |
| **F. Bilan** | T16 | Relecture de sécurité consignée, critères de succès chiffrés, carte des capacités à jour |

## Séquentiel ou parallèle

- Tout est séquentiel, dans une session : les écrans partagent les mêmes services, la même feuille de style et la même pile d'écrans, et les phases suivent le parcours joueur. Paralléliser créerait surtout des conflits.
- Seules pièces indépendantes : la phase A (paquet `lobby`) et le squelette de l'application (T3, T4). Elles sont courtes ; je les enchaîne.
- Les autres sessions sont inactives ; je ne touche à leurs modules que de façon additive (`packages/lobby` : expéditeur et configuration), consignée dans leur spec.

## Risques et parades

| Risque | Parade |
|---|---|
| Un match en ligne de test ne finit pas (égalité au temps puis mort subite sans fin, constaté par `lobby`) | Règles de test (Temps 30 s) et prise de test qui pousse un joueur hors du stage peu avant la fin, comme le test d'Edge de `lobby` |
| La partie rapide dure trop dans les tests (7 min, 20 s d'attente) | Règles et attente de la partie rapide réglables par la configuration du serveur de test seulement ; les règles de production restent celles de la spec |
| Navigation à la manette difficile à tester sans manette | Lecteur de manette des menus pur, nourri d'états simulés dans Node ; dans Edge, `navigator.getGamepads` remplacé par une fausse manette dans la page de test ; essai réel demandé au point C |
| Performance : la scène de fond et le DOM des menus coûtent des images | Mesure dans Edge dès T7 ; scène de fond coupée en « mouvements réduits » et en combat ; HUD de `render` inchangé |
| La prise de test fuit dans le build public | Activée par une variable de build ; un test lit le build de production et échoue s'il la trouve, ou une clé de développement |
| Onglets d'Edge ralentis en arrière-plan | Un contexte de navigation par joueur, comme les tests de `netcode` et `lobby` |
| Écart entre la passerelle locale et Caddy | Routes et en-têtes décrits une seule fois (`deploy/routes.ts`) ; la passerelle les lit, et un test compare le `Caddyfile` à cette description |
| Docker et TLS non vérifiables ici | Écrits avec soin, relus, et signalés comme non vérifiés dans le bilan ; `DEPLOIEMENT.md` donne les vérifications à faire après le premier lancement |
