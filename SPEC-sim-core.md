# Spec : `sim-core` — simulation déterministe du combat

> Statut : **APPROUVÉE le 2026-11-11, implémentée** (bilan en fin de document ; un critère reste partiellement vérifié). Plan : [tasks/plan.md](tasks/plan.md), tâches : [tasks/todo.md](tasks/todo.md). Module de la [carte des capacités](CAPABILITY-MAP.md). Dépend de : rien.

## Hypothèses

1. `sim-core` est une bibliothèque TypeScript pure : aucun accès au DOM, au réseau, à l'horloge ou au rendu. Elle tourne à l'identique dans le navigateur et dans Node.js (serveur relais, tests).
2. Le déterminisme repose sur des **entiers à virgule fixe**, pas sur une bibliothèque externe : les opérations `+ - * /` et `Math.trunc` sur des entiers représentables sont exactes et identiques dans tous les moteurs JavaScript. Les fonctions flottantes non garanties (`Math.sin`, `Math.cos`, `Math.atan2`, `Math.pow`, `Math.random`) sont interdites dans le module.
3. Tout l'état de simulation tient dans **un seul `ArrayBuffer`** de taille fixe. Sauvegarder ou restaurer un état est une simple copie mémoire : c'est ce qui rend le rollback à 8 joueurs abordable.
4. `sim-core` fournit le **moteur** des mécaniques ; le **contenu** (les 4 personnages, les stages, les objets, les modes de jeu) vient des modules `fighters`, `stages-items` et `match-rules`. Pour se tester seul, `sim-core` embarque un combattant et un stage de test minimalistes.
5. Les contrats `InputFrame`, `FighterDef` et `StageDef` sont définis ici, car `sim-core` est le module qui les consomme. La carte a été ajustée en conséquence (`input` dépend désormais du type `InputFrame`).
6. Aucun runtime JavaScript n'est installé sur la machine actuellement : Node.js et pnpm sont un prérequis à installer avant l'implémentation.

## Objectif

Fournir le cœur de jeu : une fonction `step` qui fait avancer d'une frame (1/60 s) l'état complet d'un combat jusqu'à 8 joueurs, à partir des inputs de chaque joueur, de façon strictement reproductible.

**Consommateurs** : `render` lit l'état pour l'afficher ; `netcode` sauvegarde, restaure et re-simule ; `fighters`, `stages-items` et `match-rules` fournissent données et règles.

**Succès** : deux machines différentes qui rejouent la même séquence d'inputs obtiennent le même état au bit près, et la simulation est assez rapide pour re-simuler 8 frames à 8 joueurs sans faire chuter le jeu sous 60 fps.

### Périmètre fonctionnel

| Domaine | Inclus dans `sim-core` |
|---|---|
| Déplacement | Marche, dash, course, demi-tour, accroupi ; saut, short hop, double saut, fast fall ; dérive aérienne ; traversée des plateformes fines |
| Collisions décor | Sols, murs, plafonds, plateformes traversables, zones limites (éjection = KO) |
| Machine à états | États du combattant pilotés par les données (durées, annulations, transitions), tampon d'inputs de 6 frames |
| Attaques | Hitbox et hurtbox par frame (cercles et capsules), priorités, coups multiples, attaques chargées |
| Dégâts et éjection | Pourcentage, formule d'éjection (dégâts, poids, base, croissance, angle), hitlag, hitstun, influence directionnelle (DI), tech au sol et au mur, rebond |
| Défense | Bouclier (usure, régénération, bris, étourdissement), parade parfaite, esquive sur place, roulades, esquive aérienne, invincibilité par frames |
| Saisies | Saisie, coups pendant la saisie, 4 projections, dégagement |
| Rebords | Accroche, invincibilité limitée, options de remontée (montée, roulade, attaque, saut, lâcher) |
| Entités | Système générique d'entités (projectiles, objets) : mouvement, hitbox, durée de vie. Le contenu vient d'autres modules |
| Infrastructure | Générateur aléatoire déterministe dans l'état, file d'événements par frame (coup porté, KO, son à jouer), snapshot, checksum |

**Hors périmètre** : contenu des personnages et stages réels, règles de match (stocks, temps, équipes), rendu, audio, réseau, lecture clavier/manette.

## Stack technique

