# Carte des capacités : jeu de combat de plateforme en ligne (navigateur)

> Statut : **APPROUVÉE le 2026-11-11**. Les specs de module sont nommées `SPEC-<id du module>.md` à la racine.
>
> Specs existantes : [`sim-core`](SPEC-sim-core.md) (approuvée, implémentation en cours : phase A).

## Vision

Un jeu de combat de plateforme (« platform fighter ») jouable entièrement en ligne dans le navigateur, jusqu'à 8 joueurs par partie, à 60 fps constants, avec un ressenti nerveux et fluide (animations, enchaînements de coups). Le jeu reprend les **mécaniques du genre** popularisées par Super Smash Bros. Ultimate, avec un **univers 100 % original** : nom, personnages, décors, musiques et identité visuelle propres.

## Décisions actées

| Sujet | Décision |
|---|---|
| Rendu | 3D sur plan de jeu 2D (2.5D), WebGL |
| Réseau | Simulation déterministe + rollback, inputs relayés par un serveur (topologie en étoile) |
| Roster v1 | 4 personnages originaux (polyvalent, rapide, lourd, zoneur), définis par données |
| En ligne v1 | Salons privés par code, matchmaking rapide, comptes et classement |

## Hypothèses (à corriger maintenant si fausses)

1. **Univers original** : mécaniques similaires au jeu de référence, mais aucun personnage, décor, nom, son ou visuel repris.
2. **« Tout le set de gameplay »** signifie pour la v1 : dégâts en pourcentage et éjection hors des zones limites ; attaques normales, aériennes, smash chargées, 4 coups spéciaux par personnage ; bouclier (usure, bris, parade parfaite), esquives au sol et aériennes, roulades ; saisies, coups et projections ; saut, double saut, short hop, fast fall, dash, course ; accroche au rebord et options de remontée ; hitstun, hitlag, DI, tech au sol/mur ; objets ; attaque ultime ; modes Stock / Temps / Endurance ; chacun pour soi et équipes.
3. **Hors v1** : IA/bots, mode solo/aventure, éditeur de stages, spectateurs et replays (non retenus), mobile tactile.
4. **Cibles** : navigateurs desktop récents (Chrome, Edge, Firefox, Safari), clavier et manettes (Gamepad API).
5. **Stack** : TypeScript partout (client et serveur partagent le code de simulation), Three.js pour le rendu, Node.js pour les serveurs, WebSocket (WebTransport si disponible) pour le transport.
6. **Déterminisme** : la simulation tourne à pas fixe 60 Hz, en arithmétique à virgule fixe, sans dépendre du rendu. Les hitbox sont décrites dans les données frame par frame, jamais dérivées des os des modèles 3D.
7. **Assets 3D** : style low-poly stylisé pour tenir le budget de performance à 8 joueurs ; des modèles provisoires (placeholders) suffisent tant que le gameplay n'est pas validé.

## Modules

| Id du module | Responsabilité | Dépend de |
|---|---|---|
| `sim-core` | Simulation déterministe 60 Hz sans rendu : physique, collisions, machine à états des combattants, hitbox/hurtbox, dégâts et éjection, bouclier, saisies, rebords. Sérialisation et restauration d'état (snapshot) | — |
| `input` | Clavier et manette, remappage, tampon d'inputs, production d'un `InputFrame` par frame | `sim-core` (type `InputFrame` uniquement) |
| `fighters` | Données des 4 personnages v1 (frame data, hitbox, movesets) et outillage de validation. Le format `FighterDef` est un contrat défini par `sim-core` | `sim-core` |
| `stages-items` | Stages (plateformes, zones limites, dangers), objets et leur apparition | `sim-core` |
| `match-rules` | Modes Stock / Temps / Endurance, équipes, jusqu'à 8 joueurs, jauge d'attaque ultime, résultats de fin de match | `sim-core` |
| `render` | Rendu 3D, animations et interpolation, caméra dynamique multi-joueurs, effets visuels, HUD de combat, audio | `sim-core`, `fighters`, `stages-items` |
| `netcode` | Rollback côté client, protocole, serveur relais d'inputs, synchronisation d'horloge, détection de désynchronisation | `sim-core`, `input` |
| `accounts` | Inscription, authentification, profils | — |
| `lobby` | Salons privés par code, matchmaking rapide par région, sélection personnage/stage/règles | `netcode`, `match-rules`, `accounts` |
| `ranking` | Classement (ELO adapté au multijoueur), historique des matchs | `accounts`, `match-rules` |
| `app-shell` | Menus, navigation, options, assemblage et déploiement | tous |

## Ordre de construction

```
sim-core, input
   → fighters (1 personnage d'abord), render      ← jalon 1 : combat local jouable à 60 fps
   → netcode                                       ← jalon 2 : 2 puis 8 joueurs en ligne, sans désync
   → stages-items, match-rules, fighters (les 3 autres)   ← jalon 3 : gameplay complet
   → accounts → lobby, ranking
   → app-shell                                     ← jalon 4 : v1 publique
```

Le netcode arrive tôt, volontairement : le rollback impose des contraintes fortes à la simulation (déterminisme, snapshots rapides). Les découvrir après avoir écrit tout le gameplay coûterait très cher.

## Risques principaux

| Risque | Parade |
|---|---|
| Rollback à 8 joueurs : la re-simulation de plusieurs frames doit tenir dans 16,6 ms | Budget mesuré dès `sim-core` : un pas de simulation à 8 joueurs en moins de 1 ms, snapshot en moins de 0,1 ms |
| Désynchronisations entre navigateurs | Virgule fixe, aucune fonction flottante non déterministe, checksum d'état échangé régulièrement, tests de déterminisme automatisés |
| 2.5D : coût des assets et du rendu à 8 personnages | Low-poly, skinning GPU, budget de draw calls, placeholders jusqu'à validation du gameplay |
| Ampleur du contenu (4 movesets complets, équilibrage) | Moteur piloté par données, un personnage de référence terminé avant de lancer les trois autres |

## Questions ouvertes

1. Hébergement et régions visés (Europe seule au départ ?) et budget serveur.
2. Objets et attaque ultime : dans la v1, ou reportés après le jalon 3 ?
3. Provenance des assets 3D finaux (création maison, artiste, packs sous licence) ?
4. Méthode de connexion des comptes (email + mot de passe, OAuth Google/Discord, compte invité) ?
