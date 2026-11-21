# Images de production de Fracas, construites depuis la racine du dépôt :
#   docker compose -f deploy/docker-compose.yml build
#
# - « server » : Node 24, les deux serveurs (comptes + classement, jeu), utilisateur non root ;
# - « web »    : Caddy avec le client construit dans /srv.
#
# Les images de base sont désignées par leur version ; épinglez-les par empreinte (digest) au
# premier déploiement (voir DEPLOIEMENT.md).

FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.18.0 --activate
# Dépendances d'abord : la couche reste en cache tant que le lockfile ne change pas.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps ./apps
# Textures, HDRI et polices (assets/SOURCES.md), servis à la racine du client.
COPY assets ./assets
COPY deploy ./deploy
COPY tsconfig.base.json ./
RUN pnpm install --frozen-lockfile
# Serveurs : les paquets du dépôt sont importés par leur build (dist/) ; client : apps/game/dist.
RUN pnpm --filter @game/lobby build \
  && pnpm --filter @game/ranking build \
  && pnpm --filter @game/app build \
  && rm -rf apps/game/dist-e2e apps/game/.env.e2e
# Modèles des combattants et HDRI : binaires que Caddy ne compresse pas à la volée ; servis
# précompressés (`file_server { precompressed gzip }`), environ deux fois plus légers.
RUN find apps/game/dist \( -name '*.glb' -o -name '*.hdr' \) -exec gzip -9 -k {} +

FROM node:24-bookworm-slim AS server
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=root:root /app /app
# Bases SQLite : seul dossier inscriptible (volume).
RUN mkdir -p /data && chown node:node /data
USER node
# Heure ISO en tête de chaque ligne de journal.
ENV NODE_OPTIONS="--import /app/deploy/log-time.ts"
EXPOSE 8787 8788
# La commande est donnée par docker-compose.yml (serveur des comptes ou serveur de jeu).

FROM caddy:2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/game/dist /srv
