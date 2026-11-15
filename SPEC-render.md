# Spec : `render` — affichage du combat et démo jouable

> Statut : **APPROUVÉE le 2026-11-11**. Plan : [tasks/render/plan.md](tasks/render/plan.md), tâches : [tasks/render/todo.md](tasks/render/todo.md). Module de la [carte des capacités](CAPABILITY-MAP.md). Dépend de : `sim-core` (implémenté).

## Hypothèses

1. **Objectif du premier jalon : jouer.** Ce module livre le jalon 1 de la carte, « combat local jouable à 60 fps ». Sa première raison d'être est de vous permettre de juger le ressenti et de régler les valeurs provisoires de `sim-core`.
2. **Les modules `fighters`, `stages-items` et `input` n'existent pas encore.** La carte fait dépendre `render` des deux premiers ; en attendant, il s'appuie sur le combattant et le stage de test de `sim-core` (`@game/sim-core/testing`). La démo embarque une lecture clavier et manette **provisoire**, marquée comme telle, qui sera remplacée par le module `input`.
3. **Aucun asset 3D final.** Les combattants sont des mannequins générés par le code (corps, tête, membres en formes simples), animés par des poses procédurales. Le module définit l'interface qui permettra de brancher plus tard de vrais modèles animés sans toucher au reste.
4. **Rendu 2.5D** : scène 3D en perspective, gameplay sur un plan, conformément à la décision de la carte.
5. **Le rendu ne décide de rien.** Il lit la simulation par son API de lecture (`readFighter`, `readEntity`, `events`) et sa configuration. Il ne modifie jamais l'état et ne contient aucune règle de jeu.
6. **La simulation tourne à 60 Hz fixes, l'écran à sa propre fréquence.** Le rendu interpole entre les deux dernières frames simulées, pour rester fluide sur un écran 120 ou 144 Hz comme sur un écran 60 Hz.
7. **Audio hors du premier jalon.** La carte place l'audio dans ce module ; il fera l'objet d'une phase ultérieure, une fois le combat visible et jouable.
8. **Cible** : navigateurs desktop récents, WebGL 2.

## Objectif

Afficher un combat de `sim-core` de façon lisible et fluide, et fournir une page de démonstration où l'on joue localement au clavier ou à la manette contre des mannequins.

**Utilisateurs** : vous, pour juger et régler le ressenti ; plus tard `app-shell`, qui intégrera le rendu dans le jeu complet, et `netcode`, dont le rollback impose une contrainte sur les effets (voir « Événements »).

**Succès** : on lance la démo, on contrôle un combattant, on voit clairement chaque action, chaque coup et chaque éjection, à 60 images par seconde avec 8 combattants à l'écran.

### Périmètre fonctionnel

| Domaine | Inclus dans ce module |
|---|---|
| Scène | Stage (blocs pleins, plateformes), fond, éclairage, ombres simples au sol |
| Combattants | Mannequin procédural, couleur par joueur, orientation, une pose par action de `sim-core`, animée selon la frame de l'action |
| Fluidité | Interpolation des positions entre deux frames simulées ; gel de l'animation pendant le hitlag ; léger tremblement de la victime |
| Caméra | Cadrage automatique de tous les combattants vivants, zoom et déplacement adoucis, limites liées au stage |
| Entités | Projectiles et objets, d'après leur type |
| Effets | Impact de coup, bouclier (taille selon sa résistance), parade, bris de bouclier, intangibilité, KO, accroche au rebord |
| HUD | Pourcentage de dégâts par joueur, étiquette de joueur au-dessus de chaque combattant |
| Vue technique | Affichage commutable des hitbox, hurtbox, rebords et zones limites ; action, frame et vitesse de chaque combattant |
| Démo | Page jouable : un joueur au clavier ou à la manette, de 1 à 7 mannequins (immobiles ou à inputs aléatoires), pause, avance image par image, ralenti, réinitialisation |

