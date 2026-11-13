# Spec : `stages-items` — stages et objets de la v1

> Statut : **APPROUVÉE le 2026-11-13**. Plan : [tasks/stages-items/plan.md](tasks/stages-items/plan.md), tâches : [tasks/stages-items/todo.md](tasks/stages-items/todo.md). Module de la [carte des capacités](CAPABILITY-MAP.md). Dépend de : `sim-core` (implémenté). Consommé par : `render`, `match-rules`, `netcode` (indirectement, par l'état de `sim-core`), `app-shell`.

## Hypothèses

1. **Moteur dans `sim-core`, contenu ici.** C'est la règle posée par la spec de `sim-core` : le mécanisme (plateforme qui bouge, objet qu'on ramasse, tirage d'une apparition) doit tourner dans `step`, sinon le `netcode` devrait l'appeler à part et le rollback deviendrait fragile. Ce module fournit les **données** (4 stages, 5 objets, tables d'apparition) et les fonctions qui les assemblent en `SimConfig`. Les mécanismes manquants sont ajoutés à `sim-core` sous forme d'**extension additive**, détaillée plus bas et soumise à votre accord.
2. **Tout ce qui influe sur le combat est déterministe et dans l'état.** Position d'une plateforme mobile et déclenchement d'un danger : fonctions pures du numéro de frame, qui est déjà dans l'état. Apparition des objets : compteur dans l'état et générateur à graine de `sim-core` (`G_RNG`, inutilisé jusqu'ici). Objets tenus, lancés, posés : champs d'entité dans l'état. Aucun calcul flottant, aucune table hors de l'état qui évoluerait pendant le combat.
3. **Décors dans `render`.** Les décors low-poly procéduraux sont du code d'affichage : ils vivent dans de nouveaux fichiers de `render` (`src/stages/`), choisis d'après l'identifiant du stage. La carte fait déjà dépendre `render` de `stages-items` : `render` importera les identifiants de stages et d'objets de ce paquet.
4. **Les règles de match ne sont pas écrites ici.** Le module expose une configuration simple (`ItemSettings` : fréquence et objets autorisés ; dangers activés ou non) et une fonction qui l'applique à un `SimConfig`. Le module `match-rules` décidera quand et comment l'exposer au joueur.
5. **Combattants de test.** Les personnages réels arrivent en parallèle (module `fighters`). Stages et objets sont calibrés et testés avec le combattant de test de `sim-core` (12 unités de haut, saut d'environ 35 unités) et le lourd (18 unités) ; leurs dimensions seront revues quand les vrais personnages seront fusionnés.
6. **Univers 100 % original.** Noms, thèmes, formes et couleurs inventés pour ce jeu ; aucune disposition de stage ni aucun objet repris tel quel d'un jeu existant. Les conventions du genre (stage plat, stage à trois plateformes, objet à lancer, objet de soin) sont des mécaniques, pas des reprises.

## Objectif

Donner à la v1 ses terrains de combat et ses objets : un choix de stages aux styles de jeu différents, et des objets qui apparaissent pendant le combat, se ramassent, se lancent, frappent ou soignent — le tout rejouable au bit près par le rollback.

**Succès** : dans la démo, on choisit l'un des 4 stages et on active les objets ; on joue sur un décor reconnaissable, on ramasse, lance et utilise chaque objet ; deux simulations rejouant les mêmes inputs restent identiques, sauvegarde et restauration comprises ; la démo tient le budget de performance de `render` sur chaque stage, objets activés.

## Contenu

### Stages : 4

Dimensions en unités de jeu (le combattant de test mesure 12 de haut ; le stage de test de `sim-core` fait 120 de large).

| Id | Nom | Style de jeu | Géométrie | Thème du décor |
|---|---|---|---|---|
| `belvedere` | **Belvédère des Brumes** | Référence, équilibré | Bloc principal de 140 ; deux plateformes latérales à 22 de haut ; une plateforme centrale à 44 | Terrasse de grès sculpté suspendue au-dessus d'une mer de nuages, rochers flottants au loin, soleil bas orangé |
| `recif` | **Récif Nocturne** | Plat, sans plateforme : duel au sol, pas d'échappatoire | Bloc unique de 170, flancs inclinés vers l'intérieur sous le niveau du sol (rebords francs) | Dalle de basalte vert au milieu d'un lagon de nuit, coraux luminescents, lune en croissant |
| `canal` | **Canal des Lanternes** | Plateformes mobiles : le terrain change de forme | Bloc principal de 150 ; une barge qui traverse le stage de gauche à droite à 24 de haut (période 8 s) ; deux nacelles qui montent et descendent sur les côtés, en opposition (période 6 s) | Quai de pierre d'une cité fluviale au crépuscule, eau sombre, lanternes suspendues, façades en silhouette |
| `geysers` | **Bassin des Geysers** | Danger périodique : il faut lire le terrain | Bloc principal de 150 ; deux plateformes basses à 20 de haut ; deux évents au sol qui jaillissent à tour de rôle | Terrasses minérales ocre et turquoise, vapeur, cristaux ; l'évent bouillonne avant de jaillir |

Plateformes mobiles : uniquement des plateformes fines (traversables), qui portent les combattants et les objets posés dessus. Pas de blocs pleins mobiles : un bloc qui bouge déplace ses rebords et peut écraser un combattant, ce qui demanderait des règles de plus pour peu de gain.

Danger du Bassin des Geysers : chaque évent jaillit toutes les 12 s (les deux sont décalés de 6 s). Le bouillonnement annonce le jet 90 frames (1,5 s) à l'avance ; le jet dure 50 frames, frappe chaque combattant une fois, 14 % vers le haut avec une forte éjection (KO vers 110 % sur le combattant de test). Le bouclier le bloque, comme un coup. Les dangers se désactivent (`hazards: false`) : les évents restent alors un simple décor.

Chaque stage a 8 points d'apparition sur des surfaces fixes, et des zones d'apparition d'objets (segments au-dessus du sol d'où les objets tombent).

### Objets : 5

| Objet | Catégorie | Utilisation | Effet | Poids d'apparition |
|---|---|---|---|---|
| **Galet** | À lancer | Ramassé, puis lancé | 8 %, faible éjection ; se brise sur le combattant touché ; s'il ne touche personne, il retombe et se ramasse à nouveau | 30 |
| **Bâton** | À frapper | Tenu, il remplace les attaques par un coup ample | Coup : 12 %, éjection moyenne, plus de portée que les attaques de base. Lancé : 9 %, puis il rebondit et reste au sol | 20 |
| **Pétard** | À lancer, explosif | Ramassé, puis lancé | Explose au contact d'un combattant ou du décor quand il est lancé, ou à la fin de sa mèche (10 s) s'il traîne : 18 %, forte éjection, **blesse tout le monde dans l'explosion, lanceur compris** | 14 |
| **Baie** | Soin | Au contact, sans ramassage | Retire 12 % de dégâts | 30 |
| **Fiole de sève** | Soin rare | Au contact, sans ramassage | Retire 35 % de dégâts | 6 |

Fréquence d'apparition (réglage `frequency`) :

| Réglage | Délai entre deux apparitions | Objets présents au maximum |
|---|---|---|
| `off` | aucune apparition | — |
| `low` | 18 à 26 s, tiré au hasard | 2 |
| `normal` (par défaut) | 10 à 16 s | 3 |
| `high` | 5 à 9 s | 4 |

Un objet non ramassé disparaît au bout de 20 s (il clignote les 2 dernières secondes). Le réglage `kinds` restreint la liste des objets possibles ; les poids des autres sont conservés.

### Commandes avec un objet

Suivent les conventions du genre, sans nouvelle touche :

- **Ramasser** : bouton d'attaque au sol, à portée d'un objet posé, quand le combattant pourrait attaquer. Ramasser est immédiat. Un seul objet tenu à la fois. Les objets de soin se prennent au simple contact, sans bouton.
- **Lancer** : bouton de saisie en tenant un objet, au sol comme en l'air ; la direction du stick choisit le lancer (avant, arrière, haut, bas). Le bouton d'attaque lance aussi un objet à lancer, vers l'avant ou dans la direction du stick. Au sol, le lancer vers le bas pose l'objet devant soi.
- **Frapper** : avec le Bâton, toute attaque normale (sol ou air, stick droit compris) devient le coup de Bâton. Les spéciaux restent ceux du personnage.
- **Perdre l'objet** : il tombe quand on s'accroche à un rebord ; il disparaît quand on est KO. Être frappé ne le fait pas lâcher.

Simplifications assumées pour la v1 : pas de rattrapage d'un objet en vol, pas de lancer « smash » plus puissant, pas d'objet qu'on frappe pour le renvoyer, pas de conteneur (caisse).

## Extension de `sim-core` (accordée le 2026-11-13)

Tout est **additif** : de nouveaux champs optionnels dans les contrats, de nouveaux champs d'état, de nouvelles constantes et fonctions, et quelques appels insérés dans les systèmes existants. Une configuration sans plateforme mobile, sans danger et sans objet se simule exactement comme aujourd'hui. Le code nouveau vit dans deux fichiers neufs, `systems/stage-motion.ts` et `systems/items.ts`.

| Zone | Ajout |
|---|---|
| `defs.ts` | `PlatformDef.motion?` : déplacement d'aller-retour (décalage `dx`, `dy`, période et phase en frames, départ et arrivée adoucis par un polynôme entier). `StageDef.itemSpawns?` : segments d'apparition des objets. `StageDef.hazards?` : danger périodique (position, période, phase, type d'entité créé pendant le jet). `EntityDef.height?` : la zone de coup d'une entité devient une capsule verticale (le jet de geyser). `EntityDef.item?` : comportement d'objet (`ItemDef` : catégorie lancer, frapper ou soin ; vitesse de lancer ; coup du Bâton sous forme de `MoveDef` ; soin ; se brise au contact ; entité créée en se brisant ou en explosant ; mèche) |
| `step.ts` | `SimConfig.items?` : table d'apparition (`{ kind, weight }[]`), délai minimal et maximal en frames, nombre maximal d'objets présents. Deux appels insérés dans `step` : mouvement du stage en début de frame, puis système des objets après celui des entités |
| `state.ts` | Champ de combattant `held` (objet tenu). Champs d'entité `eMode` (libre, tenu, lancé), `eSurface` (surface où l'objet est posé, pour qu'une plateforme mobile le porte), `eTimer` (mèche). Valeur globale `G_ITEM_TIMER`. L'état passe de 2 764 à environ 3 184 octets |
| `actions.ts` | Deux actions : `A_ITEM_THROW` (31) et `A_ITEM_SWING` (32) |
| `events.ts` | `EV_ITEM_SPAWN`, `EV_ITEM_PICKUP`, `EV_ITEM_THROW`, `EV_HEAL`, `EV_ITEM_BREAK` |
| `systems/collision.ts` | Les surfaces mobiles sont recalculées à chaque frame à partir du numéro de frame. L'atterrissage compare les pieds à la hauteur de la surface **à la frame précédente** (identique pour une surface fixe), pour qu'une plateforme qui monte ne laisse pas passer un combattant qui tombe |
| `systems/movement.ts` | Avant le choix d'une attaque : ramassage, lancer ou coup d'objet si le combattant tient un objet ou se trouve à portée d'un objet posé |
| `systems/hit.ts` | Le coup de Bâton est traité comme une attaque, avec la hitbox de l'objet ; un objet n'a de hitbox que lancé ; la capsule verticale d'une entité |
| `systems/ledge.ts` | L'accroche fait lâcher l'objet tenu |
| `systems/blast.ts` | Le KO détruit l'objet tenu |
| `view.ts`, `index.ts` | `readPlatform(sim, index, out)` : position courante d'une plateforme (pour le rendu) ; `EntityView` gagne `mode` et `holder` ; exports des nouveaux types et constantes |
| `test/determinism/golden.json` | **Checksums de référence régénérés** dans un commit dédié : la taille de l'état change, donc toutes les empreintes changent, même si le comportement des séquences existantes est identique (vérifié en comparant les positions et dégâts finaux avant et après) |

Le budget de vitesse de `sim-core` reste un critère : `step` à 8 joueurs et 16 entités sous 0,25 ms en moyenne, mesuré par son benchmark existant, plus un scénario avec 4 objets et 2 plateformes mobiles.

**Risque de fusion** : les modules `fighters` et `match-rules` peuvent aussi ajouter des actions, des événements ou des champs d'état en parallèle. Les numéros (`A_ITEM_THROW` = 31, etc.) entreront alors en collision : ils seront renumérotés à la fusion, ce qui est sans conséquence puisque les checksums sont régénérés à ce moment-là. Je dépose la liste de ces ajouts dans le dossier de notes partagé pour que les autres sessions la voient.

## Stack technique

| Élément | Choix |
|---|---|
| Paquet | `@game/stages-items`, TypeScript 7 strict, mêmes réglages que `sim-core` |
| Dépendances d'exécution | `@game/sim-core` uniquement (pas de Three.js dans ce paquet) |
| Décors | Dans `render`, Three.js déjà présent ; géométries fusionnées par stage avec `BufferGeometryUtils` (fourni par le paquet `three`, pas de nouvelle dépendance) |
| `render` | Gagne la dépendance interne `@game/stages-items` (prévue par la carte) |
| Tests | Vitest ; Playwright avec Edge pour la démo, comme `render` |

## Commandes

```
Tests du module :     pnpm --filter @game/stages-items test
Types :               pnpm --filter @game/stages-items typecheck
Tests de sim-core :   pnpm --filter @game/sim-core test
Benchmark sim-core :  pnpm --filter @game/sim-core bench
Tests du rendu :      pnpm --filter @game/render test
Démo :                pnpm --filter @game/demo dev   (puis ?stage=canal&items=high)
Test de la démo :     pnpm --filter @game/demo test
Performance :         pnpm --filter @game/demo perf
Lint :                pnpm lint
```

## Structure du projet

```
packages/stages-items/
  src/
    index.ts              → API publique
    stages/
      belvedere.ts        → un fichier par stage : StageDef + métadonnées (nom affiché, description)
      recif.ts
      canal.ts
      geysers.ts
      registry.ts         → liste ordonnée des stages, recherche par identifiant
    items.ts              → définitions des 5 objets (EntityDef + ItemDef) et entités dérivées (explosion, jet de geyser)
    config.ts             → applyStage, applyItems, ItemSettings, tables de fréquence
    validate.ts           → contrôles de cohérence d'un stage (utilisés par les tests et utilisables par fighters)
  test/                   → validation des stages, scénarios d'objets, déterminisme et rollback
packages/sim-core/src/systems/
  stage-motion.ts         → NOUVEAU : plateformes mobiles, dangers
  items.ts                → NOUVEAU : apparition, physique, ramassage, lancer, soin, explosion
packages/render/src/stages/
  decor.ts                → NOUVEAU : interface StageVisuals, choix du décor d'après l'identifiant
  palette.ts              → NOUVEAU : outils low-poly (géométries à couleurs par sommet, fusion)
  belvedere.ts … geysers.ts → NOUVEAU : un décor procédural par stage
  items.ts                → NOUVEAU : forme de chaque objet, par instances ; clignotement ; geyser
apps/demo/src/
  stage-select.ts         → NOUVEAU : choix du stage, des objets et des dangers
```

Modifications de fichiers existants de `render`, limitées à des points d'extension : `renderer.ts` (le décor, le fond et les lumières viennent de `StageVisuals` ; les entités qui sont des objets ou des dangers passent par `stages/items.ts` ; la mise à jour du décor est appelée dans `draw`), `fighters/poses.ts` (deux poses pour `A_ITEM_THROW` et `A_ITEM_SWING`), `debug.ts` (hitbox du coup de Bâton). Le dossier `src/audio/` n'est pas touché.

## API publique (contrat)

```ts
export type StageId = 'belvedere' | 'recif' | 'canal' | 'geysers';
export type ItemId = 'galet' | 'baton' | 'petard' | 'baie' | 'fiole';
export type ItemFrequency = 'off' | 'low' | 'normal' | 'high';

export interface StageInfo {
  readonly id: StageId;
  /** Nom affiché, en français. */
  readonly name: string;
  readonly description: string;
  readonly def: StageDef;
  /** Vrai si le stage a des dangers qu'on peut désactiver. */
  readonly hasHazards: boolean;
}

/** Les stages de la v1, dans l'ordre d'affichage. */
export const STAGES: readonly StageInfo[];
export function stageById(id: StageId): StageInfo;

export interface ItemSettings {
  readonly frequency: ItemFrequency;
  /** Objets autorisés ; tous si absent. */
  readonly kinds?: readonly ItemId[];
}
export const DEFAULT_ITEM_SETTINGS: ItemSettings; // { frequency: 'normal' }

export interface StageOptions {
  /** Dangers actifs ; vrai par défaut. */
  readonly hazards?: boolean;
}

/**
 * Renvoie une copie de `config` qui se joue sur le stage donné et avec les objets réglés.
 * Les types d'entités nécessaires (objets, explosion, jet de geyser) sont ajoutés après ceux
 * de `config.entities`, dont les numéros ne changent donc pas (projectiles des personnages).
 */
export function applyStage(config: SimConfig, id: StageId, options?: StageOptions): SimConfig;
export function applyItems(config: SimConfig, settings: ItemSettings): SimConfig;

/** Pour le rendu : quel objet ou quel danger représente le type d'entité `kind`, ou undefined. */
export function itemOf(config: SimConfig, kind: number): ItemId | undefined;
export function isHazardEntity(config: SimConfig, kind: number): boolean;

/** Contrôles de cohérence d'un stage ; liste vide si tout va bien. */
export function validateStage(stage: StageDef, players: number): string[];
```

## Style de code

Celui de `sim-core` pour tout ce qui tourne dans `step` (virgule fixe, tableaux typés, aucune allocation, aucune fonction flottante) ; celui de `render` pour les décors. Données décrites en unités lisibles et converties par `fx()` :

```ts
export const CANAL: StageDef = {
  name: 'canal',
  solids: [{ x1: fx(-75), y1: fx(-30), x2: fx(75), y2: fx(0) }],
  platforms: [
    // La barge traverse le stage : de x = -60 à x = +60 en 240 frames, puis retour.
    { x1: fx(-75), x2: fx(-45), y: fx(24), motion: { dx: fx(120), dy: fx(0), period: 480, phase: 0 } },
  ],
  // …
};
```

## Stratégie de test

| Niveau | Quoi | Où |
|---|---|---|
| Validation des stages | Pour chaque stage : 8 points d'apparition sur une surface fixe, distincts ; géométrie et trajectoires des plateformes mobiles à l'intérieur des zones limites ; aucune plateforme mobile ne traverse un bloc plein ; zones d'apparition d'objets au-dessus d'une surface ; chaque plateforme accessible d'un saut depuis le sol ou une autre plateforme | `packages/stages-items/test/` |
| Unitaire `sim-core` | Position d'une plateforme mobile en fonction de la frame (bornes, continuité, période) ; tirage de l'apparition (délais dans l'intervalle, poids respectés sur 10 000 tirages, aucun objet au-delà du maximum) | `packages/sim-core/test/` |
| Scénarios `sim-core` | Combattant porté par une plateforme mobile (horizontale et verticale) ; atterrissage sur une plateforme qui monte ; geyser : bouillonnement sans coup, puis coup, bouclier, une seule touche par jet ; ramasser, lancer dans les 4 directions, coup de Bâton, galet brisé, Bâton qui rebondit, pétard qui explose (lanceur compris), soin plafonné à 0 %, objet lâché à l'accroche et détruit au KO, disparition après 20 s, objet posé sur une plateforme mobile | `packages/sim-core/test/scenarios/` |
| Non-régression | Les séquences de référence existantes donnent les mêmes positions, actions et dégâts qu'avant l'extension (seul le checksum change, à cause de la taille de l'état) | `packages/sim-core/test/determinism/` |
| Déterminisme et rollback | Sur chaque stage, objets à `high`, 8 joueurs à inputs aléatoires : double exécution identique sur 36 000 frames ; propriété sauvegarde/restauration sur 200 tirages | `packages/stages-items/test/` |
| Rendu | Choix du décor par identifiant, repli sur le décor neutre pour un stage inconnu ; plateforme mobile affichée à la position lue dans la simulation ; non-ingérence sur chaque stage | `packages/render/test/` |
| Démo | Fumée : chaque stage se charge sans erreur, objets activés ; un objet apparaît | `apps/demo/test/` |
| Performance | Mesure existante de la démo, sur chaque stage, 8 combattants à inputs aléatoires, objets à `high` | `apps/demo/test/perf.test.ts` |
| Visuel | Captures de chaque stage et de chaque objet, relues par vous | — |

Développement piloté par les tests pour toute la logique de `sim-core` et la validation des stages ; décors vérifiés par captures.

## Limites

- **Toujours** : faire passer tests, déterminisme, typecheck et lint avant chaque commit ; écrire le scénario avant la mécanique ; tenir à jour le tableau des écarts en fin de spec.
- **Demander d'abord** : toute modification de `sim-core` qui sortirait de l'extension listée plus haut ; ajouter une dépendance externe ; changer la formule d'éjection ou une valeur de gameplay du combattant ; relever un seuil de performance ; modifier un fichier de `render` en dehors des points d'extension listés.
- **Jamais** : `Math.random`, `Date`, `performance.now` ou fonction trigonométrique native dans ce qui tourne pendant `step` ; changer le sens d'un champ, d'une action ou d'un événement existants de `sim-core` ; toucher à `packages/render/src/audio/` ; modifier la ligne « Specs existantes » de la carte ; reprendre un stage, un objet, un nom ou un visuel d'un jeu existant ; télécharger un asset.

## Critères de succès

1. **Contenu** : 4 stages et 5 objets conformes aux tableaux validés, chacun avec son décor ou sa forme procédurale.
2. **Stages valides** : `validateStage` ne signale rien sur les 4 stages, pour 2 à 8 joueurs.
3. **Mécaniques** : chaque ligne des scénarios de la stratégie de test a au moins un test qui passe.
4. **Déterminisme** : double exécution identique et propriété de rollback sur chaque stage, objets à `high`, à 8 joueurs ; les séquences de référence de `sim-core` gardent leur comportement (seuls les checksums sont régénérés).
5. **Vitesse de la simulation** : `step` à 8 joueurs, 16 entités, objets et plateformes mobiles, sous 0,25 ms en moyenne et 1 ms au 99ᵉ centile ; snapshot sous 0,05 ms.
6. **Performance du rendu** : la mesure `pnpm --filter @game/demo perf` passe sur chacun des 4 stages, objets à `high` (95 % des images sous 16,7 ms, dessin sous 4 ms en moyenne, moins de 100 appels de dessin, tas +256 Ko au plus sur 600 images).
7. **Démo** : on y choisit le stage, la fréquence des objets et les dangers ; test de fumée passant.
8. **Configurable** : `applyItems` et `applyStage` suffisent au module `match-rules` pour régler objets et dangers, sans connaître les détails internes.
9. **Ressenti** : vous avez essayé chaque stage et chaque objet dans la démo et donné votre avis (non vérifiable par moi).

## Décisions prises à la validation (2026-11-13)

- **Stages** : les 4 proposés (référence, plat, mobile, danger).
- **Objets** : les 5 proposés, avec les poids et la table de fréquence ci-dessus.
- **Extension de `sim-core`** : acceptée telle que listée, régénération des checksums de référence sur cette branche comprise.
- **Commandes avec un objet** : ramasser à l'attaque, lancer à la saisie, soins au contact, objet lâché à l'accroche.

## Écarts et limites constatés pendant l'implémentation

Mis à jour à chaque phase.

| Sujet | État actuel | Suite prévue |
|---|---|---|
