# Plan : module `fighters`

> Statut : **VALIDÉ le 2026-11-13.** Spec : [SPEC-fighters.md](../../SPEC-fighters.md). Tâches détaillées : [todo.md](todo.md).

## Approche

**Le moteur d'abord, un personnage ensuite, les trois autres enfin.** Les six extensions de `sim-core` sont faites en premier, chacune avec son scénario écrit avant le code : sans elles, aucun spécial de retour n'est possible. Viennent ensuite le paquet `fighters` et son outillage (validation, frame data), pour que Sorel soit écrit d'emblée sous leur contrôle. Sorel est alors construit, habillé, branché dans la démo, puis **réglé avec vous** jusqu'à votre accord. Les trois autres ne commencent qu'après.

Les données de chaque personnage sont vérifiées par trois filets : la validation (données cohérentes), des scénarios de simulation (chaque coup part et touche, le personnage revient sur le stage), et le tableau de frame data que vous pouvez relire. Le ressenti, lui, ne se vérifie qu'à votre essai.

## Composants et dépendances

```
Extensions sim-core E1 à E6 (scénarios d'abord)        ← point de contrôle A
   └─ paquet fighters : constructeurs, roster, assemblage du match
        └─ validation, frame data, empreinte           ← point de contrôle B
             └─ Sorel : données et scénarios
                  ├─ mannequin stylé et poses (render)
                  └─ démo : choix du personnage, ultime, frame data
                                                       ← point de contrôle C : votre avis sur Sorel
                       └─ Zéphine, Ferroc, Nacre (un à la fois)
                            └─ identité des archétypes, 8 joueurs, performance, bilan
                                                       ← point de contrôle D : votre avis sur les quatre
```

## Phases et points de contrôle

| Phase | Tâches | Ce que vous pouvez faire à la fin |
|---|---|---|
| **A. Moteur** | T1 à T4 | Relire les scénarios des six extensions ; rien de visible en jeu encore |
| **B. Outillage** | T5 à T7 | Lancer la validation et lire un tableau de frame data (vide de personnages réels, sauf le combattant de test) |
| **C. Sorel** | T8 à T10 | Choisir Sorel dans la démo, jouer tous ses coups dont l'ultime, consulter son frame data. **Votre avis sur le ressenti est attendu ici** ; les réglages qui en sortent font partie de la phase |
| **D. Roster** | T11 à T14 | Jouer les quatre personnages, jusqu'à 8 joueurs ; lire le bilan des critères de succès |

## Séquentiel ou parallèle

- **Séquentiel** : A, puis B, puis C (imposé par la carte : la référence est validée avant le reste), puis D.
- **Indépendantes à l'intérieur d'une phase** : en A, les extensions touchent des fichiers communs de `sim-core` (`movement.ts`, `hit.ts`) : faites l'une après l'autre. En D, les trois personnages sont des fichiers séparés et pourraient être écrits en parallèle ; je les fais l'un après l'autre, car chacun profite des réglages appris sur le précédent et vous pouvez les essayer au fil de l'eau.

## Risques et parades

| Risque | Parade |
|---|---|
| Les extensions de `sim-core` entrent en conflit avec celles des autres sessions à la fusion | Champs optionnels uniquement, chaque extension dans son commit ; le champ d'état ajouté en fin de liste ; note laissée dans le dossier partagé pour `match-rules` |
| E6 change tous les checksums de référence | Régénération dans un commit dédié et expliqué ; à refaire à la fusion, comme prévu par la carte |
| Les nouvelles valeurs d'action (`A_HELPLESS` = 31) tombent dans des tests de plage existants (`action >= A_LEDGE`, `action >= A_SHIELD`) | Ces tests sont bornés explicitement, et un scénario vérifie qu'un combattant en chute impuissante bouge, tombe et s'accroche |
| Les spéciaux de retour sont trop forts ou trop faibles, ce qui ne se voit qu'en jeu | Scénario automatique de retour sur le stage à distance fixée, plus votre essai ; les valeurs d'élan sont dans les données, réglables sans toucher au moteur |
| Le contre et l'armure interagissent mal avec le bouclier, la parade et les coups simultanés | Ordre de priorité explicite dans `hit.ts` (bouclier, parade, contre, armure, coup normal), et un scénario par croisement |
| La poussée d'un projectile renuméroté vers le mauvais type d'entité | Test d'assemblage à 8 joueurs avec entités de stage en tête de liste ; la validation vérifie que chaque `spawn.kind` existe chez son personnage |
| Le mannequin stylé dépasse le budget de 100 appels de dessin | Les pièces ajoutées restent dans les deux maillages instanciés existants (même nombre d'appels de dessin) ; compteur de la vue technique vérifié à 8 joueurs |
| Les poses génériques ne rendent pas lisibles des spéciaux très différents | Une pose générique par emplacement nouveau (côté, haut, bas, ultime, chute impuissante) ; des poses propres à chaque personnage seraient une demande à part, à discuter après votre essai |
| Je ne peux pas juger le ressenti à votre place | Le point de contrôle C attend votre avis, et les réglages qui en découlent, avant de lancer les trois autres |
| `match-rules` n'existe pas encore : l'ultime ne peut pas être essayée en conditions réelles | Bouton « ultime prête » dans la démo, qui lève le drapeau à la main |

## Prérequis

- `pnpm install` dans ce worktree (aucune dépendance nouvelle).
- Edge installé pour les tests Playwright de la démo, comme pour `render`.
