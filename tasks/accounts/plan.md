# Plan : module `accounts`

> Statut : **PROPOSÉ le 2026-11-13**, en attente de validation. Spec : [SPEC-accounts.md](../../SPEC-accounts.md). Tâches détaillées : [todo.md](todo.md).

## Approche

**Du plus sûr au plus exposé.** Les règles qui portent la sécurité (pseudos, mots de passe, hachage, jetons, tickets, limitation) sont des fonctions pures, écrites d'abord et entièrement couvertes par des tests posés avant le code. Viennent ensuite le stockage et les règles métier, testés sans réseau avec une horloge factice ; puis le serveur HTTP, mince, vérifié de bout en bout par de vraies requêtes ; enfin le client et le panneau de la démo.

La **suite de contrat du stockage** est écrite une fois et jouée sur les deux implémentations (mémoire et SQLite) : c'est la preuve qu'on pourra changer de stockage. Les **tests d'API de bout en bout** sont le filet principal : chaque parcours de la spec et chaque protection y a son test, sur un vrai serveur HTTP ouvert sur un port libre.

La démo n'est touchée qu'en phase D, et ne contacte le serveur des comptes qu'à l'ouverture du panneau : ses tests existants ne voient aucune différence.

## Composants et dépendances

```
Paquet @game/accounts + protocole, pseudos, mots de passe
   ├─ hachage scrypt, jetons de session, tickets
   └─ limitation des tentatives                        ← point de contrôle A : règles prouvées
        └─ interface de stockage + mémoire + suite de contrat
             └─ stockage SQLite et migrations
                  └─ règles métier (service)            ← point de contrôle B : métier prouvé sans réseau
                       └─ serveur HTTP, configuration, point d'entrée
                            └─ protections HTTP et commandes dev/start   ← point de contrôle C : serveur lançable
                                 ├─ client @game/accounts-client
                                 └─ panneau Compte de la démo            ← point de contrôle D : utilisable dans la démo
                                      └─ relecture de sécurité et bilan  ← point de contrôle E : module terminé
```

## Phases et points de contrôle

| Phase | Tâches | Ce que vous pouvez faire à la fin |
|---|---|---|
| **A. Règles** | T1 à T3 | Lire les tests des règles de pseudo, de mot de passe, du hachage et des tickets ; compléter la liste des mots interdits |
| **B. Métier** | T4 à T6 | Constater que la suite de contrat passe sur les deux stockages et que chaque parcours (invité, conversion, connexion, suppression…) est couvert sans réseau |
| **C. Serveur** | T7 à T8 | Lancer `pnpm --filter @game/accounts dev` et interroger l'API (curl, navigateur) ; tous les tests de bout en bout passent |
| **D. Démo** | T9 à T10 | Jouer en invité, créer un compte, vous déconnecter et vous reconnecter depuis le panneau Compte de la démo |
| **E. Relu** | T11 | Lire la relecture de sécurité et le bilan des critères de succès ; module terminé |

## Séquentiel ou parallèle

- **Séquentiel** : les phases dans l'ordre ; chacune s'appuie sur la précédente.
- **Indépendant de ce module** : le relais de `netcode` peut prévoir dès maintenant un champ « ticket » dans son message d'arrivée (note laissée dans le dossier partagé) ; il ne branchera `verifyTicket` qu'après la fusion de ce module.

## Risques et parades

| Risque | Parade |
|---|---|
| `node:sqlite` est encore marqué expérimental dans certaines versions de Node | Vérifié dès la spec sous Node 26 et Vitest ; caché derrière l'interface `AccountStore`, avec une implémentation mémoire de secours qui passe la même suite |
| Le hachage de production rend les tests lents | Paramètres réduits dans les tests ; un test dédié vérifie que la configuration par défaut est celle de production |
| Deux requêtes simultanées créent le même pseudo | Unicité garantie par la base (index unique sur la clé), pas seulement par une vérification préalable ; test de concurrence |
| Le relais de `netcode` attend un autre format de ticket | Fonction de vérification autonome et documentée, note laissée à la session `netcode` ; le format est versionné (`v1.`) |
| Erreurs 4xx affichées dans la console du navigateur, qui feraient échouer les tests de fumée de la démo | `GET /session` répond 200 même sans session ; la démo n'appelle le serveur qu'à l'ouverture du panneau ; les tests du panneau filtrent les erreurs attendues |
| Cookie `Secure` refusé en développement sur `http` | Option `secureCookies`, désactivée par la commande `dev` seulement ; nom `__Host-` réservé à la production |
| Limitation en mémoire perdue au redémarrage | Accepté pour un seul processus ; interface prête pour un stockage partagé |
| Une faille passe malgré les tests | Relecture de sécurité dédiée en T11, constats corrigés ou expliqués dans la spec |

## Prérequis

Aucun outil à installer : Node.js 24+, pnpm, Vitest, Playwright et Edge sont en place. Aucune dépendance externe nouvelle : `@types/node`, Vitest et TypeScript sont déjà dans le dépôt.
