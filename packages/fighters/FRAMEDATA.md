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

## Zéphine — rapide

### Mouvement

| Valeur | |
|---|---|
| Poids | 82 |
| Taille / demi-largeur | 11 / 2,6 |
| Marche | 1,3 |
| Dash (vitesse, frames) | 2,5, 9 |
| Course | 2,3 |
| Pré-saut | 3 |
| Saut / petit saut / double saut | 2,6 / 1,7 / 2,3 |
| Sauts aériens | 2 |
| Vitesse aérienne | 1,35 |
| Gravité | 0,1 |
| Chute max / rapide | 1,9 / 2,9 |
| Atterrissage (frames) | 2 |
| Bouclier | 45 |
| Esquive sur place | 24 (intangible 3–16) |
| Roulade | 28 (intangible 4–14) |
| Esquive aérienne | 38 (intangible 3–27) |

### Coups

| Coup | Nom | Démarrage | Actives | Durée | Dégâts (%) | Angle | Éjection (base / croissance) | Atterrissage | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Jab 1 | Pique | 2 | 2–3 | 14 | 2 | 80 | 5 / 0,2 | — | suite : Jab 2 (frames 5–14) |
| Jab 2 | Contre-pique | 2 | 2–3 | 16 | 2 | 80 | 5 / 0,2 | — | suite : Jab 3 (frames 5–16) |
| Jab 3 | Coup de talon | 4 | 4–6 | 24 | 4 | 45 | 28 / 0,8 | — |  |
| Tilt avant | Fouet | 5 | 5–7 | 22 | 7 | 40 | 10 / 0,9 | — |  |
| Tilt haut | Moulinet | 4 | 4–9 | 22 | 5 | 95 | 20 / 0,8 | — |  |
| Tilt bas | Fauchage | 4 | 4–6 | 16 | 5 | 75 | 18 / 0,5 | — |  |
| Attaque de dash | Glissade | 5 | 5–12 | 30 | 7 | 70 | 30 / 0,6 | — | élan 1–10 (avant 2,2) |
| Smash avant | Double estoc | 11 | 11–12, 16–18 | 40 | 4 + 10 (5,6 + 14 chargé) | 60 / 38 | 20 / 0 ; 24 / 1 | — | chargeable (jusqu'à 60 frames) |
| Smash haut | Vrille | 9 | 9–13 | 40 | 12 (16,8 chargé) | 88 | 28 / 0,95 | — | chargeable (jusqu'à 60 frames) |
| Smash bas | Éventail | 6 | 6–7 | 40 | 11 (15,4 chargé) | 30 / 150 | 24 / 0,95 | — | chargeable (jusqu'à 60 frames) |
| Aérienne neutre | Roue | 3 | 3–5, 6–16 | 30 | 7 / 4 | 45 | 15 / 0,8 ; 10 / 0,6 | 5 |  |
| Aérienne avant | Ciseaux | 6 | 6–7, 11–13 | 32 | 3 + 6 | 60 / 40 | 20 / 0 ; 18 / 0,9 | 8 |  |
| Aérienne arrière | Talon arrière | 5 | 5–8 | 28 | 9 | 140 | 18 / 1 | 8 |  |
| Aérienne haute | Pirouette | 4 | 4–8 | 26 | 6 | 85 | 18 / 0,85 | 6 |  |
| Aérienne basse | Piétinement | 6 | 6–7, 10–11, 14–16 | 34 | 2 + 2 + 5 | 270 / 280 | 2 / 0 ; 22 / 0,85 | 12 |  |
| Spécial neutre | Plumes | 9 | — | 30 | — | — | — | — | projectile « Plume » (3 %) |
| Spécial côté | Fente | 7 | 7–16 | 34 | 7 | 35 | 30 / 0,6 | 14 | élan 6–16 (avant 2,8) |
| Spécial haut | Envol | 4 | 4–8, 12–16 | 34 | 4 + 4 | 80 / 70 | 30 / 0 ; 40 / 0,6 | 18 | élan 4–16 (avant 1,5, haut 2,4) ; élan 17–20 (avant 0,6, haut 0,8) ; chute impuissante ; invincible 1–3 |
| Spécial bas | Piqué | 5 | 5–30 | 36 | 8 | 45 | 25 / 0,7 | 10 | élan 5–30 (avant 1,6, bas 2,6) |
| Ultime | Mille rafales | 10 | 10–14, 20–24, 30–34, 44–48 | 80 | 5 + 5 + 5 + 18 | 80 / 45 | 40 / 0 ; 85 / 1 | — | élan 10–40 (avant 3) ; invincible 1–80 |
| Attaque de rebord | Bond du rebord | 16 | 16–19 | 34 | 8 | 45 | 38 / 0,5 | — | invincible 1–15 |

### Saisie et projections

|  | Démarrage | Actives | Durée | Dégâts (%) | Angle | Éjection (base / croissance) |
|---|---|---|---|---|---|---|
| Saisie | 6 | 6–7 | 32 | coup pendant la prise : 1 toutes les 14 frames | — | — |
| Projection avant | 10 | — | 26 | 6 | 40 | 45 / 0,55 |
| Projection arrière | 14 | — | 30 | 9 | 140 | 50 / 0,65 |
| Projection haute | 9 | — | 26 | 5 | 90 | 45 / 0,55 |
| Projection basse | 12 | — | 28 | 5 | 70 | 35 / 0,35 |

## Ferroc — lourd

### Mouvement

| Valeur | |
|---|---|
| Poids | 132 |
| Taille / demi-largeur | 15 / 4,2 |
| Marche | 0,8 |
| Dash (vitesse, frames) | 1,6, 14 |
| Course | 1,35 |
| Pré-saut | 5 |
| Saut / petit saut / double saut | 2,45 / 1,55 / 2,3 |
| Sauts aériens | 1 |
| Vitesse aérienne | 0,95 |
| Gravité | 0,11 |
| Chute max / rapide | 1,8 / 2,8 |
| Atterrissage (frames) | 4 |
| Bouclier | 60 |
| Esquive sur place | 28 (intangible 3–16) |
| Roulade | 34 (intangible 5–15) |
| Esquive aérienne | 44 (intangible 4–28) |

### Coups

| Coup | Nom | Démarrage | Actives | Durée | Dégâts (%) | Angle | Éjection (base / croissance) | Atterrissage | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Jab 1 | Marteau | 5 | 5–7 | 24 | 4 | 70 | 10 / 0,3 | — | suite : Jab 2 (frames 9–24) |
| Jab 2 | Enclume | 6 | 6–8 | 26 | 4 | 70 | 12 / 0,3 | — | suite : Jab 3 (frames 12–26) |
| Jab 3 | Coup de boutoir | 8 | 8–10 | 36 | 9 | 40 | 38 / 0,9 | — |  |
| Tilt avant | Revers de pelle | 9 | 9–12 | 34 | 13 | 38 | 18 / 1 | — |  |
| Tilt haut | Uppercut | 8 | 8–12 | 34 | 12 | 88 | 26 / 0,95 | — |  |
| Tilt bas | Coup de pied bas | 7 | 7–9 | 26 | 10 | 70 | 22 / 0,7 | — |  |
| Attaque de dash | Charge brute | 9 | 9–15 | 42 | 13 | 45 | 38 / 0,8 | — | élan 1–12 (avant 1,6) |
| Smash avant | Masse d’armes | 20 | 20–23 | 62 | 24 (33,6 chargé) | 38 | 34 / 1,15 | — | chargeable (jusqu'à 60 frames) |
| Smash haut | Éruption | 16 | 16–20 | 56 | 21 (29,4 chargé) | 88 | 32 / 1,1 | — | chargeable (jusqu'à 60 frames) |
| Smash bas | Frappe au sol | 12 | 12–15 | 58 | 19 (26,6 chargé) | 35 / 145 | 30 / 1,05 | — | chargeable (jusqu'à 60 frames) |
| Aérienne neutre | Toupie de fer | 7 | 7–14 | 44 | 12 | 45 | 22 / 0,9 | 12 |  |
| Aérienne avant | Coup de massue | 13 | 13–16 | 48 | 16 | 40 | 26 / 1 | 16 |  |
| Aérienne arrière | Coude arrière | 10 | 10–13 | 40 | 15 | 145 | 26 / 1 | 14 |  |
| Aérienne haute | Tête-bêche | 8 | 8–13 | 40 | 13 | 85 | 24 / 0,95 | 12 |  |
| Aérienne basse | Enclume tombante | 16 | 16–20 | 50 | 17 | 275 | 25 / 0,95 | 22 |  |
| Spécial neutre | Bélier | 20 | 20–23 | 60 | 18 (32,4 chargé) | 40 | 40 / 1 | — | chargeable (jusqu'à 90 frames) ; armure 1–22 (éjection ≤ 90) |
| Spécial côté | Rempart | 10 | 10–22 | 46 | 14 | 40 | 40 / 0,85 | 20 | élan 8–22 (avant 1,9) ; armure 1–20 (éjection ≤ 70) |
| Spécial haut | Geyser | 6 | 6–10, 12–16, 26–30 | 52 | 4 + 4 + 12 | 85 / 75 | 35 / 0 ; 60 / 1 | 26 | élan 6–24 (haut 2,2) ; élan 25–30 (haut 1) ; chute impuissante ; invincible 1–6 |
| Spécial bas | Séisme | 8 | 8–40 | 50 | 15 + 14 | 275 / 60 | 25 / 0,9 ; 35 / 0,9 | 24 | élan 8–40 (bas 3,2) |
| Ultime | Fournaise | 30 | 30–36, 60–66 | 100 | 10 + 30 | 85 / 60 | 50 / 0 ; 95 / 1 | — | invincible 1–100 |
| Attaque de rebord | Remontée lourde | 22 | 22–26 | 44 | 11 | 45 | 42 / 0,5 | — | invincible 1–20 |

### Saisie et projections

|  | Démarrage | Actives | Durée | Dégâts (%) | Angle | Éjection (base / croissance) |
|---|---|---|---|---|---|---|
| Saisie | 9 | 9–10 | 40 | coup pendant la prise : 1,8 toutes les 22 frames | — | — |
| Projection avant | 16 | — | 36 | 11 | 45 | 55 / 0,7 |
| Projection arrière | 20 | — | 42 | 13 | 135 | 60 / 0,8 |
| Projection haute | 14 | — | 36 | 10 | 90 | 60 / 0,75 |
| Projection basse | 18 | — | 40 | 8 | 70 | 45 / 0,5 |

## Nacre — zoneur

### Mouvement

| Valeur | |
|---|---|
| Poids | 92 |
| Taille / demi-largeur | 13 / 3 |
| Marche | 1 |
| Dash (vitesse, frames) | 1,75, 12 |
| Course | 1,5 |
| Pré-saut | 3 |
| Saut / petit saut / double saut | 2,3 / 1,45 / 2,2 |
| Sauts aériens | 1 |
| Vitesse aérienne | 1,05 |
| Gravité | 0,075 |
| Chute max / rapide | 1,4 / 2,3 |
| Atterrissage (frames) | 2 |
| Bouclier | 50 |
| Esquive sur place | 26 (intangible 3–17) |
| Roulade | 30 (intangible 4–15) |
| Esquive aérienne | 40 (intangible 3–29) |

### Coups

| Coup | Nom | Démarrage | Actives | Durée | Dégâts (%) | Angle | Éjection (base / croissance) | Atterrissage | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Jab 1 | Bâton | 4 | 4–5 | 20 | 3 | 75 | 8 / 0,3 | — | suite : Jab 2 (frames 7–20) |
| Jab 2 | Revers de bâton | 4 | 4–5 | 22 | 3 | 75 | 8 / 0,3 | — | suite : Jab 3 (frames 8–22) |
| Jab 3 | Tourbillon | 6 | 6–9 | 30 | 5 | 45 | 30 / 0,8 | — |  |
| Tilt avant | Estoc | 7 | 7–9 | 28 | 9 | 40 | 14 / 0,9 | — |  |
| Tilt haut | Arc de corail | 6 | 6–12 | 30 | 7 | 92 | 22 / 0,85 | — |  |
| Tilt bas | Balayage long | 6 | 6–8 | 24 | 6 | 75 | 18 / 0,55 | — |  |
| Attaque de dash | Glissement | 7 | 7–11 | 34 | 8 | 55 | 30 / 0,7 | — | élan 1–8 (avant 1,2) |
| Smash avant | Lance de corail | 16 | 16–18 | 50 | 15 (21 chargé) | 38 | 28 / 1 | — | chargeable (jusqu'à 60 frames) |
| Smash haut | Gerbe | 12 | 12–16 | 46 | 14 (19,6 chargé) | 88 | 30 / 1 | — | chargeable (jusqu'à 60 frames) |
| Smash bas | Ressac | 9 | 9–11 | 48 | 12 (16,8 chargé) | 30 / 150 | 26 / 0,95 | — | chargeable (jusqu'à 60 frames) |
| Aérienne neutre | Bulle | 6 | 6–22 | 38 | 8 | 50 | 18 / 0,8 | 9 |  |
| Aérienne avant | Pointe | 10 | 10–13 | 40 | 10 | 42 | 20 / 0,95 | 12 |  |
| Aérienne arrière | Contre-courant | 9 | 9–12 | 36 | 12 | 140 | 22 / 1 | 11 |  |
| Aérienne haute | Vague haute | 6 | 6–11 | 34 | 8 | 85 | 20 / 0,9 | 9 |  |
| Aérienne basse | Plongée | 12 | 12–15 | 42 | 12 | 275 | 20 / 0,9 | 16 |  |
| Spécial neutre | Perle | 14 | — | 40 | — | — | — | — | projectile « Perle » (7 %) |
| Spécial côté | Galet | 15 | — | 44 | — | — | — | — | projectile « Galet » (9 %) |
| Spécial haut | Écume | 6 | 6–10, 12–16, 18–22, 24–27 | 46 | 2 + 2 + 2 + 5 | 85 / 70 | 25 / 0 ; 40 / 0,7 | 20 | élan 6–22 (haut 2,1) ; élan 23–26 (haut 0,8) ; chute impuissante ; invincible 1–4 |
| Spécial bas | Corail | 18 | — | 46 | — | — | — | — | projectile « Corail » (10 %) |
| Ultime | Grande perle | 30 | — | 80 | — | — | — | — | projectile « Grande perle » (30 %) ; invincible 1–80 |
| Attaque de rebord | Remontée en vague | 20 | 20–23 | 40 | 9 | 45 | 40 / 0,5 | — | invincible 1–18 |

### Saisie et projections

|  | Démarrage | Actives | Durée | Dégâts (%) | Angle | Éjection (base / croissance) |
|---|---|---|---|---|---|---|
| Saisie | 7 | 7–8 | 36 | coup pendant la prise : 1,2 toutes les 18 frames | — | — |
| Projection avant | 12 | — | 30 | 8 | 45 | 48 / 0,6 |
| Projection arrière | 16 | — | 34 | 9 | 135 | 52 / 0,65 |
| Projection haute | 11 | — | 30 | 7 | 90 | 52 / 0,62 |
| Projection basse | 14 | — | 32 | 6 | 72 | 40 / 0,4 |
