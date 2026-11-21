# Spec : `fighters` — les 4 personnages v1 et l'outillage de leurs données

> Statut : **APPROUVÉE le 2026-11-13, implémentée** (bilan en fin de document ; ressenti des quatre personnages validé par vous). Plan : [tasks/fighters/plan.md](tasks/fighters/plan.md), tâches : [tasks/fighters/todo.md](tasks/fighters/todo.md). Module de la [carte des capacités](CAPABILITY-MAP.md). Dépend de : `sim-core` (contrat `FighterDef`).

## Hypothèses

1. Un personnage est **uniquement des données** : une `FighterDef` de `sim-core`, ses types de projectiles (`EntityDef`) et une description visuelle. Aucune logique de gameplay propre à un personnage n'est écrite dans `fighters` : tout ce qu'un coup fait passe par le moteur.
2. Le moteur actuel ne sait pas exprimer plusieurs coups spéciaux courants du genre (élan propre, chute impuissante, contre, armure, invincibilité, attaque ultime). Je propose plus bas **six extensions additives de `sim-core`**, à valider explicitement. Sans elles, les spéciaux se réduisent à des attaques immobiles et un projectile, et aucun personnage ne peut revenir sur le stage autrement que par ses sauts.
3. **Ordre imposé par la carte** : le personnage de référence (le polyvalent) est terminé, réglé et validé par vous dans la démo, avant que je commence les trois autres. Les extensions de `sim-core` sont toutes faites avant lui, pour que ses quatre spéciaux soient complets.
4. **Équilibrage** : les valeurs v1 sont un premier jet cohérent avec le personnage de test et le genre, vérifié par des tests automatiques (identité de chaque archétype, retour sur le stage) et par votre essai. L'équilibrage fin entre les quatre se fera à l'usage, en ligne ; il n'est pas un critère de cette spec.
5. **Visuels** : une variante du mannequin procédural par personnage (proportions, pièces en plus, couleurs). Le mannequin de `render` reçoit pour cela un point d'extension étroit ; l'audio (autre session) n'est pas concerné.
6. La **jauge** de l'attaque ultime appartient à `match-rules`. `fighters` définit le coup ; `sim-core` fournit un drapeau « ultime prête » que `match-rules` lève, et le déclenchement par l'input.

## Objectif

Livrer les 4 personnages jouables de la v1, chacun avec un moveset complet et une identité de jeu nette, et l'outillage qui garantit que leurs données restent valides et lisibles à mesure qu'on les règle.

**Consommateurs** : `sim-core` (exécute les données), `render` (silhouettes, couleurs, durées des poses), `match-rules` et `lobby` (liste des personnages, assemblage de la configuration de match), `netcode` (empreinte des données, pour vérifier que deux pairs jouent les mêmes personnages).

**Succès** : chacun des quatre se reconnaît en jeu à sa silhouette et à sa façon de jouer, chaque coup prévu existe et se déclenche, chacun revient sur le stage depuis une distance raisonnable, et aucune donnée invalide ne peut être commitée sans qu'un test échoue.

### Périmètre fonctionnel

| Domaine | Inclus dans `fighters` |
|---|---|
| Valeurs de mouvement | Marche, dash, course, sauts, gravité, chute, poids, taille, hurtbox, bouclier, esquives, rebords |
| Attaques normales | Jab en 3 temps (ou rafale), 3 tilts, attaque de dash |
| Smash | 3 attaques smash chargeables |
| Aériennes | 5 attaques aériennes avec lag d'atterrissage |
| Spéciaux | 4 coups spéciaux par personnage (neutre, côté, haut, bas), dont au moins un moyen de revenir sur le stage |
| Saisie | Saisie, coup pendant la prise, 4 projections |
| Ultime | 1 attaque ultime par personnage |
| Divers | Attaque de remontée depuis le rebord |
| Projectiles | Types d'entités propres à chaque personnage, renumérotés à l'assemblage du match |
| Visuels | Une description de mannequin par personnage, branchée sur `FighterVisuals` |
| Outillage | Validation automatique des données ; tableau de frame data lisible ; empreinte des données |
| Démo | Choix du personnage de chaque joueur ; bouton « ultime prête » ; affichage du tableau de frame data |