**Hors périmètre** : modèles 3D et animations finales, audio (phase ultérieure), menus, sélection de personnage, règles de match, jeu en ligne, remappage des touches (module `input`), réglage des valeurs de gameplay depuis la page (voir questions ouvertes).

## Stack technique

| Élément | Choix |
|---|---|
| Rendu | Three.js, dernière version stable, figée à l'installation |
| Langage | TypeScript 7, mêmes réglages que `sim-core` |
| Démo | Vite (déjà présent dans le dépôt) |
| HUD et vue technique | HTML et CSS superposés au canvas, pas de texte en WebGL |
| Tests | Vitest pour la logique ; Playwright avec Edge pour la démo |
| Dépendances d'exécution | `three` et `@game/sim-core`, rien d'autre |

## Commandes

```
Lancer la démo :   pnpm --filter @game/demo dev
Tests du rendu :   pnpm --filter @game/render test
Test de la démo :  pnpm --filter @game/demo test
Performance :      pnpm --filter @game/demo perf
Types :            pnpm --filter @game/render typecheck
Build de la démo : pnpm --filter @game/demo build
Lint :             pnpm lint --fix
```

## Structure du projet

```
packages/render/
  src/
    index.ts            → API publique
    renderer.ts         → création, boucle de dessin, redimensionnement
    interpolation.ts    → mémorisation des deux dernières frames, mélange
    camera.ts           → cadrage automatique (logique pure, testable sans WebGL)
    stage.ts            → construction du décor à partir de StageDef
    fighters/
      visual.ts         → interface FighterVisual (mannequin aujourd'hui, modèle animé demain)
      mannequin.ts      → mannequin procédural
      poses.ts          → une pose par action, fonction de la frame (logique pure)
    entities.ts         → projectiles et objets
    effects.ts          → effets déclenchés par les événements
    events.ts           → consommation des événements, sans doublon après rollback
    hud.ts              → pourcentages et étiquettes (DOM)
    debug.ts            → hitbox, hurtbox, rebords, zones limites, état
  test/                 → tests de la logique pure
apps/demo/
  index.html
  src/
    main.ts             → boucle à pas fixe, assemblage simulation + rendu
    temp-input.ts       → clavier et manette PROVISOIRES, à remplacer par le module input
    dummies.ts          → mannequins immobiles ou à inputs aléatoires
    controls.ts         → pause, image par image, ralenti, réinitialisation, vue technique
  test/                 → test de fumée et mesure de performance (Playwright)
```

## API publique (contrat)

```ts
export interface RendererOptions {
  readonly canvas: HTMLCanvasElement;
  /** Conteneur du HUD et de la vue technique, superposé au canvas. */
  readonly overlay: HTMLElement;
  readonly config: SimConfig;
}

export function createRenderer(options: RendererOptions): Renderer;

export interface Renderer {
  /**
   * À appeler après chaque `step`. Mémorise la frame pour l'interpolation et déclenche les
   * effets des événements. Une frame déjà vue (re-simulée après un rollback) ne redéclenche rien.
   */
  capture(sim: Sim): void;

  /** Dessine. `alpha`, de 0 à 1, situe l'instant affiché entre les deux dernières frames capturées. */
  draw(alpha: number): void;

  resize(width: number, height: number, pixelRatio: number): void;
  setDebug(enabled: boolean): void;
  /** Libère les ressources GPU. */
  dispose(): void;
}
```

La boucle à pas fixe (accumulateur de temps, appels à `step`, `capture` et `draw`) appartient à l'application : la démo aujourd'hui, `app-shell` et `netcode` demain.

### Événements et rollback

`sim-core` réémet les événements d'une frame quand elle est re-simulée. `capture` ne déclenche donc un effet que pour une frame dont le numéro dépasse le plus grand déjà vu. C'est une approximation acceptée : un effet déclenché par une frame ensuite corrigée par un rollback aura été joué à tort. Elle sera réévaluée avec le module `netcode`.

