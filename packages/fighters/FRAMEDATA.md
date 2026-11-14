# Frame data

> Généré par `pnpm --filter @game/fighters framedata` à partir des données : ne pas modifier à la main.
> Frames à 60 par seconde. Démarrage : première frame active. Distances et vitesses en unités de jeu (par frame).
> Angles en degrés, 0 vers l’avant, 90 vers le haut. Dégâts chargés : à pleine charge.

## Sorel — polyvalent

### Mouvement

| Valeur | |
|---|---|
| Poids | 100 |
| Taille / demi-largeur | 12 / 3 |
| Marche | 1,1 |
| Dash (vitesse, frames) | 1,95, 11 |
| Course | 1,75 |
| Pré-saut | 3 |
| Saut / petit saut / double saut | 2,5 / 1,6 / 2,45 |
| Sauts aériens | 1 |
| Vitesse aérienne | 1,15 |
| Gravité | 0,09 |
| Chute max / rapide | 1,65 / 2,6 |
| Atterrissage (frames) | 2 |
| Bouclier | 50 |
| Esquive sur place | 26 (intangible 3–17) |
| Roulade | 30 (intangible 4–15) |
| Esquive aérienne | 40 (intangible 3–29) |

### Coups

| Coup | Nom | Démarrage | Actives | Durée | Dégâts (%) | Angle | Éjection (base / croissance) | Atterrissage | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Jab 1 | Coup sec | 3 | 3–4 | 18 | 2,5 | 75 | 6 / 0,25 | — | suite : Jab 2 (frames 6–18) |
| Jab 2 | Revers | 3 | 3–4 | 20 | 2,5 | 75 | 6 / 0,25 | — | suite : Jab 3 (frames 7–20) |
| Jab 3 | Rafale du pied | 5 | 5–7 | 30 | 5 | 40 | 32 / 0,85 | — |  |
| Tilt avant | Pied fouetté | 6 | 6–8 | 26 | 10 / 8 | 38 | 12 / 0,95 | — |  |
| Tilt haut | Arc ascendant | 5 | 5–10 | 28 | 7 | 95 | 22 / 0,85 | — |  |
| Tilt bas | Balayage | 5 | 5–7 | 20 | 6 | 80 | 20 / 0,55 | — |  |
| Attaque de dash | Élan d’épaule | 6 | 6–10 | 34 | 9 | 50 | 32 / 0,7 | — | élan 1–8 (avant 1,4) |
| Smash avant | Poing-rafale | 14 | 14–16 | 46 | 16 (22,4 chargé) | 38 | 28 / 1,05 | — | chargeable (jusqu'à 60 frames) |
| Smash haut | Colonne de vent | 11 | 11–15 | 44 | 15 (21 chargé) | 88 | 30 / 1 | — | chargeable (jusqu'à 60 frames) |
| Smash bas | Double balayage | 7 | 7–8, 15–16 | 48 | 13 + 14 (18,2 + 19,6 chargé) | 30 / 150 | 25 / 1 ; 26 / 1 | — | chargeable (jusqu'à 60 frames) |
| Aérienne neutre | Toupie | 4 | 4–6, 7–20 | 36 | 9 / 5 | 45 | 18 / 0,85 ; 12 / 0,7 | 7 |  |
| Aérienne avant | Coup de taille | 9 | 9–12 | 38 | 11 | 42 | 22 / 0,95 | 11 |  |
| Aérienne arrière | Ruade | 7 | 7–10 | 34 | 12 | 140 | 22 / 1 | 10 |  |
| Aérienne haute | Ciseau | 5 | 5–9 | 32 | 8 | 85 | 20 / 0,9 | 8 |  |
| Aérienne basse | Pique du talon | 12 | 12–14, 15–20 | 40 | 13 / 9 | 275 / 60 | 20 / 0,9 ; 15 / 0,8 | 16 |  |
| Spécial neutre | Trait de vent | 13 | — | 42 | — | — | — | — | projectile « Trait de vent » (6 %) |
| Spécial côté | Ruée | 12 | 12–16 | 38 | 10 | 40 | 35 / 0,7 | 18 | élan 6–15 (avant 2,1) |
| Spécial haut | Spirale | 5 | 5–8, 10–13, 15–18, 21–24 | 40 | 3 + 3 + 3 + 5 | 85 / 70 | 30 / 0 ; 45 / 0,8 | 20 | élan 5–18 (haut 2) ; élan 19–22 (haut 0,8) ; chute impuissante ; invincible 1–4 |
| Spécial bas | Contre | 5 | — | 44 | — | — | — | — | contre 5–24 → Suite 1 |
| Suite 1 | Riposte du vent | 4 | 4–7 | 32 | 12 | 40 | 45 / 0,85 | — | invincible 1–6 |
| Ultime | Tempête | 12 | 12–14, 24–26, 36–38, 54–58 | 90 | 4 + 4 + 4 + 20 | 85 / 50 | 40 / 0 ; 90 / 1 | — | invincible 1–90 |
| Attaque de rebord | Remontée tournoyante | 20 | 20–23 | 40 | 9 | 45 | 40 / 0,5 | — | invincible 1–18 |

### Saisie et projections

|  | Démarrage | Actives | Durée | Dégâts (%) | Angle | Éjection (base / croissance) |
|---|---|---|---|---|---|---|
| Saisie | 7 | 7–8 | 34 | coup pendant la prise : 1,3 toutes les 18 frames | — | — |
| Projection avant | 12 | — | 30 | 8 | 45 | 50 / 0,6 |
| Projection arrière | 16 | — | 34 | 10 | 135 | 55 / 0,7 |
| Projection haute | 10 | — | 30 | 7 | 90 | 55 / 0,65 |
| Projection basse | 14 | — | 32 | 6 | 75 | 40 / 0,4 |