**Hors périmètre** : la jauge d'ultime et son remplissage (`match-rules`), les objets (`stages-items`), les costumes alternatifs, les sons propres à chaque personnage (l'audio pourra s'appuyer sur l'identifiant du personnage plus tard), les modèles d'artiste.

## Les quatre personnages (proposition)

Univers original : quatre voyageurs venus de régions différentes d'un même archipel, chacun lié à un élément. Noms, identités et silhouettes inventés pour ce jeu ; vous pouvez les renommer sans rien changer d'autre (l'identifiant technique est indépendant du nom affiché).

| | **Sorel** — polyvalent (référence) | **Zéphine** — rapide | **Ferroc** — lourd | **Nacre** — zoneur |
|---|---|---|---|---|
| Identité | Messager des vents : arts martiaux mêlés de rafales | Coursière des falaises, acrobate | Forgeron des volcans, bardé de fer | Gardienne des récifs, lance des perles |
| Silhouette | Proportions moyennes, bandeau dont les pans flottent derrière la tête | Fine, jambes longues, longue écharpe | Massive : torse large, épaulières, bras épais, petite tête | Grande et élancée, haute coiffe, avant-bras évasés |
| Couleurs | Bleu ciel et blanc | Vert menthe et anthracite | Brun rouille et orange braise | Turquoise et ivoire nacré |
| Jeu | Tout fait correctement, punit bien, sans point faible marqué | Très mobile, coups faibles mais nombreux, léger donc éjecté tôt | Lent, coups lourds, encaisse sans broncher | Garde l'adversaire à distance, faible au corps à corps |

La couleur du joueur (rouge, bleu, jaune…) reste visible sur une pièce du mannequin (le bandeau, l'écharpe, les épaulières, la coiffe) et sur l'étiquette du HUD : deux joueurs qui prennent le même personnage restent distincts.

### Valeurs cibles par archétype

Repère : le combattant de test de `sim-core` (poids 100, taille 12, course 1,7, vitesse aérienne 1,2, gravité 0,09, 1 saut aérien). Les valeurs finales peuvent bouger au réglage ; ce sont les **écarts entre personnages** que les tests vérifient.

| | Sorel | Zéphine | Ferroc | Nacre |
|---|---|---|---|---|
| Poids | 100 | 82 | 132 | 92 |
| Taille | 12 | 11 | 15 | 13 |
| Course | 1,75 | 2,3 | 1,35 | 1,5 |
| Vitesse aérienne | 1,15 | 1,35 | 0,95 | 1,05 |
| Gravité / chute max | 0,09 / 1,65 | 0,10 / 1,9 | 0,11 / 1,8 | 0,075 / 1,4 |
| Sauts aériens | 1 | 2 | 1 | 1 |
| Pré-saut | 3 | 3 | 5 | 3 |
| Bouclier | 50 | 45 | 60 | 50 |

Règles d'identité vérifiées par test : Zéphine a la course, la vitesse aérienne et le dash les plus rapides et le poids le plus faible ; Ferroc a le poids le plus élevé, les coups les plus forts (meilleure éjection de smash avant) et les démarrages les plus lents ; Nacre a la plus grande portée et les seuls projectiles à plus de 60 unités ; Sorel n'est ni premier ni dernier sur aucune de ces mesures.

### Coups spéciaux

| | Neutre | Côté | Haut (retour) | Bas | Ultime |
|---|---|---|---|---|---|
| **Sorel** | *Trait de vent* : projectile droit, vitesse moyenne | *Ruée* : fente vers l'avant, coup à l'arrivée | *Spirale* : ascension en tourbillon, coups multiples, puis chute impuissante | *Contre* : riposte automatique si frappé pendant la garde | *Tempête* : tourbillon autour de lui, coups multiples puis éjection forte |
| **Zéphine** | *Plumes* : petit projectile rapide, courte portée | *Fente* : traversée rapide qui frappe au passage | *Envol* : bond en diagonale, très rapide, peu de dégâts | *Piqué* : en l'air, coup de pied plongeant ; au sol, glissade | *Mille rafales* : traversée du stage, coups multiples |
| **Ferroc** | *Bélier* : coup de poing chargeable, avec armure pendant la charge | *Rempart* : charge à l'épaule, avec armure | *Geyser* : montée lente, dernier coup très fort | *Séisme* : en l'air, chute lourde ; au sol, onde des deux côtés | *Fournaise* : frappe au sol énorme, des deux côtés |
| **Nacre** | *Perle* : projectile droit rapide, longue portée | *Galet* : projectile en cloche qui rebondit | *Écume* : montée en spirale, coups faibles, puis chute impuissante | *Corail* : pose un piège immobile qui explose au contact | *Grande perle* : énorme projectile lent qui traverse tout |

Les autres coups (jab, tilts, smash, aériennes, projections) suivent les conventions du genre et la personnalité de chacun ; leur détail chiffré est dans le code et dans le tableau de frame data généré, qui est l'artefact à relire.

## Extensions de `sim-core` demandées (accord explicite requis)

Toutes **additives et isolées** : des champs optionnels de `MoveDef`, deux emplacements d'attaque, une action, un événement, un champ d'état. Une `FighterDef` qui n'utilise aucun de ces champs se comporte exactement comme avant (les scénarios existants de `sim-core` le vérifient en restant inchangés). Elles sont faites dans `sim-core`, avec leurs scénarios, dans des commits séparés et étiquetés, avant le premier personnage.

| N° | Extension | Pourquoi | Ce qui change dans `sim-core` |
|---|---|---|---|
| E1 | **Élan d'un coup** : `MoveDef.motion?: MotionDef[]`, fenêtres de frames qui imposent une vitesse horizontale (relative au regard) et/ou verticale | Spéciaux de retour, fentes, plongeons. La carte de `sim-core` le prévoyait (« Spéciaux : pas encore d'élan propre ») | Branche `A_ATTACK` de `movement.ts` ; un coup qui donne une vitesse verticale positive au sol fait décoller |
| E2 | **Chute impuissante** : `MoveDef.helpless?: boolean` et action `A_HELPLESS` (= 31) | Un spécial de retour ne doit pas pouvoir s'enchaîner à l'infini : à sa fin, en l'air, le combattant ne peut plus que dériver et s'accrocher au rebord, jusqu'à l'atterrissage (lag d'atterrissage du coup) | Nouvelle action dans `movement.ts`, accroche au rebord autorisée dans `ledge.ts`, atterrissage dans `collision.ts`. Les tests de plage d'actions existants (`action >= A_LEDGE`, `action >= A_SHIELD`) sont bornés pour exclure la nouvelle valeur, sans changer leur sens |
| E3 | **Invincibilité d'un coup** : `MoveDef.intangible?: { start, end }` | Début des spéciaux de retour, attaque ultime | Branche `A_ATTACK` : intangibilité tenue pendant la fenêtre |
| E4 | **Armure** : `MoveDef.armor?: { start, end, maxKnockback }` | Identité du lourd : un coup reçu dont l'éjection ne dépasse pas le seuil inflige ses dégâts et son gel, mais n'interrompt pas l'attaque | Passe 2 de `hit.ts` |
| E5 | **Contre** : `MoveDef.counter?: { start, end, to }`, emplacements `M_EXTRA1` et `M_EXTRA2` (= 21, 22), événement `EV_COUNTER` (= 8) | Spécial bas de Sorel : frappé pendant la fenêtre, il ne subit rien, se tourne vers l'attaquant et lance la riposte `to` ; l'attaquant reste gelé comme après une parade. Les emplacements libres servent aussi aux suites de coups atteignables par annulation | Passe 2 de `hit.ts`, `moves.ts`, `events.ts` |
| E6 | **Attaque ultime** : emplacement `M_ULTIMATE` (= 20), champ d'état `ultimateReady`, fonction `setUltimateReady(sim, player, ready)`, champ `ultimateReady` de `FighterView`, événement `EV_ULTIMATE` (= 9) | Quand le drapeau est levé, le prochain spécial neutre lance l'ultime à la place et baisse le drapeau. `match-rules` lève le drapeau quand sa jauge est pleine, entre deux `step`, comme il appelle `respawn` | `MOVE_SLOTS` passe de 20 à 23 ; un champ ajouté **à la fin** de la liste des champs par joueur, donc taille de l'état et **tous les checksums de référence changent** (régénérés dans un commit dédié, puis de nouveau à la fusion, comme prévu par la carte) |

Points volontairement laissés de côté, à rouvrir seulement si le ressenti l'exige : orientation du spécial de retour au stick, saisie par un coup spécial (grappin, saisie spéciale), renvoi de projectiles, limitation « une fois par saut » des spéciaux de côté (la chute impuissante en l'air en tient lieu), hurtbox variables par action.

**Assemblage des projectiles, sans toucher à `sim-core`** : `SpawnDef.kind` désigne un index dans la liste globale `SimConfig.entities`. Chaque personnage numérote ses projectiles à partir de 1 ; la fonction `buildMatchConfig` de `fighters` concatène les projectiles des personnages présents (après les entités fournies par le stage et les objets) et renumérote les `kind` dans une copie des `FighterDef`.

## Stack technique

| Élément | Choix |
|---|---|
| Langage | TypeScript 5.x (compilateur 7), mode `strict`, comme les autres paquets |
| Paquet | `@game/fighters`, dépendance d'exécution unique : `@game/sim-core` |
| Tests | Vitest ; Playwright (Edge) pour le test de la démo |
| Dépendances ajoutées | **Aucune** |

## Commandes

```
Tests :              pnpm --filter @game/fighters test
Validation seule :   pnpm --filter @game/fighters validate
Frame data :         pnpm --filter @game/fighters framedata      (régénère FRAMEDATA.md)
Types :              pnpm --filter @game/fighters typecheck
Lint :               pnpm lint
Benchmark :          pnpm --filter @game/fighters bench
Démo :               pnpm --filter @game/demo dev                 (?p1=sorel&p2=ferroc…)
```

## Structure du projet

```
packages/fighters/
  FRAMEDATA.md            → Tableau de frame data généré, versionné (un test vérifie qu'il est à jour)
  src/
    index.ts              → API publique
    roster.ts             → Liste des personnages : identifiant, nom, archétype, données, visuel
    build.ts              → Petits constructeurs de données (hit, move, moveset), comme les fixtures de sim-core
    match.ts              → buildMatchConfig : assemblage de la configuration et renumérotation des projectiles
    validate.ts           → Règles de validation
    framedata.ts          → Calcul des lignes du tableau, rendu Markdown
    fingerprint.ts        → Empreinte stable des données
    characters/
      sorel.ts            → Un fichier par personnage : FighterDef, projectiles, visuel
      zephine.ts
      ferroc.ts
      nacre.ts
  scripts/                → validate.ts, framedata.ts (lancés par node)
  test/                   → Validation, identité des archétypes, scénarios par personnage, frame data à jour
packages/render/src/fighters/
  mannequin.ts            → Point d'extension : createStyledMannequins(styleOf), le défaut inchangé
  poses.ts                → Poses génériques des nouveaux emplacements et de A_HELPLESS
apps/demo/src/
  roster-panel.ts         → Choix du personnage par joueur, bouton « ultime prête », tableau de frame data
```

## API publique (contrat)

```ts
export type FighterId = 'sorel' | 'zephine' | 'ferroc' | 'nacre';
export type Archetype = 'polyvalent' | 'rapide' | 'lourd' | 'zoneur';

export interface Character {
  readonly id: FighterId;
  /** Nom affiché. */
  readonly name: string;
  readonly archetype: Archetype;
  readonly def: FighterDef;
  /** Projectiles du personnage ; `SpawnDef.kind` y renvoie, à partir de 1. */
  readonly entities: readonly EntityDef[];
  readonly look: FighterLook;
}

/** Description du mannequin : pure donnée, sans Three.js. */
export interface FighterLook {
  readonly primary: number;    // couleurs 0xRRGGBB
  readonly secondary: number;
  /** Proportions relatives au mannequin standard (1 = inchangé). */
  readonly build: { torsoWidth: number; limbThickness: number; headSize: number; legLength: number; armLength: number; shoulderWidth: number };
  /** Pièces ajoutées (épaulières, coiffe, écharpe…), dont celle qui porte la couleur du joueur. */
  readonly parts: readonly LookPart[];
}

export const ROSTER: readonly Character[];
export function character(id: FighterId): Character;

/** Assemble une configuration de match : un personnage par joueur, projectiles renumérotés. */
export function buildMatchConfig(options: {
  stage: StageDef;
  players: readonly FighterId[];
  /** Entités du stage et des objets, placées en tête de la liste. */
  entities?: readonly EntityDef[];
  seed: number;
}): SimConfig;

export interface Issue { readonly path: string; readonly message: string }
/** Liste vide si les données sont valides. */
export function validateCharacter(c: Character): Issue[];

export interface FrameDataRow { move: string; slot: number; startup: number; active: string; total: number; damage: string; angle: string; knockback: string; landingLag?: number; notes: string }
export function frameData(c: Character): FrameDataRow[];
export function frameDataMarkdown(roster: readonly Character[]): string;

/** Empreinte 32 bits des données d'un personnage : deux pairs doivent obtenir la même. */
export function fingerprint(c: Character): number;
```

Côté `render`, un seul ajout public : `createStyledMannequins(styleOf: (player: number) => MannequinStyle | undefined): FighterVisualsFactory`. `MannequinStyle` est défini dans `render` ; `FighterLook` lui est compatible par sa forme, sans dépendance entre les deux paquets. La démo fait le lien.

## Règles de validation

Chaque règle produit un message qui nomme le personnage, le coup et le champ fautif.

- **Rien de non fini** : toute valeur numérique est un nombre fini ; toute grandeur `Fx` est un entier (donc exacte en virgule fixe) ; toute durée est un entier ≥ 0.
- **Frames cohérentes** : `1 ≤ start ≤ end ≤ totalFrames` pour chaque hitbox, annulation, fenêtre d'élan, d'armure, de contre et d'invincibilité ; frame de charge avant la première hitbox et différente de la frame d'apparition du projectile ; saisie et projections dans leur durée ; fenêtre d'intangibilité des esquives dans leur durée.
- **Hitbox dans des bornes** : rayon > 0 ; extrémités à moins de 2,5 fois la taille du personnage de ses pieds ; groupe de 0 à 3 ; angle de 0 à 360 ; dégâts de 0 à 60 % par hitbox ; éjection de base et croissance ≥ 0. Hurtbox contenues dans la hauteur du corps.
- **Moveset complet** : les 20 emplacements standard et l'ultime sont remplis ; les coups aériens ont un lag d'atterrissage ; chaque annulation, contre et projectile renvoie à un emplacement ou un type existant ; l'ultime a une fenêtre d'invincibilité.
- **Mouvement plausible** : vitesses et durées strictement positives ; petit saut < grand saut ; chute rapide > chute maximale ; course ≥ marche.
- **Coûts déterministes** : les données de chaque personnage sont figées en profondeur à leur création (`Object.freeze`) ; deux constructions successives ont la même empreinte ; aucun champ n'est absent là où le moteur l'attend.

## Tableau de frame data

Généré depuis les données, jamais écrit à la main. Une section par personnage : valeurs de mouvement, puis une ligne par coup avec démarrage (première frame active), frames actives, durée totale, dégâts par hitbox (avec bonus de charge maximal), angle, éjection de base et croissance, lag d'atterrissage, et une colonne de notes (élan, armure, contre, invincibilité, projectile). Le même calcul alimente le panneau de la démo. Pas d'avantage sur bouclier en v1 : ses constantes sont internes à `sim-core`.

## Style de code

Les données s'écrivent avec de petits constructeurs lisibles, en unités de jeu, convertis en virgule fixe à la construction — comme les fixtures de `sim-core` :

```ts
// Sorel, smash avant : préparation de 13 frames, coup sec, chargeable.
[M_FSMASH, move('Poing-rafale', 46, [
  hit({ frames: [14, 16], shape: [5, 7, 12, 7, 2.5], damage: 16, angle: 38, base: 28, growth: 1.05 }),
], { charge: SMASH_CHARGE })],
```

- Un fichier par personnage, ordonné comme le tableau de frame data (normaux, smash, aériennes, spéciaux, saisie, ultime, mouvement).
- Noms de coups en français, affichés tels quels dans le tableau et la démo.
- Aucune valeur calculée par une fonction flottante non déterministe ; tout passe par `fx()` à la construction, une seule fois.

## Stratégie de test

| Niveau | Quoi | Où |
|---|---|---|
| Extensions `sim-core` | Un scénario par extension (E1 à E6), écrit avant le code ; scénarios existants inchangés ; checksums de référence régénérés dans un commit dédié | `packages/sim-core/test/scenarios/specials.test.ts` |
| Validation | Chaque règle déclenchée par une donnée fautive ; les 4 personnages sans aucun problème | `test/validate.test.ts` |
| Identité | Les règles d'archétype ci-dessus | `test/archetypes.test.ts` |
| Scénarios par personnage | Chaque emplacement se déclenche par son input et touche un adversaire placé devant lui ; projectiles créés et renumérotés ; contre, armure, ultime ; **retour sur le stage** depuis 50 unités au-delà du rebord et 30 sous son niveau avec double saut puis spécial haut | `test/characters/*.test.ts` |
| Assemblage | `buildMatchConfig` avec 8 joueurs, tous personnages et entités de stage ; déterminisme d'une séquence d'inputs aléatoires répétée deux fois ; rollback sauvegarde/restauration avec les 4 personnages | `test/match.test.ts` |
| Outillage | Le tableau versionné est identique au tableau régénéré ; empreinte stable | `test/framedata.test.ts` |
| Rendu | Poses des nouveaux emplacements et de `A_HELPLESS` finies et continues ; un style modifie bien les dimensions et couleurs des pièces | `packages/render/test/` |
| Démo | Playwright dans Edge : choisir un personnage pour J1 recrée la simulation avec lui ; le bouton « ultime prête » permet de lancer l'ultime | `apps/demo/test/` |
| Ressenti | Votre essai manette en main, personnage par personnage | Points de contrôle du plan |

## Limites

- **Toujours** : faire passer validation, tests, typecheck et lint avant chaque commit ; régénérer et commiter le tableau de frame data avec toute modification de données ; garder chaque extension de `sim-core` dans son propre commit.
- **Demander d'abord** : toute extension de `sim-core` au-delà de E1 à E6, ou tout changement de leur forme ; ajouter une dépendance ; changer une constante interne de `sim-core` (formule d'éjection, hitstun) pour régler un personnage ; modifier un fichier de `render` autre que `mannequin.ts`, `poses.ts`, `visual.ts` et `index.ts`.
- **Jamais** : reprendre un nom, un personnage, un coup signature ou un visuel d'un jeu existant ; écrire de la logique de gameplay propre à un personnage hors des données ; modifier la ligne « Specs existantes » de la carte ; toucher à `packages/render/src/audio/`.