## Style de code

```ts
// Logique pure, sans Three.js : testable dans Node, réutilisable.
export interface Framing {
  centerX: number;
  centerY: number;
  /** Distance de la caméra au plan de jeu. */
  distance: number;
}

/** Cadre tous les points donnés avec une marge, dans les limites du stage. */
export function frameFighters(
  xs: Float32Array,
  ys: Float32Array,
  count: number,
  bounds: CameraBounds,
  out: Framing,
): void {
  // …remplit `out`, n'alloue rien
}
```

Conventions :
- Mêmes règles de nommage et de formatage que `sim-core`.
- Tout ce qui peut s'écrire sans Three.js (cadrage, poses, interpolation, choix des effets) vit dans des fonctions pures testées ; les fichiers qui touchent à Three.js restent minces.
- Aucune allocation dans `capture` ni `draw` : objets, vecteurs et vues sont créés une fois et réutilisés.
- Les objets Three.js sont créés à l'initialisation et réutilisés ; rien n'est créé ni détruit par frame.
- Les durées d'animation s'expriment en frames de simulation, jamais en millisecondes d'horloge : une pose dépend de `actionFrame`, pas du temps réel. C'est ce qui garde l'affichage juste en pause, au ralenti et en image par image.

## Stratégie de test

| Niveau | Quoi | Où |
|---|---|---|
| Unitaire | Cadrage de la caméra (tous les combattants visibles, limites respectées, adoucissement), interpolation, poses (une par action, continues d'une frame à l'autre), filtre d'événements après rollback | `packages/render/test/` |
| Non-ingérence | Le checksum de la simulation est identique avant et après `capture` et `draw` | `packages/render/test/` |
| Fumée | La démo se charge dans Edge sans erreur de console, le canvas n'est pas vide, une touche déplace le joueur | `apps/demo/test/` |
| Performance | Temps par image mesuré dans Edge sur 10 secondes, 8 combattants à inputs aléatoires et 16 entités | `apps/demo/test/` |
| Visuel | Relecture humaine à chaque point de contrôle : captures d'écran jointes au compte rendu | — |