| Élément | Choix |
|---|---|
| Langage | TypeScript 5.x, mode `strict`, cible ES2022, modules ES |
| Runtime | Node.js LTS courant (≥ 24, 26 installé) pour les tests et l'outillage |
| Compilateur | TypeScript 7 dans le paquet ; TypeScript 6 à la racine, uniquement pour ESLint (typescript-eslint ne gère pas encore la 7) |
| Gestionnaire de paquets | pnpm, monorepo en workspaces (un paquet par module de la carte) |
| Tests | Vitest ; Playwright pour les tests de déterminisme inter-navigateurs |
| Qualité | ESLint + Prettier |
| Dépendances d'exécution | **Aucune** |

## Commandes

```
Installer :       pnpm install
Tests :           pnpm --filter @game/sim-core test
Couverture :      pnpm --filter @game/sim-core test -- --coverage
Déterminisme :    pnpm --filter @game/sim-core test:determinism
Benchmark :       pnpm --filter @game/sim-core bench
Types :           pnpm --filter @game/sim-core typecheck
Lint :            pnpm lint --fix
Build :           pnpm --filter @game/sim-core build
```

## Structure du projet

```
CAPABILITY-MAP.md            → Carte des modules (index des specs)
SPEC-<module>.md             → Une spec par module
packages/
  sim-core/
    src/
      index.ts               → API publique (seul point d'entrée)
      fixed.ts               → Arithmétique à virgule fixe, tables trigonométriques
      state.ts               → Disposition mémoire de l'état, snapshot, checksum
      input.ts               → Type InputFrame et décodage
      defs.ts                → Contrats FighterDef, StageDef, MoveDef
      step.ts                → Pipeline d'une frame
      systems/               → Un fichier par système (movement, collision, hit, shield, grab, ledge, entities)
      testing/               → Combattant et stage de test
    test/                    → Tests unitaires et scénarios
    test/determinism/        → Séquences d'inputs de référence et checksums attendus
    bench/                   → Mesures de performance
```

## API publique (contrat)

```ts
/** Un input par joueur et par frame : stick X/Y sur 8 bits signés, 16 boutons. */
export type InputFrame = number; // uint32

export interface SimConfig {
  readonly stage: StageDef;
  readonly fighters: readonly FighterDef[]; // 2 à 8, un par joueur
  readonly seed: number;
}

export function createSim(config: SimConfig): Sim;

/** Ajoutés pendant l'implémentation : */
export function respawn(sim: Sim, player: number): void;
export function spawnEntity(sim: Sim, kind: number, owner: number, x: number, y: number, velX: number, velY: number): number;
export function frame(sim: Sim): number;

/** Avance d'une frame. `inputs[i]` est l'input du joueur i. N'alloue aucune mémoire. */
export function step(sim: Sim, inputs: Uint32Array): void;

export function saveState(sim: Sim, out: Uint8Array): void;
export function loadState(sim: Sim, from: Uint8Array): void;
export function checksum(sim: Sim): number;

/** Vues en lecture seule pour le rendu, et événements émis pendant la dernière frame. */
export function readFighter(sim: Sim, player: number, out: FighterView): void;
export function events(sim: Sim): EventQueue;
```

Toute modification de cette surface après validation passe par une mise à jour de cette spec.

## Style de code

```ts
// Virgule fixe Q20.12 : 1 unité de jeu = 4096. Type nominal pour éviter les mélanges.
// Les données (FighterDef…) exigent des Fx ; les helpers acceptent des number, car l'état
// est stocké en Int32Array et en ressort sans marque.
declare const fxBrand: unique symbol;
export type Fx = number & { readonly [fxBrand]: true };
export const FX_ONE = 4096 as Fx;

export const fxMul = (a: number, b: number): Fx => (Math.trunc((a * b) / FX_ONE) + 0) as Fx;

// Un système = une fonction pure sur l'état, sans allocation, sans closure.
export function applyGravity(s: SimState, def: FighterDef, i: number): void {
  if (s.grounded[i] === 1) return;
  const fall = s.fastFall[i] === 1 ? def.fastFallSpeed : def.maxFallSpeed;
  s.velY[i] = Math.max(s.velY[i] - def.gravity, -fall);
}
```

Conventions :
- État en **tableaux typés par champ** (`s.velY[i]`), indexés par joueur ou entité ; jamais d'objets créés pendant `step`.
- Fonctions nommées en `camelCase`, types en `PascalCase`, constantes en `SCREAMING_SNAKE_CASE`.
- Toute grandeur physique est un `Fx` ; toute durée est un nombre entier de frames.
- Ordre de traitement des joueurs toujours croissant par index ; aucune itération sur `Map`, `Set` ou clés d'objet dans `step`.
- Pas de classes, pas d'exceptions dans le chemin de `step`.

## Stratégie de test

