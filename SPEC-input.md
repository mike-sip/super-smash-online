# Spec : `input` — clavier, manettes et production des `InputFrame`

> Statut : **APPROUVÉE le 2026-11-13, implémentée** (bilan en fin de document ; l'essai manuel reste à faire). Plan : [tasks/input/plan.md](tasks/input/plan.md), tâches : [tasks/input/todo.md](tasks/input/todo.md). Module de la [carte des capacités](CAPABILITY-MAP.md). Dépend de : `sim-core` (type `InputFrame` et constantes de boutons uniquement). Remplace `apps/demo/src/temp-input.ts`.

## Hypothèses

1. **Le module traduit, il ne décide pas.** Il lit les périphériques et produit, pour chaque joueur local et chaque frame simulée, un `InputFrame` au format défini par `sim-core`. Aucune règle de jeu : savoir si un coup de stick est un dash ou un smash reste l'affaire de `sim-core`.
2. **Le tampon d'actions existe déjà dans `sim-core`** (6 frames, dans l'état, donc compatible avec le rollback). La carte attribue un « tampon d'inputs » à ce module : ici, il se réduit à ne perdre aucun appui survenu entre deux frames. La carte a été corrigée en ce sens.
3. **Le module ne lit pas l'horloge.** L'application l'interroge une fois par frame simulée, juste avant `step`. Le délai d'input, la prédiction et le rollback appartiennent à `netcode`.
4. **Les touches sont repérées par leur position physique** (`KeyboardEvent.code`), pour qu'une disposition reste sous les doigts sur AZERTY comme sur QWERTY. Le nom affiché à l'écran, lui, est celui de la touche sur le clavier du joueur quand le navigateur sait le donner.
5. **Manettes : disposition « standard » de l'API Gamepad d'abord.** Une manette que le navigateur ne reconnaît pas comme standard reste utilisable, après remappage par le joueur.
6. **L'écran de remappage final appartient à `app-shell`.** Ce module fournit l'API qui le rend possible (lire, modifier, valider, enregistrer une disposition ; attendre le prochain appui) et un écran minimal dans la démo pour l'essayer.
7. **Cible** : navigateurs desktop récents. Edge et Chrome sont vérifiés automatiquement ; Firefox et Safari, dont l'API Gamepad diffère par endroits, le sont à la main.

## Objectif

Donner à chaque joueur local un contrôle fidèle et sans latence ajoutée de son combattant, au clavier ou à la manette, avec des commandes qu'il peut réassigner.

**Utilisateurs** : la démo aujourd'hui ; `netcode`, qui enverra les `InputFrame` locaux au serveur ; `app-shell`, pour l'écran d'options et l'arrivée des joueurs (« appuyez sur un bouton pour rejoindre »).

**Succès** : on branche une manette, on appuie sur un bouton, on joue ; toutes les actions de `sim-core` sont accessibles au clavier comme à la manette ; un appui bref n'est jamais perdu, une touche ne reste jamais enfoncée à tort.

### Périmètre fonctionnel

| Domaine | Inclus dans ce module |
|---|---|
| Clavier | Lecture par événements, appuis brefs conservés, relâchement général à la perte du focus, touches du jeu soustraites au navigateur (pas de défilement de page) |
| Manette | Lecture par interrogation à chaque frame, branchement et débranchement à chaud, disposition standard, gâchettes analogiques ramenées à un bouton |
| Stick analogique | Zone morte, mise à l'échelle sur ±127, diagonales qui atteignent les seuils de `sim-core`, stick droit ramené à quatre directions |
| Stick au clavier | Tout ou rien, touche de modification pour un demi-stick, résolution des directions opposées |
| Options | Saut en poussant le stick vers le haut, désactivé par défaut |
| Joueurs locaux | Attribution d'un périphérique à un emplacement de joueur, détection d'un joueur qui veut rejoindre, emplacement conservé si la manette se débranche |
| Remappage | Disposition par périphérique, modifiable action par action, détection des conflits, retour aux valeurs par défaut, attente du prochain appui |
| Persistance | Dispositions et réglages enregistrés dans le navigateur, format versionné, données invalides ignorées sans erreur |
| Démo | `temp-input.ts` supprimé, écran minimal de remappage |