## Critères de succès

1. **Moveset complet** : les 4 personnages remplissent les 21 emplacements (20 standard et l'ultime), plus saisie, 4 projections et valeurs de mouvement ; chaque emplacement est déclenché par son input dans un scénario qui passe.
2. **Données valides** : `validateCharacter` ne signale rien pour les 4 ; chaque règle de validation est couverte par un test qui la déclenche.
3. **Identité** : les règles d'archétype passent ; vous reconnaissez chaque personnage à sa silhouette et à sa façon de jouer dans la démo.
4. **Retour sur le stage** : chacun revient au rebord depuis 50 unités au-delà et 30 sous son niveau, dans un scénario automatique.
5. **Déterminisme** : une séquence de 3 600 frames à 8 joueurs mêlant les 4 personnages donne le même checksum à deux exécutions, et passe le test de propriété de rollback.
6. **Performance** : à 8 joueurs avec ces personnages, un `step` reste sous les seuils de `sim-core` (0,25 ms en moyenne, 1 ms au 99ᵉ centile).
7. **Outillage** : le tableau de frame data versionné est à jour (test) et lisible par vous.
8. **Démo** : on y choisit le personnage de chaque joueur, on y lance l'ultime, on y consulte le tableau.
9. **Ressenti** : votre avis positif sur Sorel avant le lancement des trois autres, puis sur l'ensemble.

## Décisions prises à la validation

- **Noms et identités** : Sorel, Zéphine, Ferroc et Nacre, tels que proposés.
- **Extensions de `sim-core`** : E1 à E6 acceptées telles que décrites. Si `match-rules` prévoit son propre mécanisme d'ultime, on choisira l'un des deux à la fusion.
- **Déclenchement de l'ultime** : spécial neutre quand le drapeau `ultimateReady` est levé.

## Écarts et limites constatés pendant l'implémentation

| Sujet | État actuel | Suite prévue |
|---|---|---|
| Trait de vent de Sorel | Durée de vie ramenée de 50 à 27 frames (portée 110 → 59 unités) **après** votre validation du ressenti de Sorel, pour respecter la règle d'identité « seuls les projectiles du zoneur portent au-delà de 60 unités ». | À rejuger en jeu ; si vous préférez l'ancienne portée, c'est la règle d'identité qu'il faut assouplir. |
| Spéciaux de côté | La Ruée (Sorel), la Fente (Zéphine) et le Rempart (Ferroc) ne mettent pas en chute impuissante : la gravité continue d'agir pendant leur élan, ce qui suffit à empêcher le vol plané. La spec disait que la chute impuissante en l'air « en tient lieu ». | À revoir si l'enchaînement côté puis haut rend le retour trop facile. |
| Retour sur le stage | Les quatre reviennent depuis 50 unités au-delà et 30 en dessous (critère), mais aussi depuis 90 et 50 (Sorel et Ferroc par le rebord). C'est généreux, surtout pour un lourd. | Point d'équilibrage à surveiller en ligne. |
| Accroche pendant un spécial | Un combattant ne peut pas s'accrocher au rebord pendant son spécial de retour, seulement pendant la chute impuissante qui suit. | À ajouter (fenêtre d'accroche dans `MoveDef`) si le ressenti l'exige ; ce serait une extension de `sim-core`. |
| Poses | Une pose générique par emplacement (spéciaux, ultime, riposte, chute impuissante), commune aux quatre personnages ; seules silhouettes et couleurs diffèrent. | Poses propres à chaque personnage : demande à part. |
| Projectiles à l'écran | Sphères de `render`, colorées par numéro de type et non par personnage. | Visuels propres aux projectiles : demande à part, côté `render`. |
| `renderer.ts` | Option `fighterVisuals` ajoutée à `RendererOptions`, avec votre accord (fichier hors de ma liste autorisée). | Conflit de fusion éventuel, trivial, avec la session audio. |
| Panneau de réglage de la démo | Ne modifie plus que le personnage de J1 (et les joueurs qui ont le même personnage), au lieu de tous les combattants. | — |
| Test de la démo et manettes réelles | Une vraie manette actionnée pendant les tests prenait la place de J1 ; les pages de test ne voient plus aucune manette, sauf scénario qui en simule une. | — |
| Validation | Elle ne détecte pas un projectile qui apparaît sous la surface du sol : le piège de Nacre le faisait, c'est un scénario qui l'a révélé (corrigé). | — |
| Frame data | Pas d'avantage sur bouclier : ses constantes sont internes à `sim-core`. | À ajouter si `sim-core` les expose. |
| Fusion avec `match-rules` | Les deux branches ont écrit la même interface d'ultime ; `match-rules` s'est aligné (`EV_ULTIMATE` = 9, drapeau remis à zéro par `respawn`). À la fusion, garder celle de `fighters` (`MOVE_SLOTS` = 23). L'ultime provisoire que `match-rules` donne au combattant de test changerait deux tests de `fighters` (voir la note du dossier partagé). | Checksums de référence à régénérer à la fusion. |
| Déterminisme navigateur | Hérité de `sim-core` : vérifié dans Node et Edge ; Firefox et WebKit ne démarrent pas sur cette machine. | Intégration continue. |