| Niveau | Quoi | Où |
|---|---|---|
| Unitaire | Virgule fixe, formule d'éjection, chaque système isolé | `test/*.test.ts` |
| Scénario | Séquences d'inputs scriptées vérifiant une mécanique complète (ex. : bouclier brisé après N coups, accroche au rebord, DI qui modifie la trajectoire) | `test/scenarios/` |
| Propriété | Sauvegarde puis restauration : `step×N → save → step×M → load → step×M` donne le même checksum, sur inputs aléatoires | `test/rollback.test.ts` |
| Déterminisme | Séquences de 36 000 frames (10 minutes) à 8 joueurs ; checksums comparés à une référence versionnée, dans Node, Chromium, Firefox et WebKit | `test/determinism/` |
| Performance | Benchmarks avec seuils qui font échouer la CI | `bench/` |

Développement piloté par les tests : chaque mécanique commence par un scénario qui échoue. Couverture visée : 90 % des lignes sur `src/` hors `testing/`.

## Limites

- **Toujours** : faire passer tests, déterminisme et typecheck avant chaque commit ; écrire le scénario avant la mécanique ; mettre à jour les checksums de référence dans un commit dédié et expliqué quand un changement de comportement est voulu.
- **Demander d'abord** : ajouter une dépendance ; modifier l'API publique ou la disposition mémoire de l'état ; changer une valeur de la formule d'éjection ; relever un seuil de performance.
- **Jamais** : utiliser `Math.random`, `Date`, `performance.now` ou une fonction trigonométrique native dans `src/` ; allouer dans `step` ; importer un autre module de la carte ; supprimer ou désactiver un test de déterminisme qui échoue.

## Critères de succès

1. **Déterminisme** : pour 5 séquences de référence de 36 000 frames à 8 joueurs, le checksum final est identique dans Node, Chromium, Firefox et WebKit.
2. **Rollback** : le test de propriété sauvegarde/restauration passe sur 1 000 tirages aléatoires.
3. **Vitesse** : à 8 joueurs avec 16 entités actives, un `step` coûte moins de 0,25 ms en moyenne et moins de 1 ms au 99ᵉ centile ; `saveState` et `loadState` coûtent moins de 0,05 ms chacun. Mesuré dans Node sur la machine de développement.
4. **Mémoire** : l'état complet pèse moins de 64 Ko, et `step` n'alloue rien de façon systématique : le tas grandit de moins de 32 Ko sur 10 000 frames en régime établi, harnais de mesure compris (voir « Écarts et limites constatés »).
5. **Mécaniques** : chaque ligne du tableau « Périmètre fonctionnel » est couverte par au moins un scénario qui passe.
6. **Isolation** : le paquet n'a aucune dépendance d'exécution, et une règle de lint interdit les API non déterministes listées plus haut.
7. **Jouabilité** : une page de démonstration minimale (formes géométriques, hors de ce module) permettra de piloter le combattant de test au clavier au jalon 1 ; ce critère est vérifié avec le module `render`.

## Questions ouvertes

1. **Installation de Node.js et pnpm** : je peux les installer via `winget` à votre demande, ou vous préférez le faire vous-même ?

## Décisions prises à la validation