Le rendu lui-même (ce qui apparaît à l'écran) ne se vérifie pas par test automatique au-delà de « non vide, sans erreur ». Sa justesse relève de votre relecture, démo en main.

## Limites

- **Toujours** : faire passer tests, typecheck et lint avant chaque commit ; écrire le test avant la logique pure ; vérifier dans la démo ce qui ne se teste pas automatiquement, et le dire dans le compte rendu.
- **Demander d'abord** : ajouter une dépendance autre que `three` ; modifier l'API de `sim-core` ; modifier une valeur de gameplay de `sim-core` ; relever un seuil de performance.
- **Jamais** : modifier l'état de la simulation ; importer les fichiers internes de `sim-core` (`systems/`, `state`) ; mettre une règle de jeu dans le rendu ; télécharger ou intégrer un asset tiers sans accord ; reprendre un personnage, un décor ou un élément visuel d'un jeu existant.

## Critères de succès

1. **Jouable** : dans la démo, le joueur 1 se déplace, saute, attaque, se protège, esquive, saisit et s'accroche au rebord au clavier et à la manette ; chaque action de `sim-core` a une pose distincte et reconnaissable.
2. **Fluide** : sur la machine de développement, dans Edge, avec 8 combattants et 16 entités, 95 % des images sont produites en moins de 16,7 ms sur 10 secondes, et le dessin d'une image coûte moins de 4 ms en moyenne.
3. **Économe** : moins de 100 appels de dessin par image dans ce scénario ; le tas JavaScript grandit de moins de 256 Ko sur 600 images en régime établi.
4. **Lisible** : la caméra garde tous les combattants vivants à l'écran ; le HUD affiche le pourcentage de chaque joueur ; un coup porté, un bouclier, une parade et un KO se distinguent sans la vue technique.
5. **Outillé** : la vue technique montre hitbox, hurtbox, rebords et zones limites, alignées sur ce que calcule la simulation ; la pause, l'avance image par image et le ralenti fonctionnent.
6. **Non intrusif** : le test de non-ingérence passe ; le paquet `render` n'importe que l'API publique de `sim-core`.
7. **Ressenti** : vous avez joué à la démo et donné votre avis ; c'est le critère n° 7 de la spec de `sim-core`, enfin vérifiable.

## Décisions prises à la validation

- **Touches par défaut de la démo** : flèches pour le stick, `Z` saut, `X` attaque, `C` spécial, `V` bouclier, `B` saisie, `IJKL` pour le stick droit, `Maj` pour marcher au lieu de dasher ; à la manette, la disposition habituelle du genre.
- **Panneau de réglage** des valeurs de gameplay : dernière phase de ce module.
- **Audio** : reporté après le jalon jouable, dans une phase à planifier séparément.
- **Mannequins** : formes simples et couleurs franches par joueur.

## Phase audio

> Statut : **APPROUVÉE le 2026-11-13**. Plan : [tasks/render/audio-plan.md](tasks/render/audio-plan.md), tâches : [tasks/render/audio-todo.md](tasks/render/audio-todo.md). Cette section remplace l'hypothèse 7 et la mention « audio (phase ultérieure) » du périmètre : l'audio entre maintenant dans le module.

### Hypothèses

1. **Tout est généré par le code** (décision de la carte du 2026-11-13) : effets et musiques sont synthétisés en TypeScript, sans fichier audio ni dépendance. Ils passent par une **banque de sons** dont l'interface permettra de brancher plus tard des fichiers d'artiste sans toucher au reste.
2. **Synthèse hors temps réel.** Chaque son est calculé une fois, au chargement, en échantillons (`Float32Array`), par des fonctions pures testables dans Node. En jeu, jouer un son revient à relire un tampon déjà prêt. La musique est calculée de la même façon, en une boucle qui se répète sans couture : un fichier d'artiste la remplacera tel quel.
3. **Le son ne décide de rien**, comme le rendu : il lit la simulation par son API publique (`events`, `readFighter`, `readEntity`) et ne la modifie jamais.
4. **Rollback** : même règle que les effets visuels. Seules les frames nouvelles déclenchent un son, grâce au filtre d'événements existant (`events.ts`) ; une frame re-simulée ne rejoue rien. Un son déclenché par une frame ensuite corrigée aura été joué à tort : approximation acceptée, réévaluée avec `netcode`.
5. **Navigateurs** : le contexte audio n'est créé et démarré qu'à la première action de l'utilisateur (clic, touche, bouton de manette relayé par l'application). Avant, rien ne joue et rien n'est mis en attente : un coup d'il y a dix secondes n'a pas à sonner.
6. **Hors périmètre** : voix et annonceur, sons de menus, musique adaptative (qui change avec l'action), sons propres à chaque personnage ou à chaque type d'objet (prévus par la banque, pas produits maintenant), réglages de son enregistrés dans un compte.

### Ce qu'on entend

| Moment | Source dans la simulation | Son |
|---|---|---|
| Coup porté | `EV_HIT` ; force lue dans le hitlag de la victime (4 à 20 frames, croît avec les dégâts) | Trois sons : faible, moyen, fort |
| Coup bloqué | `EV_SHIELD` | Choc métallique bref |
| Parade | `EV_PARRY` | Tintement clair et montant |
| Bris de bouclier | `EV_SHIELD_BREAK` | Éclat de verre et chute grave |
| KO | `EV_KO` | Détonation grave et souffle |
| Saisie | `EV_GRAB` | Claquement sourd |
| Accroche au rebord | `EV_LEDGE` | Petit claquement sec |
| Saut | Passage de `A_JUMPSQUAT` à un état en l'air | Glissando montant court |
| Double saut | `jumpsLeft` qui diminue en l'air | Glissando plus aigu, plus aérien |
| Atterrissage | Passage d'en l'air au sol (hors rebord et réapparition) | Bruit sourd léger |
| Apparition d'un projectile ou d'un objet | Emplacement d'entité nouvellement occupé | « Pew » bref |
| Destruction d'un projectile ou d'un objet | Entité disparue avant la fin de sa durée de vie | Petit éclatement |
| Combat | Musique du stage, en boucle | Une musique originale maintenant (stage de test), une par stage à terme |

Les sons qui ne sont pas des événements de `sim-core` (saut, atterrissage, entités) sont déduits des changements d'état entre deux frames nouvelles. Aucune modification de `sim-core` n'est demandée.

Chaque son est légèrement panoramiqué selon la position horizontale de son auteur sur le stage, et sa hauteur varie un peu d'une fois à l'autre (± 4 %), pour éviter l'effet mitraillette.

### Volumes et réglages

- Trois niveaux : général (coupure du son), effets, musique ; effets et musique de 0 à 1, avec une courbe perceptive (le milieu du curseur sonne à peu près moitié moins fort, pas à peine moins fort).
- Le module reçoit et rend les réglages ; c'est l'application qui les enregistre (la démo dans `localStorage`, `app-shell` plus tard dans ses options).
- En pause, la musique s'efface en douceur et reprend à la reprise ; les effets restent audibles, pour que l'avance image par image fasse entendre chaque son.

### API publique (ajout)

```ts
export interface AudioSettings {
  /** Faux : aucun son. */
  readonly enabled: boolean;
  /** De 0 à 1. */
  readonly effects: number;
  readonly music: number;
}

export interface GameAudioOptions {
  /** Par défaut, la banque synthétisée. */
  readonly bank?: SoundBank;
  readonly settings?: AudioSettings;
}

export function createGameAudio(options?: GameAudioOptions): GameAudio;

export interface GameAudio {
  /** À appeler depuis un gestionnaire d'action de l'utilisateur : crée et démarre le contexte audio. */
  unlock(): void;
  /** `locked` avant `unlock`, `loading` tant que la banque se prépare, puis `running`. */
  readonly state: 'locked' | 'loading' | 'running' | 'closed';
  /**
   * À appeler après chaque `step`, comme `Renderer.capture`. Une frame déjà vue ne rejoue rien ;
   * une nouvelle simulation (autre objet `Sim`) repart d'un filtre neuf.
   */
  capture(sim: Sim): void;
  /** Démarre la musique `track` en boucle (identifiant de la banque), `null` l'arrête. */
  playMusic(track: string | null): void;
  /** Efface la musique en pause, la rétablit ensuite. */
  setPaused(paused: boolean): void;
  /** Joue le son `sound` (`SND_*`) au centre : planche d'écoute, menus. */
  play(sound: number): void;
  readonly settings: AudioSettings;
  setSettings(settings: AudioSettings): void;
  /** Sons d'effets lancés depuis la création : pour les tests et la vue technique. */
  readonly soundsPlayed: number;
  /** Ferme le contexte audio. */
  dispose(): void;
}

/** Source des sons et des musiques : synthèse aujourd'hui, fichiers d'artiste demain. */
export interface SoundBank {
  /** Prépare les sons ; peut être long (synthèse, téléchargement), n'attend pas le déverrouillage. */
  load(): Promise<void>;
  /** Échantillons du son `id` (`SND_*`), ou `null` s'il manque : il est alors muet. */
  sound(id: number): SoundData | null;
  /** Musique `track`, ou `null`. */
  music(track: string): MusicData | null;
  /** Musiques disponibles. */
  readonly tracks: readonly string[];
}

export interface SoundData {
  readonly sampleRate: number;
  /** Un canal (mono) ou deux (stéréo). */
  readonly channels: readonly Float32Array[];
}

export interface MusicData extends SoundData {
  /** Boucle, en secondes : la lecture reprend à `loopStart` quand elle atteint `loopEnd`. */
  readonly loopStart: number;
  readonly loopEnd: number;
}
```

Une banque de fichiers d'artiste implémentera la même interface : elle téléchargera et décodera ses fichiers dans `load()` (un `OfflineAudioContext` décode sans action de l'utilisateur) et rendra leurs échantillons. Rien d'autre ne change.