**Hors périmètre** : tampon d'actions et interprétation des inputs (`sim-core`), délai d'input et rollback (`netcode`), écran d'options final et navigation des menus à la manette (`app-shell`), tactile et mobile (hors v1), vibrations, enregistrement et relecture d'inputs (replays non retenus pour la v1).

## Points de conception à trancher par la spec

Ces points viennent de la lecture de `sim-core` et de l'essai de la démo ; ils conditionnent le ressenti.

1. **Seuils du stick.** `sim-core` lit le stick sur ±127 avec ces seuils : neutre sous 20, attaque dirigée à partir de 40, course à partir de 64, dash et smash à 96 atteints en 3 frames au plus. Le module doit donc garantir qu'un stick physique poussé à fond donne 127, et qu'un stick au repos donne 0 malgré sa dérive.
2. **Diagonales.** Un stick rond poussé en diagonale ne donne qu'environ 90 sur chaque axe, sous le seuil de 96 : sans correction, pas de dash ni de smash en diagonale. Le module étire la course du stick pour que les diagonales atteignent 127 sur les deux axes.
3. **Appuis brefs.** Un appui plus court qu'une frame (16,7 ms) doit compter pour exactement une frame : ni perdu, ni prolongé. C'est ce qui distingue le petit saut du grand saut, que `sim-core` décide selon que le bouton est encore tenu au décollage.
4. **Directions opposées au clavier.** Gauche et droite enfoncées ensemble : la dernière touche enfoncée l'emporte, ce qui rend le demi-tour immédiat.
5. **Limite de l'API Gamepad.** Une manette ne se lit que par interrogation : un appui commencé et terminé entre deux lectures est invisible, et rien ne permet de le rattraper. À 60 lectures par seconde le cas est rare ; il est documenté, pas corrigé.

## Stack technique

| Élément | Choix |
|---|---|
| Langage | TypeScript 7, mêmes réglages que `sim-core` |
| API navigateur | `KeyboardEvent`, Gamepad API, `localStorage`, `Keyboard.getLayoutMap()` quand il existe |
| Tests | Vitest pour la logique ; Playwright avec Edge pour le clavier réel et une manette simulée |
| Dépendances d'exécution | `@game/sim-core`, rien d'autre |

## Commandes

```
Tests :            pnpm --filter @game/input test
Types :            pnpm --filter @game/input typecheck
Build :            pnpm --filter @game/input build
Test de la démo :  pnpm --filter @game/demo test
Mesure :           pnpm --filter @game/input bench
Lint :             pnpm lint --fix
```

## Structure du projet

```
packages/input/
  src/
    index.ts        → API publique
    actions.ts      → actions de jeu réassignables et leur bouton dans InputFrame
    bindings.ts     → dispositions par défaut, validation, conflits (logique pure)
    analog.ts       → zone morte, mise à l'échelle, diagonales, stick droit (logique pure)
    keyboard.ts     → état des touches, appuis brefs, directions opposées
    gamepad.ts      → lecture des manettes, disposition standard
    players.ts      → attribution des périphériques aux joueurs, arrivée d'un joueur
    capture.ts      → attente du prochain appui, pour le remappage
    storage.ts      → enregistrement versionné des dispositions et réglages
    system.ts       → assemblage : createInput, sample
  test/             → tests de la logique pure
apps/demo/
  src/
    remap.ts        → écran minimal de remappage
    temp-input.ts   → SUPPRIMÉ
```

## API publique (contrat)

