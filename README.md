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

- **Vérifications** : lint, formatage, typecheck, tests unitaires (déterminisme de la simulation
  dans Edge, Firefox et WebKit compris), tests du jeu et de bout en bout ; la démo de
  développement et la démo en ligne y tournent à titre indicatif (sans carte graphique, leur rendu
  est trop lent pour leurs attentes courtes : elles font foi sur un poste) ;
- **Images Docker** : construction des deux images de production, validation de la composition et
  de Caddy, service des modèles précompressés.

La mesure de performance n'y tourne pas : sans carte graphique, sur une machine partagée, ses temps
ne seraient pas représentatifs.
