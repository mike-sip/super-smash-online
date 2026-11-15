# Tâches : audio du module `render`

> Statut : **APPROUVÉ le 2026-11-13**. Plan : [audio-plan.md](audio-plan.md).
>
> Vérification commune à chaque tâche : `pnpm --filter @game/render test`, `pnpm --filter @game/render typecheck` et `pnpm lint` passent.

- [x] **E1 : Indices sonores**
  - Acceptation : identifiants `SND_*` des 14 sons ; choix du son pour chaque événement de `sim-core`, avec trois forces de coup lues dans le hitlag de la victime ; sons déduits des changements d'état entre deux frames nouvelles : saut (sortie de `A_JUMPSQUAT` en l'air), double saut (`jumpsLeft` qui diminue en l'air), atterrissage (en l'air puis au sol, sauf sortie de rebord et réapparition), apparition et destruction anticipée d'une entité ; position horizontale de l'auteur de chaque son, pour le panoramique ; filtre d'événements existant réutilisé ; aucune allocation par frame (sortie dans une file de taille fixe).
  - Vérification : tests unitaires sur une vraie simulation : chaque événement donne son son, coup faible et coup fort distincts, saut, short hop, double saut, atterrissage, accroche et remontée de rebord sans atterrissage, réapparition, entité lancée puis détruite ; **frames rejouées après `loadState` : aucun son en double, puis reprise à la première frame nouvelle** ; nouvelle simulation.
  - Fichiers : `packages/render/src/audio/cues.ts`, `packages/render/test/audio-cues.test.ts`

- [x] **E2 : Synthèse des effets**
  - Acceptation : primitives pures (oscillateurs sinus, triangle, carré et dent de scie, bruit à graine, enveloppes, glissando de hauteur, filtre passe-bas, passe-bande et passe-haut, saturation douce) ; une recette par son ; chaque son normalisé.
  - Vérification : tests unitaires : fréquence d'un oscillateur, réponse des filtres, enveloppe ; pour chaque son : non vide, sans valeur non finie, crête entre 0,5 et 1, durée entre 40 ms et 1,5 s, résultat identique d'un appel à l'autre, sons deux à deux différents ; coup fort plus long et plus grave que coup faible ; temps de calcul de la banque rapporté.
  - Fichiers : `packages/render/src/audio/synth.ts`, `packages/render/src/audio/sounds.ts`, `packages/render/test/audio-synth.test.ts`