```ts
/** Actions réassignables. Les quatre directions du stick sont des actions comme les autres. */
export type Action =
  | 'left' | 'right' | 'up' | 'down'
  | 'attack' | 'special' | 'jump' | 'shield' | 'grab' | 'taunt'
  | 'cLeft' | 'cRight' | 'cUp' | 'cDown'
  | 'walk'; // touche de modification : demi-stick au clavier

/** Un périphérique vu par le module : le clavier, ou une manette branchée. */
export interface Device {
  readonly id: string;
  readonly kind: 'keyboard' | 'gamepad';
  /** Nom à afficher au joueur. */
  readonly label: string;
  readonly connected: boolean;
}

/** Ce qu'un joueur actionne physiquement : une touche, un bouton, ou un demi-axe de stick. */
export type PhysicalInput =
  | { readonly type: 'key'; readonly code: string }
  | { readonly type: 'button'; readonly index: number }
  | { readonly type: 'axis'; readonly index: number; readonly direction: 1 | -1 };

/** Disposition d'un périphérique : plusieurs commandes possibles par action. */
export type Bindings = Readonly<Record<Action, readonly PhysicalInput[]>>;

export interface AnalogSettings {
  /** Part de la course du stick ignorée autour du centre, de 0 à 1. */
  readonly deadzone: number;
  /** Inclinaison à partir de laquelle le stick droit ou une gâchette compte comme enfoncé. */
  readonly threshold: number;
}

export interface InputOptions {
  /** Cible des événements clavier et source des manettes. */
  readonly target: Window;
  /** Nombre d'emplacements de joueurs locaux. */
  readonly players: number;
  /** Où enregistrer les dispositions ; absent : rien n'est conservé. */
  readonly storage?: Storage;
}

export function createInput(options: InputOptions): Input;

export interface Input {
  /**
   * À appeler une fois par frame simulée, juste avant `step`. Lit les périphériques et écrit
   * l'InputFrame de chaque joueur local dans `out[emplacement]`. Un emplacement sans
   * périphérique reçoit 0. N'alloue rien.
   */
  sample(out: Uint32Array): void;

  devices(): readonly Device[];
  /** Périphérique de l'emplacement, ou `null`. */
  assigned(player: number): Device | null;
  assign(player: number, deviceId: string | null): void;

  /** Appelé quand un périphérique non attribué est actionné : un joueur veut rejoindre. */
  onJoinRequest(listener: (device: Device) => void): () => void;
  /** Appelé au branchement et au débranchement d'une manette. */
  onDeviceChange(listener: (device: Device) => void): () => void;

  bindings(deviceId: string): Bindings;
  /** Refuse une disposition invalide et renvoie la raison ; sinon l'applique et l'enregistre. */
  setBindings(deviceId: string, bindings: Bindings): BindingError | null;
  resetBindings(deviceId: string): void;
  /** Prochaine touche ou prochain bouton actionné sur ce périphérique. Annulable. */
  captureNext(deviceId: string, signal?: AbortSignal): Promise<PhysicalInput>;
  /** Nom à afficher pour une commande, d'après le clavier du joueur quand il est connu. */
  describe(deviceId: string, input: PhysicalInput): string;

  analog(): AnalogSettings;
  setAnalog(settings: AnalogSettings): void;

  /** Saut en poussant le stick vers le haut, par joueur. Désactivé par défaut. */
  tapJump(player: number): boolean;
  setTapJump(player: number, enabled: boolean): void;

  dispose(): void;
}
```

`sample` écrit dans le tableau même que l'application passe à `step` : aucune copie, aucune allocation. Les emplacements des joueurs distants sont remplis par `netcode`, pas par ce module.

### Dispositions par défaut

- **Clavier** : celle de la démo, validée avec la spec `render`. Flèches pour le stick, rangée du bas pour saut, attaque, spécial, bouclier et saisie, `IJKL` pour le stick droit, `Maj` pour marcher.
- **Manette** : bas du losange pour attaquer, droite pour le spécial, gauche et haut pour sauter, gâchettes pour le bouclier, boutons d'épaule pour la saisie, stick droit pour les smash, croix vers le haut pour la provocation.

## Style de code

```ts
// Logique pure : testable sans navigateur, sans périphérique.

/**
 * Ramène un stick brut (x et y de -1 à 1) sur ±127, zone morte retirée et diagonales étirées
 * pour qu'un stick poussé à fond dans un coin donne 127 sur les deux axes. N'alloue rien.
 */
export function shapeStick(x: number, y: number, deadzone: number, out: StickValue): void {
  // …remplit out.x et out.y, entiers de -127 à 127
}
```

