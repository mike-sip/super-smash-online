# Plan : audio du module `render`

> Statut : **PROPOSÉ le 2026-11-13**, en attente d'approbation. Spec : [SPEC-render.md, « Phase audio »](../../SPEC-render.md#phase-audio). Tâches détaillées : [audio-todo.md](audio-todo.md). Fait suite au point de contrôle D du [plan du module](plan.md).

## Approche

**Pur d'abord, audible ensuite.** Tout ce qui décide d'un son (quel son, quand, à quelle force) et tout ce qui le fabrique (synthèse, musique) s'écrit en fonctions pures, développées par les tests dans Node, sans navigateur. La couche Web Audio, qui ne fait que relire des tampons prêts, reste mince et se teste sur un faux contexte audio. L'écoute réelle se fait dans la démo, avec une planche d'écoute pour juger chaque son isolément.

Le code vit dans `packages/render/src/audio/` ; en dehors, seuls `index.ts` (exports) et la démo sont touchés. `renderer.ts` et `sim-core` ne le sont pas, ce qui évite les conflits avec les modules menés en parallèle.

## Composants et dépendances

```
E1 indices sonores (quel son, quand ; rollback)   ─┐
E2 synthèse des effets ─┐                          │
E3 musique ─────────────┴─ E4 banque de sons ──────┴─ E5 moteur Web Audio ─ E6 démo (panneau, planche, perf)
                                                                                   ← point de contrôle E
```

## Phases et point de contrôle

| Tâches | Ce qui est livré |
|---|---|
| E1 | La liste des sons à jouer à chaque frame, sans doublon après rollback, testée sur une vraie simulation |
| E2 à E4 | Les 14 effets et une musique de combat, calculés par le code, derrière l'interface de banque |
| E5 | L'assemblage : déverrouillage, voix en réserve, bus effets et musique, coupure, pause |
| E6 | La démo qui sonne, avec panneau de volume et planche d'écoute ; mesure de performance son actif |

**Point de contrôle E** : vous écoutez la démo et la planche, et donnez votre avis sur chaque son et la musique. C'est le seul juge possible : je fournis tests et mesures, pas un verdict sur l'agrément.

## Séquentiel ou parallèle

E1, E2 et E3 sont indépendantes (fichiers distincts) ; elles seront faites l'une après l'autre dans cette session, le gain du parallèle étant faible à cette échelle. E4 à E6 suivent dans l'ordre.

## Choix proposés (à corriger maintenant si besoin)

1. **Style musical** : électro énergique façon arcade, 150 battements par minute, tonalité mineure, boucle de 16 mesures (environ 26 secondes) : intro de batterie et basse, thème, variation, pont. Composée par un algorithme à graine (progression d'accords, basse, mélodie à motifs répétés), donc une autre graine et d'autres paramètres donneront la musique d'un autre stage.
2. **Pause** : la musique s'efface, les effets restent audibles (avance image par image). Au ralenti, la musique garde sa vitesse.
3. **Panneau de la démo** : bouton « Son (S) » dans la barre d'outils, avec coupure, deux curseurs, l'état du son (« cliquez pour activer le son ») et la planche d'écoute. Réglages enregistrés dans `localStorage`.
4. **Fréquence d'échantillonnage** de la synthèse : 44 100 Hz ; le navigateur rééchantillonne si sa carte son tourne à 48 000 Hz.

## Risques et parades

| Risque | Parade |
|---|---|
| Je ne peux pas écouter : un son peut être juste sur le papier et désagréable à l'oreille | Tests objectifs (durée, niveau, absence de saturation, sons distincts) ; planche d'écoute ; votre avis au point de contrôle, et des recettes de sons courtes et paramétrées pour les retoucher vite |
| Une musique générée peut ressembler par hasard à une œuvre existante | Progressions d'accords génériques (non protégeables), mélodie tirée au hasard sous contraintes, aucune œuvre prise comme modèle ; à vous de signaler une ressemblance à l'écoute |
| Calculer 26 secondes de musique stéréo fige la page | Rendu découpé en tranches, rendant la main au navigateur entre deux ; durée mesurée et rapportée |
| Mémoire : la boucle musicale pèse environ 9 Mo en échantillons, plus sa copie dans le tampon Web Audio | Acceptable sur ordinateur ; la banque peut libérer ses échantillons une fois copiés si cela devient gênant |
| Web Audio impose un nœud de lecture neuf par son joué | Seule allocation par son, objet natif léger ; tout le reste (voix, gains, panoramiques) est en réserve ; croissance du tas mesurée son actif par le test de performance |
| Trop de sons simultanés à 8 joueurs et 16 entités : cacophonie et coût | 24 voix au plus, priorité par son, au plus deux départs du même son par frame |
| Sons déduits (saut, atterrissage) faux dans un cas limite de la machine à états | Tests sur une vraie simulation : saut, short hop, double saut, atterrissage, accroche puis remontée, réapparition |
| Le test de fumée et la mesure tournent sans fenêtre : le son peut y être bloqué | Un clic Playwright compte comme action de l'utilisateur ; le test vérifie l'état `running` et le rapport l'indique |
| Ce que le rollback corrige a déjà sonné | Approximation acceptée par la spec, comme pour les effets visuels ; à réévaluer avec `netcode` |

## Prérequis

Aucun : Web Audio est natif dans les navigateurs cibles ; aucune dépendance ajoutée.