- [x] **E3 : Musique**
  - Acceptation : composition à graine (tempo, tonalité, progression d'accords, batterie, basse, mélodie à motifs répétés, structure en quatre parties) produisant une liste de notes ; rendu stéréo de la boucle, la fin des notes qui dépassent la boucle étant reportée au début pour un raccord sans couture ; une musique pour le stage de test.
  - Vérification : tests unitaires : longueur exacte (mesures × temps × 60 / tempo), toutes les notes mélodiques dans la gamme, basse sur les fondamentales des accords, même graine même musique, autre graine autre musique, crête sous 1, aucune valeur non finie, écart de niveau entre la fin et le début de la boucle comparable à l'écart entre deux échantillons voisins ailleurs ; durée de rendu rapportée.
  - Fichiers : `packages/render/src/audio/music.ts`, `packages/render/test/audio-music.test.ts`

- [x] **E4 : Banque de sons**
  - Acceptation : interface `SoundBank`, `SoundData`, `MusicData` de la spec ; `createSynthBank()` calcule effets et musique dans `load()`, découpé en tranches qui rendent la main entre deux ; avant la fin du chargement, `sound` et `music` rendent `null`.
  - Vérification : tests unitaires : tous les `SND_*` présents après `load`, `null` avant, la musique du stage de test listée dans `tracks`, boucle cohérente avec la longueur des échantillons.
  - Fichiers : `packages/render/src/audio/bank.ts`, `packages/render/test/audio-bank.test.ts`

- [x] **E5 : Moteur Web Audio**
  - Acceptation : `createGameAudio` de la spec ; contexte audio créé à `unlock` seulement ; bus général, effets et musique ; 24 voix en réserve (gain et panoramique), priorité par son, au plus deux départs du même son par frame, légère variation de hauteur ; musique en boucle, fondu en pause et au changement de morceau ; courbe de volume perceptive ; nouvelle simulation détectée ; exports dans `index.ts`.
  - Vérification : tests unitaires de la réserve de voix, du plafond par frame, de la courbe de volume et du panoramique ; tests d'intégration sur un faux contexte : rien avant `unlock`, un son par coup, **rollback sans son en double**, coupure et volumes appliqués aux bus, musique bouclée sur les bornes de la banque, banque factice substituée sans autre changement, `dispose` ferme le contexte ; non-ingérence (checksum identique avant et après `capture`).
  - Fichiers : `packages/render/src/audio/mixer.ts`, `packages/render/src/audio/audio.ts`, `packages/render/src/index.ts`, `packages/render/test/audio-mixer.test.ts`, `packages/render/test/audio-engine.test.ts`

- [x] **E6 : Démo : son, panneau de volume, planche d'écoute**
  - Acceptation : l'audio est créé une fois avec la page et survit aux réinitialisations ; déverrouillé au premier clic ou à la première touche ; musique du stage de test ; bouton « Son (S) » ouvrant un panneau : coupure, curseurs effets et musique, état du son, planche d'écoute (un bouton par son, lecture de la musique) ; réglages enregistrés dans `localStorage` ; musique effacée en pause.
  - Vérification : test de fumée : panneau présent, état `running` après un clic, aucune erreur de console ; `pnpm --filter @game/demo perf` passe son actif, seuils inchangés, état du son dans le rapport ; **écoute humaine** au point de contrôle.
  - Fichiers : `apps/demo/src/sound.ts`, `apps/demo/src/main.ts`, `apps/demo/src/controls.ts`, `apps/demo/index.html`, `apps/demo/test/smoke.test.ts`, `apps/demo/test/perf.test.ts`

**Point de contrôle E** : écoute humaine de la démo et de la planche. Bilan écrit dans ce fichier.

## Bilan au point de contrôle E (2026-11-14)

Les six tâches sont faites et commitées sur la branche `claude/render-audio-8d3a22`. Code dans `packages/render/src/audio/` ; hors de ce dossier, seuls `packages/render/src/index.ts` (exports) et la démo ont changé. `renderer.ts` et `sim-core` n'ont pas été touchés.

### Vérifié automatiquement

| Quoi | Résultat |
|---|---|
| Tests du rendu | 183 tests, dont 84 pour l'audio (indices, synthèse, musique, banque, mélangeur, moteur) |
| Rollback | Frames rejouées après `loadState` sur une vraie simulation : aucun son en double, ni dans les indices ni dans le moteur ; rollback partiel = même suite de sons que sans rollback |
| Raccord de la boucle | Le début de la boucle rendue coïncide (écart < 0,002) avec le rendu continu de deux boucles à la suite ; le test échoue bien si l'on retire le repli des queues de notes, le préchauffage des filtres ou l'écho circulaire |
| Coût | Lecture des sons d'une frame à 8 combattants : environ 2 µs (budget 0,1 ms). Synthèse des 14 effets : environ 10 ms. Musique : environ 0,4 s à 44,1 kHz dans Node, découpée en tranches qui rendent la main au navigateur |
| Démo (Edge, sans fenêtre) | Son `locked` avant toute action, `running` après un clic ; saut et atterrissage font partir deux sons ; panneau, planche (14 boutons), coupure et réglages gardés après rechargement ; aucune erreur de console |
| Performance (son actif, 217 effets joués pendant la mesure) | Production d'une image : 0,16 ms en moyenne, 0,30 ms au 95ᵉ centile ; dessin 0,14 ms ; 14,5 appels de dessin ; tas +11,5 Ko sur 600 images ; rendu matériel. Seuils inchangés |
| Typecheck, lint, format, build de la démo | Passants |

### Non vérifié : demande une écoute humaine

Je ne peux pas écouter. Tout ce qui suit n'a été jugé que sur des mesures (durée, niveau, absence de saturation, sons distincts) :

1. **Agrément et justesse de chaque effet** : planche d'écoute dans la démo (touche `S`). En particulier : les trois forces de coup se distinguent-elles ? le KO et le bris de bouclier sont-ils assez marquants ? saut et atterrissage, très fréquents, sont-ils assez discrets ?
2. **La musique** : agréable, assez énergique, raccord audible ou non à la fin des 26 secondes, équilibre entre batterie, basse, nappe, mélodie et arpège. Elle est générée par un algorithme : **signalez toute ressemblance avec une œuvre existante**.
3. **Mélange en jeu** à 8 joueurs (`?dummies=7&mode=random`) : cacophonie ou non, niveau des effets face à la musique, panoramique.
4. **Navigateurs** : seul Edge a été essayé (automatiquement, sans haut-parleurs). Firefox et Safari restent à essayer, Safari ayant ses propres règles de déverrouillage.

Les recettes sont courtes et paramétrées (`sounds.ts` pour les effets, `music.ts` pour la musique, `mixer.ts` pour les niveaux) : vos remarques d'écoute se reportent vite.

### Limites connues

- Un son déclenché par une frame ensuite corrigée par un rollback a été joué à tort (approximation acceptée par la spec, comme pour les effets visuels).
- Un bouton de manette ne déverrouille pas le son : les navigateurs ne le comptent pas comme une action de l'utilisateur. Le panneau le dit.
- Voler une voix déjà occupée (au-delà de 24 sons simultanés) coupe net le son le plus ancien de priorité égale ou inférieure : un léger clic est possible dans ce cas rare.
- La boucle musicale occupe environ 9 Mo d'échantillons, plus sa copie dans le tampon Web Audio.

Suite : vos remarques d'écoute, puis, avec `stages-items`, une musique par stage (un `TrackStyle` de plus par stage) et, si voulu, des sons propres à chaque type d'objet.