Conventions :
- Mêmes règles de nommage et de formatage que `sim-core`.
- Tout ce qui peut s'écrire sans navigateur (mise en forme du stick, dispositions, conflits, directions opposées, format d'enregistrement) vit dans des fonctions pures testées ; les fichiers qui touchent au DOM restent minces.
- Aucune allocation dans `sample`.
- Le module n'importe de `sim-core` que `InputFrame`, `encodeInput`, `STICK_MAX` et les constantes `BTN_*`.

## Stratégie de test

| Niveau | Quoi | Où |
|---|---|---|
| Unitaire | Stick : repos à 0, fond de course à 127, diagonales à 127, zone morte, monotonie ; stick droit et gâchettes ; directions opposées ; appui bref compté une frame exactement ; dispositions par défaut complètes ; conflits ; enregistrement, relecture, données corrompues ou d'une ancienne version | `packages/input/test/` |
| Contrat | Chaque action de `sim-core` est atteignable : une séquence produite par le module, jouée dans la simulation, déclenche marche, course, dash, petit et grand saut, attaques dirigées, smash, bouclier, esquives, saisie, options de rebord | `packages/input/test/` |
| Navigateur | Dans Edge : touches réelles, perte de focus, manette simulée (branchement, boutons, sticks, débranchement), remappage dans la démo | `apps/demo/test/` |
| Manuel | Votre manette, votre clavier : ressenti, noms des touches affichés, débranchement en plein combat | — |

Une manette réelle ne s'automatise pas : le test de navigateur remplace `navigator.getGamepads` par une manette simulée, ce qui vérifie notre lecture mais pas le matériel. L'essai manuel reste nécessaire.

## Limites

- **Toujours** : faire passer tests, typecheck et lint avant chaque commit ; écrire le test avant la logique pure ; dire dans le compte rendu ce qui n'a pu être vérifié qu'à la main.
- **Demander d'abord** : ajouter une dépendance ; modifier le format `InputFrame` ou tout autre contrat de `sim-core` ; changer une disposition par défaut validée ; soustraire au navigateur un raccourci système (fermeture d'onglet, plein écran).
- **Jamais** : mettre une règle de jeu dans ce module ; lire l'horloge ou lisser les inputs dans le temps ; enregistrer autre chose que dispositions et réglages ; importer les fichiers internes de `sim-core`.

## Critères de succès

1. **Complet** : le test de contrat passe ; toutes les actions de `sim-core` sont atteignables au clavier et à la manette.
2. **Fidèle** : un changement d'état d'une touche ou d'un bouton figure dans l'`InputFrame` de la lecture suivante, sans frame de retard ajoutée ; un appui clavier plus court qu'une frame compte pour une frame exactement ; après une perte de focus, tout est relâché.
3. **Juste** : stick au repos à 0 avec une dérive allant jusqu'à la zone morte ; stick à fond à 127, diagonales comprises ; dash et smash déclenchables dans les huit directions utiles.
4. **Remappable** : chaque action se réassigne ; un conflit est signalé ; la disposition survit au rechargement de la page ; des données enregistrées invalides redonnent la disposition par défaut sans erreur.
5. **Multijoueur local** : quatre joueurs locaux jouent ensemble ; une manette débranchée libère ses boutons, garde son emplacement et le retrouve au rebranchement.
6. **Économe** : `sample` n'alloue rien et prend moins de 0,05 ms pour tous les joueurs locaux.
7. **Intégré** : `temp-input.ts` est supprimé ; la démo et ses tests passent avec le module ; l'écran minimal de remappage fonctionne.
8. **Essayé** : vous avez joué au clavier et avec votre manette, et donné votre avis.

## Décisions prises à la validation