## Bilan des critères de succès (2026-11-15)

| N° | Critère | État | Mesure |
|---|---|---|---|
| 1 | Moveset complet, chaque emplacement déclenché par son input | Atteint | 4 × 21 emplacements, plus la riposte de Sorel ; un scénario par emplacement (cible maintenue sur la première hitbox, `EV_HIT` attendu pendant le coup), contre, attaque de rebord, saisie et 4 projections pour chacun. Le harnais a été vérifié capable d'échouer (hitbox jamais active, retour impossible). |
| 2 | Données valides, chaque règle testée | Atteint | `validate` : aucun problème pour les 4 ; 41 tests qui déclenchent chacun une règle (44 tests de validation au total). |
| 3 | Identité des archétypes | Atteint | Éjection du smash avant sur une cible à 100 % : Ferroc 7,21, Sorel 4,70, Nacre 4,32, Zéphine 3,32. Démarrage moyen et allonge testés ; Sorel n'est ni premier ni dernier sur 7 mesures. Les quatre silhouettes vérifiées à l'écran. |
| 4 | Retour sur le stage depuis 50 / 30 | Atteint | Les 4, scénario automatique (voir « Retour sur le stage » ci-dessus). |
| 5 | Déterminisme et rollback | Atteint | 3 600 frames à 8 joueurs mêlant les 4 : même checksum à deux exécutions ; propriété sauvegarde / restauration sur 200 tirages. |
| 6 | Performance | Atteint | `step` à 8 joueurs : 0,0021 ms en moyenne, 0,0045 ms au 99ᵉ centile (seuils 0,25 et 1). |
| 7 | Frame data à jour et lisible | Atteint pour l'outillage | `FRAMEDATA.md` régénéré et vérifié par test ; panneau F dans la démo. Lisibilité : à votre appréciation. |
| 8 | Démo : choix, ultime, frame data | Atteint | Panneau G et `?p1=…`, bouton U, panneau F ; 4 tests Playwright dans Edge. |
| 9 | Ressenti | Atteint | Sorel validé par vous le 2026-11-14 ; Zéphine, Ferroc et Nacre le 2026-11-15 (point de contrôle D). |

Tests au moment du bilan : `sim-core` 335 (+2 ignorés : Firefox, WebKit), `fighters` 169, `render` 104, `input` 175, démo 13. Typecheck et lint passants.