L'objet audio est indépendant du renderer : il vit aussi longtemps que la page (le déverrouillage ne se fait qu'une fois), alors que le renderer est recréé avec chaque simulation. L'application appelle `audio.capture(sim)` à côté de `renderer.capture(sim)`. `renderer.ts` n'est pas modifié ; `index.ts` gagne quelques lignes d'export.

### Budget

- **Voix en réserve** : 24 voix créées au déverrouillage (chacune un gain et un panoramique), réutilisées ; quand toutes sont prises, la plus ancienne de priorité inférieure ou égale est coupée. Un même son ne démarre pas plus de deux fois par frame (16 entités qui apparaissent ensemble font deux sons, pas seize).
- **Allocation** : jouer un son ne crée aucun objet JavaScript, à une exception imposée par Web Audio : le nœud de lecture (`AudioBufferSourceNode`) ne sert qu'une fois par conception, il en faut un par son joué. C'est un objet natif léger ; la croissance du tas reste mesurée par le test de performance.
- `capture` audio : moins de 0,1 ms par frame à 8 combattants ; la synthèse de la banque se fait au chargement, découpée en tranches pour ne pas figer la page ; la mesure de performance de la démo tourne **son actif** et garde ses seuils.

### Fichiers

```
packages/render/src/audio/
  cues.ts     → identifiants des sons, choix du son par événement, sons déduits des changements d'état (pur)
  synth.ts    → primitives de synthèse : oscillateurs, bruit, enveloppes, filtres (pur)
  sounds.ts   → une recette par son (pur)
  music.ts    → composition et rendu de la boucle musicale (pur)
  bank.ts     → interface SoundBank, banque synthétisée
  mixer.ts    → réserve de voix, courbe de volume, panoramique (pur)
  audio.ts    → assemblage Web Audio : contexte, bus, voix, déverrouillage, musique
apps/demo/src/sound.ts → panneau de volume et planche d'écoute de la démo
```