- **Joueurs locaux** : jusqu'à 4 sur une même machine (un clavier et trois manettes, ou quatre manettes).
- **Un seul joueur au clavier** : pas de second joueur sur le même clavier pour la v1.
- **Gauche et droite enfoncées ensemble** : la dernière touche enfoncée l'emporte ; de même pour haut et bas.
- **Saut au stick** : option proposée au joueur, désactivée par défaut, réalisée entièrement dans ce module.
- **Zone morte par défaut** : 15 % de la course du stick, réglable ; à confirmer à l'essai avec votre manette.
- **Carte des capacités** : la ligne du module parle désormais de « conservation des appuis brefs », le tampon d'actions étant dans `sim-core`.

## Écarts et limites constatés pendant l'implémentation

- **Allocations cachées dans la lecture des manettes**, trouvées par la mesure de T9 : `sample` allouait de 30 à 80 octets par appel dès qu'un stick bougeait. Deux causes, propres au moteur V8. `Math.hypot` alloue un tableau d'arguments à chaque appel : remplacé par `Math.sqrt(x * x + y * y)`, équivalent pour des valeurs de -1 à 1. Une fonction qui renvoie un nombre décimal alloue ce nombre à chaque retour quand V8 ne l'insère pas dans l'appelant ; `read` appelait une vingtaine de fois une telle fonction et dépassait le budget d'insertion : elle calcule désormais l'intensité de toutes les actions en un seul parcours, rangée dans un `Float64Array`. Ces deux pièges ne se voient pas à la lecture du code : seul le banc les attrape, et il échoue si l'un d'eux revient (vérifié en réintroduisant `Math.hypot`).
- **Mesure du tas** : une boucle écrite au niveau du module est recompilée par V8 pendant qu'elle tourne, et le code compilé compte dans le tas ; la première mesure faisait croire à 500 Ko d'allocations. Le banc mesure donc une fonction déjà chauffée, répète la mesure et soustrait une mesure à vide. Le seuil est de 1 Ko sur 10 000 appels : au-dessus du bruit (une centaine d'octets), bien en dessous d'une seule allocation répétée (160 Ko).
- **Firefox et Safari non essayés** : Firefox ne démarre pas sur la machine de développement (déjà constaté pour `sim-core`) et aucune machine Apple n'est disponible. La lecture est écrite contre la spécification de l'API Gamepad, pas contre Edge seul, mais rien ne le prouve encore.

## Bilan des critères de succès (2026-11-13)

| N° | Critère | État | Preuve |
|---|---|---|---|
| 1 | Complet | Vérifié automatiquement | Tests de contrat clavier, manette et saut au stick (`test/contract*.test.ts`) : toutes les actions de `sim-core` se déclenchent dans la vraie simulation |
| 2 | Fidèle | Vérifié automatiquement | `keyboard.test.ts` (appui plus court qu'une frame compté une fois, jamais prolongé), `system.test.ts` et fumée de la démo (relâchement à la perte du focus) ; aucune file d'attente entre l'événement et la lecture suivante |
| 3 | Juste | Vérifié automatiquement | `analog.test.ts` : repos à 0 avec dérive, 127 à fond et en diagonale, dash et smash dans les huit directions ; contrat manette : dash en diagonale. **Zone morte de 15 % à confirmer avec votre manette** |
| 4 | Remappable | Vérifié automatiquement | `storage.test.ts`, `capture.test.ts` ; fumée de la démo dans Edge : réassignation du saut, rechargement, retour au défaut |
| 5 | Multijoueur local | Vérifié automatiquement, avec manettes simulées | `players.test.ts` (quatre manettes, débranchement et rebranchement) ; fumée de la démo (arrivée d'une manette, débranchement). **Non vérifié avec du matériel réel** |
| 6 | Économe | Vérifié automatiquement | `pnpm --filter @game/input bench` : 0,0006 ms par appel à 4 joueurs (seuil 0,05) ; 0 octet alloué sur 10 000 appels |
| 7 | Intégré | Vérifié automatiquement | `temp-input.ts` supprimé ; 9 tests de fumée de la démo passants, écran de remappage compris |
| 8 | Essayé | **Non vérifié** | En attente de votre essai au clavier et à la manette, et de votre avis sur le stick |

Commande ajoutée pendant l'implémentation :

```
Mesure de sample :  pnpm --filter @game/input bench
```
