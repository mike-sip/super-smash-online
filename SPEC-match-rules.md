# Spec : `match-rules` — règles de match

> Statut : **APPROUVÉE le 2026-11-13.** Plan : [tasks/match-rules/plan.md](tasks/match-rules/plan.md), tâches : [tasks/match-rules/todo.md](tasks/match-rules/todo.md). Module de la [carte des capacités](CAPABILITY-MAP.md). Dépend de : `sim-core` (implémenté). Demande des **ajouts additifs à `sim-core`** (section dédiée plus bas), accordés le 2026-11-13.

## Hypothèses

1. **Les règles de match font partie de la simulation.** Stocks, chronomètre, jauges, réapparitions et fin de partie influencent le combat (qui réapparaît, qui peut lancer l'ultime) : ils doivent être déterministes et revenir à l'identique après un rollback. Ils vivent donc dans l'état sauvegardé par `saveState`, sont comptés par `checksum`, et tournent à chaque `step`, y compris quand `netcode` re-simule.
2. **Bibliothèque pure, mêmes règles que `sim-core`** : virgule fixe, aucune allocation pendant une frame, aucune API non déterministe (même règle de lint), joueurs traités par index croissant.
3. **Contenu fourni par d'autres** : le coup de l'attaque ultime est défini par `fighters` ; les objets apparaissent par `stages-items`. Ce module gère la **jauge** et l'**autorisation** de l'ultime, et transmet le réglage des objets sans l'interpréter.
4. **La configuration d'un match est une donnée** : un objet JSON versionné et validé, que le futur `lobby` transmettra tel quel à chaque pair. Le choix des personnages et du stage n'en fait pas partie : c'est le contenu, que `lobby` transmettra à côté.
5. **Valeurs du genre, chiffres propres** : délais, invincibilité et remplissage de la jauge sont des valeurs de départ, réglables, choisies pour un ressenti proche du genre.

## Objectif

Transformer un combat sans fin en match : modes Stock, Temps et Endurance, en chacun pour soi ou en équipes, de 2 à 8 joueurs, avec réapparition, attaque ultime, fin de match, égalités départagées par mort subite, et résultats exploitables par le futur module `ranking`.

**Consommateurs** : `lobby` (construit la configuration), `netcode` (re-simule sans rien savoir des règles), `render` (HUD de match), `ranking` (résultats), la démo aujourd'hui et `app-shell` demain.

**Succès** : on choisit un mode et des équipes dans la démo, on joue un match qui se termine selon les règles, l'écran de résultats donne le bon classement ; deux exécutions de la même séquence d'inputs donnent le même match au bit près, rollback compris.

### Périmètre fonctionnel

| Domaine | Inclus |
|---|---|
| Modes | **Stock** (N vies, dernier debout), **Temps** (score = KO marqués − chutes, au coup de sifflet), **Endurance** (points de vie ; à zéro, KO ; avec N vies, 1 par défaut) |
| Limite de temps | Obligatoire en Temps ; facultative en Stock et Endurance |
| Équipes | Chacun pour soi, ou de 2 à 4 équipes ; tir allié réglable (coups, projectiles et saisies) |
| Réapparition | Délai après un KO, retour au point d'apparition, invincibilité de réapparition ; élimination quand les vies sont épuisées |
| Attribution des KO | Le dernier attaquant est crédité s'il a touché la victime dans les 8 s précédentes ; sinon c'est une autodestruction. KO par un coéquipier : chute sans crédit |
| Attaque ultime | Jauge par joueur, remplie par les dégâts infligés et subis ; pleine, elle autorise l'ultime ; vidée à son déclenchement ; désactivable |
| Fin de match | Dernier joueur ou dernière équipe en vie, ou fin du temps ; égalités départagées puis mort subite |
| Résultats | Classement (ex æquo possibles), gagnants, statistiques par joueur |
| HUD | Chronomètre, vies, points de vie, score, jauge d'ultime, couleur d'équipe (dans `render`) |
| Démo | Choix du mode, des réglages et des équipes ; écran de résultats ; rejouer |

**Hors périmètre** : compte à rebours de départ (« 3, 2, 1 ») et pause en ligne (`app-shell`), apparition des objets (`stages-items`), coup de l'ultime (`fighters`), recoloration des mannequins par équipe (`render`, voir questions), partage de vies entre coéquipiers, plateforme de réapparition mobile, éjection réduite propre à l'Endurance.

## Frontière avec `sim-core` (à approuver)

Deux options ont été étudiées :

| | **A. Crochet dans `sim-core` (recommandée)** | B. Couche au-dessus, état séparé |
|---|---|---|
| Principe | `sim-core` appelle les règles à la fin de chaque `step` ; leur état occupe une zone réservée du tampon d'état | `match-rules` enveloppe `step` et possède son propre tampon |
| Rollback | Automatique : `saveState`, `loadState`, `checksum` couvrent déjà tout | `netcode` doit sauvegarder deux tampons et appeler `stepMatch` au lieu de `step` |
| Impact sur `netcode` (en cours) | Aucun, sauf `STATE_BYTES` qui grandit | Interface générique à négocier avant la fusion |
| Impact sur `sim-core` | Additif : un crochet facultatif, une zone de 256 mots | Moindre, mais les points 3 à 6 ci-dessous restent nécessaires |

Les points 3 à 6 sont nécessaires dans les deux options, car `sim-core` doit les connaître **pendant** le `step` (qui peut frapper qui, qui est invincible, qui peut lancer l'ultime).

### Ajouts à `sim-core` demandés (tous additifs et facultatifs)

1. **Crochet de règles** : `SimConfig.rules?: SimRules`, avec `init(sim)` appelé à la fin de `createSim` et `afterStep(sim)` appelé à la fin de chaque `step`, après l'incrément de frame. Sans `rules`, rien ne change.
2. **Zone d'état réservée** : `RULES_WORDS = 256` mots Int32 à la fin du tampon, exposés par `rulesState(sim): Int32Array`. `sim-core` ne l'interprète jamais. `STATE_BYTES` passe de 2 764 à environ 3 900 octets et reste une constante.
3. **Équipes** : `SimConfig.teams?: readonly number[]` et `SimConfig.teamAttack?: boolean` (vrai par défaut). Sans tir allié, coups, entités (d'après leur propriétaire) et saisies ignorent les coéquipiers.
4. **Invincibilité de réapparition** : champ `invincible` (frames restantes), `respawn(sim, player, invincibleFrames = 0)`, `FighterView.invincible`. Il protège comme `intangible` mais aucune esquive ni remontée ne l'écrase.
5. **KO et dégâts imposés** : `knockOut(sim, player)` (Endurance, émet `EV_KO`) et `setDamage(sim, player, value)` (mort subite).
6. **Attaque ultime** : emplacement `M_ULTIMATE = 20` (`MOVE_SLOTS` passe à 21), champ `ultimateReady`, `setUltimateReady(sim, player, ready)`, événement `EV_ULTIMATE`, `FighterView.ultimateReady`. Le combattant de test de `sim-core` reçoit une ultime provisoire pour les tests et la démo.

Conséquences : la disposition mémoire change, donc **tous les checksums de référence de `sim-core` sont régénérés**, dans un commit dédié (puis de nouveau à la fusion, comme prévu par la carte). Aucun comportement existant ne change : les scénarios et le test de rollback de `sim-core` doivent passer sans modification.

### Interface avec `fighters` (attaque ultime)

- `fighters` fournit le coup : `FighterDef.moves[M_ULTIMATE]`, un `MoveDef` ordinaire.
- Déclenchement : si `ultimateReady` vaut 1, un **spécial neutre** lance `M_ULTIMATE` au lieu de `M_NSPECIAL`, au sol comme en l'air, partout où une attaque peut partir. `sim-core` remet le drapeau à 0 et émet `EV_ULTIMATE` (`a` = joueur) ; `match-rules` vide alors la jauge.
- Un combattant sans `moves[M_ULTIMATE]` garde son spécial neutre normal ; sa jauge reste pleine.
- Proposition envoyée à la session `fighters` ; tout besoin supplémentaire (intangibilité pendant le coup, élan) s'ajoutera au `MoveDef`.

## Stack technique

| Élément | Choix |
|---|---|
| Paquet | `@game/match-rules`, TypeScript 7, mêmes réglages que `sim-core` |
| Tests | Vitest |
| Dépendances d'exécution | `@game/sim-core` uniquement |
| HUD | Nouveau fichier dans `render`, qui **ne dépend pas** de `match-rules` (il reçoit une vue de données) |

## Commandes

```
Tests :           pnpm --filter @game/match-rules test
Déterminisme :    pnpm --filter @game/match-rules test:determinism
Checksums réf. :  pnpm --filter @game/match-rules golden:update
Benchmark :       pnpm --filter @game/match-rules bench
Types :           pnpm --filter @game/match-rules typecheck
Lint :            pnpm lint --fix
Démo :            pnpm --filter @game/demo dev
```

## Structure du projet

```
packages/match-rules/
  src/
    index.ts        → API publique
    config.ts       → type MatchConfig, valeurs par défaut, validation
    layout.ts       → disposition de la zone réservée (index des mots)
    rules.ts        → crochet afterStep : KO, réapparition, chronomètre, jauge, fin
    outcome.ts      → départage, mort subite, classement (logique pure)
    view.ts         → readMatch (HUD, sans allocation) et matchResult (résultats)
  test/             → unitaires et scénarios
  test/determinism/ → séquences de référence, checksums attendus, rollback
  bench/            → coût du crochet
packages/render/src/match-hud.ts   → HUD de match (nouveau fichier, export ajouté dans index.ts)
apps/demo/src/match-setup.ts       → choix du mode et des équipes
apps/demo/src/results.ts           → écran de résultats
```

## API publique (contrat)

```ts
export type MatchMode = 'stock' | 'time' | 'stamina';

/** Ce que `lobby` transmettra : JSON pur, versionné. */
export interface MatchConfig {
  readonly version: 1;
  readonly mode: MatchMode;
  /** Vies par joueur, de 1 à 99. Ignoré en Temps. */
  readonly stocks: number;
  /** Secondes ; 0 = sans limite (interdit en Temps). De 30 à 3 600 sinon. */
  readonly timeLimit: number;
  /** Points de vie en Endurance, de 1 à 999. */
  readonly stamina: number;
  readonly teams: boolean;
  /** Tir allié : les coéquipiers se blessent. */
  readonly teamAttack: boolean;
  /** Jauge d'attaque ultime active. */
  readonly ultimate: boolean;
  /** Transmis à `stages-items`, non interprété ici. */
  readonly items: { readonly enabled: boolean; readonly frequency: 'low' | 'medium' | 'high' };
  /** De 2 à 8 joueurs. `team` de 0 à 3, ignoré sans équipes. */
  readonly players: readonly { readonly team: number }[];
}

export function defaultMatchConfig(mode: MatchMode, players: number): MatchConfig;
/** Valide une valeur reçue (réseau, formulaire). N'accepte aucun champ inconnu. */
export function validateMatchConfig(value: unknown):
  | { ok: true; config: MatchConfig }
  | { ok: false; errors: string[] };

/** Construit la SimConfig d'un match : crochet de règles, équipes, tir allié. Lève si invalide. */
export function createMatchSimConfig(match: MatchConfig, content: {
  stage: StageDef; fighters: readonly FighterDef[]; entities?: readonly EntityDef[]; seed: number;
}): SimConfig;

/** Lecture pour le HUD, à chaque image, sans allocation. */
export function createMatchView(): MatchView;
export function readMatch(sim: Sim, out: MatchView): void;

/** Résultats, une fois le match terminé ; `null` avant. Alloue : à appeler une fois. */
export function matchResult(sim: Sim): MatchResult | null;

export interface MatchResult {
  readonly config: MatchConfig;
  readonly endFrame: number;
  readonly reason: 'last-standing' | 'time' | 'sudden-death';
  /** Joueurs classés premiers (plusieurs en équipe). */
  readonly winners: readonly number[];
  readonly winningTeam: number | null;
  readonly players: readonly PlayerResult[];
}

export interface PlayerResult {
  readonly team: number;
  /** 1 = premier ; les ex æquo partagent la place. En équipes, la place de l'équipe. */
  readonly placement: number;
  readonly kos: number;
  readonly falls: number;
  readonly selfDestructs: number;
  /** Score du mode Temps (KO − chutes), calculé dans tous les modes. */
  readonly score: number;
  readonly damageDealt: number;
  readonly damageTaken: number;
  readonly stocksLeft: number;
  readonly ultimatesUsed: number;
  /** Frame d'élimination, ou -1. */
  readonly eliminatedAt: number;
}
```

`MatchView` expose, par joueur, dans des tableaux typés réutilisés : vies, points de vie, score, jauge (0 à 1), ultime prête, équipe, éliminé, frames avant réapparition, invincible ; et globalement : phase (`playing`, `sudden-death`, `over`), secondes restantes ou -1.

Le HUD de `render` (`createMatchHud(overlay, players)` puis `update(view)`) définit sa propre interface de données, compatible avec `MatchView` par sa forme : `render` n'importe pas `match-rules`.

## Règles détaillées

| Règle | Valeur |
|---|---|
| Valeurs par défaut | Stock : 3 vies, 7 min. Temps : 3 min. Endurance : 150 PV, 1 vie, sans limite |
| Délai de réapparition | 90 frames (1,5 s) après le KO |
| Invincibilité de réapparition | 120 frames (2 s), affichée par le rendu comme l'intangibilité |
| Fenêtre de crédit d'un KO | 480 frames (8 s) depuis le dernier coup reçu ; effacée à la réapparition |
| Dégâts infligés à plusieurs | Une hausse de dégâts frappée par plusieurs attaquants dans la même frame est partagée à parts égales (division entière, reste au plus petit index) |
| Jauge d'ultime | 100 points : +1 par % infligé, +0,5 par % subi ; conservée après une chute ; vidée par `EV_ULTIMATE` |
| Endurance | PV = PV max − dégâts ; à 0, KO immédiat (`knockOut`) ; une sortie de zone limite est aussi un KO |
| Fin en Stock / Endurance | Il ne reste qu'un joueur, ou qu'une équipe, avec des vies |
| Fin du temps | Stock / Endurance : plus de vies, puis moins de dégâts (plus de PV) ; Temps : meilleur score (somme de l'équipe en équipes) |
| Égalité à la première place | Mort subite entre les ex æquo : 1 vie, 300 % (1 PV en Endurance), sans limite de temps ; les autres sont éliminés et gardent leur rang. Élimination simultanée des derniers : de nouveau mort subite |
| Classement | Stock / Endurance : par ordre d'élimination inverse (même frame = ex æquo) ; Temps : par score ; mort subite : vainqueur 1ᵉʳ, autres participants 2ᵉˢ |
| Après la fin | Le crochet ne modifie plus rien ; la simulation peut continuer à tourner (animation de fin) |

## Style de code

```ts
// Zone réservée : un index par valeur, comme state.ts dans sim-core.
export const W_PHASE = 0;
export const W_FRAMES_LEFT = 1;
export const P_STOCKS = 16; // + joueur * PLAYER_STRIDE

export function tickRespawn(r: Int32Array, sim: Sim, i: number): void {
  const at = P_BASE + i * PLAYER_STRIDE;
  const wait = r[at + P_RESPAWN]!;
  if (wait === 0) return;
  r[at + P_RESPAWN] = wait - 1;
  if (wait === 1) respawn(sim, i, RESPAWN_INVINCIBLE_FRAMES);
}
```

Conventions : celles de `sim-core` (pas de classes ni d'exceptions dans le crochet, aucune allocation, entiers uniquement, tableaux typés). La validation de configuration et `matchResult`, hors du chemin d'une frame, peuvent allouer.

## Stratégie de test

| Niveau | Quoi | Où |
|---|---|---|
| Unitaire | Validation (chaque champ, chaque borne, champs inconnus), départage et classement, partage des dégâts | `test/` |
| Scénario | Matchs scriptés avec le combattant de test : élimination en Stock, fin du temps, Endurance à zéro PV, équipes avec et sans tir allié, crédit et autodestruction, mort subite, jauge remplie puis ultime lancée | `test/scenarios/` |
| `sim-core` | Un scénario par ajout (crochet, zone réservée, équipes, invincibilité, `knockOut`, `setDamage`, ultime) ; tests existants inchangés | `packages/sim-core/test/` |
| Rollback | Propriété `step×N → save → step×M → load → step×M` sur 500 tirages, matchs à 8 joueurs, tous modes, y compris à travers KO, réapparition, mort subite et fin | `test/determinism/` |
| Déterminisme | 3 matchs de référence à 8 joueurs (un par mode, dont un en équipes), checksum final et résultats comparés à une référence versionnée, dans Node | `test/determinism/` |
| Performance | Coût du crochet à 8 joueurs, aucune allocation en régime établi | `bench/` |
| HUD | Mise à jour minimale du DOM, comme le HUD actuel | `packages/render/test/` |
| Démo | Test Playwright dans Edge : choix d'un mode, match court jusqu'à l'écran de résultats | `apps/demo/test/` |

Tests écrits avant la logique pure, comme dans `sim-core`.

## Limites

- **Toujours** : tests, typecheck et lint avant chaque commit ; scénario avant la règle ; régénérer les checksums de référence dans un commit dédié et expliqué.
- **Demander d'abord** : tout ajout à `sim-core` au-delà de la liste ci-dessus ; une dépendance ; modifier un fichier existant de `render` au-delà de l'export du HUD.
- **Jamais** : changer le sens d'un champ ou d'une fonction existante de `sim-core` ; importer ses fichiers internes ; mettre une règle de match dans `render` ; toucher `packages/render/src/audio/` ; modifier la ligne « Specs existantes » de la carte.

## Critères de succès

1. **Modes** : chaque mode, en chacun pour soi et en équipes, se termine selon les règles ci-dessus ; chaque ligne du tableau « Règles détaillées » est couverte par un scénario qui passe.
2. **Rollback** : la propriété sauvegarde/restauration passe sur 500 tirages de matchs à 8 joueurs, à travers KO, réapparitions, mort subite et fin.
3. **Déterminisme** : les 3 matchs de référence donnent les checksums et résultats versionnés dans Node.
4. **Non-régression de `sim-core`** : tous ses tests passent sans modification, hormis les checksums de référence régénérés ; sans `rules`, une simulation se comporte exactement comme avant.
5. **Coût** : le crochet coûte moins de 0,02 ms par frame à 8 joueurs en moyenne, et n'alloue rien en régime établi.
6. **Configuration** : `validateMatchConfig` rejette toute valeur invalide avec un message par erreur, et accepte tout ce que `defaultMatchConfig` produit ; aller-retour JSON sans perte.
7. **HUD et démo** : la démo permet de choisir mode, réglages et équipes, affiche chronomètre, vies ou PV, jauge et équipe, et montre l'écran de résultats ; vérifié par test Playwright et par votre essai.

## Décisions prises à la validation

- **Frontière avec `sim-core`** : option A, crochet de règles et zone d'état réservée.
- **Ajouts à `sim-core`** : tous ceux de la liste sont accordés (équipes et tir allié, invincibilité, `knockOut`, `setDamage`, attaque ultime).
- **Équipes visibles** : dans le HUD de match seulement ; la recoloration des mannequins par équipe touche des fichiers de `render` modifiés par la session audio, elle viendra après sa fusion.
- **Valeurs de départ** : celles du tableau « Règles détaillées ».
