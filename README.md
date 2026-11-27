# super-smash-online

**Fracas** : un jeu de combat de plateforme original, jouable dans le navigateur, jusqu'à 8 joueurs
en local et en ligne. Carte des modules et décisions : [CAPABILITY-MAP.md](CAPABILITY-MAP.md) ;
mise en production : [DEPLOIEMENT.md](DEPLOIEMENT.md).

## Développement

Node 24 et pnpm (version de `packageManager`).

```bash
pnpm install
pnpm --filter @game/app dev        # le jeu, sur http://localhost:5173
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @game/app test:e2e   # bout en bout sur le build de production (Microsoft Edge)
pnpm --filter @game/app perf       # mesure de performance, à lancer à la main
```

## Intégration continue

[`.github/workflows/ci.yml`](.github/workflows/ci.yml), à chaque pull request et sur `main` :

- **Vérifications** (bloquantes) : lint, formatage, typecheck, tests unitaires (déterminisme de
  la simulation dans Edge, Firefox et WebKit compris), tests du jeu, contenu du build de production ;
- **À titre indicatif** : les tests de bout en bout et les deux démos de développement. Ils jouent de
  vrais matchs en 3D ; sans carte graphique, leur rendu est trop lent pour leurs délais. Un échec y
  est signalé sans bloquer : ils font foi sur un poste de travail (commandes ci-dessus) ;
- **Images Docker** : construction des deux images de production, validation de la composition et
  de Caddy, service des modèles précompressés.

La mesure de performance n'y tourne pas : sans carte graphique, sur une machine partagée, ses temps
ne seraient pas représentatifs.