### Tests

| Niveau | Quoi |
|---|---|
| Unitaire | Choix du son par événement et par force ; sons déduits (saut, double saut, atterrissage, entités) sur une vraie simulation ; **frames rejouées après un rollback : aucun son en double** ; nouvelle simulation |
| Unitaire | Synthèse : chaque son est non vide, fini, sans saturation, de durée bornée, distinct des autres ; même résultat d'un appel à l'autre |
| Unitaire | Musique : longueur exacte de la boucle, notes dans la gamme, raccord sans couture, pas de saturation, déterministe |
| Unitaire | Réserve de voix, plafond par frame, courbe de volume, panoramique |
| Intégration | Assemblage sur un faux contexte audio : rien ne joue avant `unlock`, rollback sans son en double, réglages et coupure appliqués, banque remplacée par une autre sans autre changement |
| Fumée | Démo : panneau de volume présent, son actif après un clic, aucune erreur de console |
| Performance | Mesure existante, son actif, seuils inchangés |
| Écoute | **Humaine** : justesse et agrément des sons et de la musique ne se testent pas. Planche d'écoute dans la démo pour juger chaque son isolément |

### Limites (en plus de celles du module)

- **Toujours** : garder le code audio dans `packages/render/src/audio/` ; signaler dans le compte rendu tout ce qui n'a été vérifié qu'à l'oreille ou pas du tout.
- **Demander d'abord** : ajouter une dépendance ; utiliser un fichier audio externe.
- **Jamais** : reprendre une mélodie, un thème ou un son d'un jeu ou d'une œuvre existants ; jouer un son pour une frame re-simulée.