- **Valeurs de gameplay** (gravité, vitesses, formule d'éjection) : valeurs propres au jeu, réglées pour un ressenti proche du genre, puis ajustées à la main au jalon 1.
- **Tampon d'inputs** : 6 frames par défaut, réglable plus tard dans les options.

## Écarts et limites constatés pendant l'implémentation

Mis à jour à chaque phase. Chaque point est soit une simplification assumée, soit une décision en attente.

| Sujet | État actuel | Suite prévue |
|---|---|---|
| Hurtbox | Définies par combattant (`FighterDef.hurtboxes`), fixes pendant toutes les actions. La spec disait « par frame ». | À rendre variables par action si un personnage réel en a besoin (module `fighters`). |
| Priorité entre hitbox | Ordre de la liste dans `MoveDef.hits`. Deux attaques qui se croisent ne s'annulent pas (pas de « clank »). | À décider avec le ressenti manette en main. |
| Influence directionnelle | Déviation en degrés entiers, 15° au maximum. | Résolution à affiner si le ressenti est trop saccadé. |
| Rétablissement | Fenêtre de 20 frames après l'appui sur bouclier ; elle ne peut pas être rouverte avant 40 frames. En chute désordonnée, le bouton bouclier est réservé au rétablissement : il faut en sortir pour esquiver. | — |
| Bouclier | Protège tout le corps tant qu'il lui reste de la résistance : il ne rétrécit pas, donc pas de coups qui passent sur les bords. | À décider avec le ressenti manette en main. |
| Parade parfaite | Coup reçu dans les 5 premières frames de l'abaissement du bouclier. | — |
| Esquives | Usure commune aux trois esquives : +3 frames de lag et −2 frames d'intangibilité par niveau, un niveau récupéré toutes les 90 frames. | Valeurs à régler. |
| Saisies | Deux saisies mutuelles s'annulent. Deux joueurs sur la même victime : le plus proche gagne, puis le plus petit index à distance égale. | — |
| Rebords | Un seul occupant ; si deux joueurs l'atteignent à la même frame, le plus petit index l'obtient. Pas de vol de rebord. Les remontées téléportent le combattant à la fin de l'action : le mouvement intermédiaire est laissé au rendu. | Vol de rebord à décider. |
| Entités | Seuls les blocs pleins les arrêtent, pas les plateformes. Elles ne peuvent être ni ramassées ni renvoyées. | Ramassage et lancer : module `stages-items`. |
| Spéciaux | Un spécial est une attaque comme une autre, plus la création éventuelle d'une entité. Pas encore d'élan propre (spécial de retour au stage). | À ajouter avec le module `fighters`. |
| Limite haute | Ne tue qu'un combattant en hitstun ou en chute désordonnée. | — |
| Réapparition | Instantanée sur le point d'apparition, sans invincibilité. | Module `match-rules`. |
| Corps des combattants | Ils se traversent : pas de poussée entre deux combattants au sol. | Hors périmètre, à décider. |
| Résultats de `fxMul` et `fxDiv` | Toujours ramenés à un entier 32 bits. | — |
| Allocations dans `step` | Aucune en régime établi. Le benchmark mesure environ 15 Ko sur 10 000 frames, dus pour l'essentiel à son propre harnais. Historique : le seuil a été relevé de 16 à 64 Ko en phase C sur une explication erronée (chemins rares non compilés) ; la vraie cause, une fonction de bornage qui renvoyait un nombre non entier, a été trouvée et supprimée en phase E. | Seuil resserré à 32 Ko. Règle d'écriture consignée en tête de `geometry.ts` : aucun nombre non entier ne traverse un appel de fonction. |
| Déterminisme navigateur | Cinq séquences de référence de 36 000 frames à 8 joueurs, checksums versionnés dans `test/determinism/golden.json`. Vérifié dans Node et Edge (moteur V8) et dans WebKit (JavaScriptCore). **Firefox (SpiderMonkey) non vérifié** : la version fournie par Playwright ne démarre pas sur la machine de développement (erreur Windows « configuration côte-à-côte », bibliothèque `mozglue` refusée). | À vérifier sur une autre machine ou en intégration continue. `SIM_BROWSERS=chromium,webkit` restreint la liste ; le test Firefox apparaît alors comme ignoré. |
| Dépendances de développement ajoutées | `playwright-core` et `vite` (empaquetage du test navigateur). Aucune dépendance d'exécution. | — |

## Bilan des critères de succès (2026-11-11)

| N° | Critère | État | Mesure |
|---|---|---|---|
| 1 | Déterminisme sur 5 séquences de 36 000 frames à 8 joueurs | **Partiel** | Checksums identiques dans Node, Chromium (Edge) et WebKit. Firefox non vérifié : il ne démarre pas sur la machine de développement. |
| 2 | Propriété de rollback sur 1 000 tirages | Atteint | `test/rollback.test.ts` |
| 3 | Vitesse à 8 joueurs et 16 entités | Atteint | `step` : 0,005 ms en moyenne, 0,008 ms au 99ᵉ centile ; snapshot : 0,00003 ms |
| 4 | Mémoire | Atteint | État de 2 764 octets ; tas +15 Ko sur 10 000 frames, harnais compris (seuil 32 Ko) |
| 5 | Un scénario par mécanique du périmètre | Atteint | 311 tests, 99,6 % des lignes couvertes |
| 6 | Aucune dépendance d'exécution, lint anti-non-déterminisme | Atteint | `dependencies` vide ; règle ESLint vérifiée par fichier témoin |
| 7 | Jouabilité manette en main | Non vérifiable ici | Dépend du module `render` |

Commandes ajoutées pendant l'implémentation :

```
Couverture :          pnpm --filter @game/sim-core coverage
Checksums de réf. :   pnpm --filter @game/sim-core golden:update
Navigateurs :         pnpm --filter @game/sim-core exec playwright-core install firefox webkit
Sans Firefox :        SIM_BROWSERS=chromium,webkit pnpm --filter @game/sim-core test
```
