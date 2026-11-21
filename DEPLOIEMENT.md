# Mettre Fracas en ligne

Ce guide permet à quelqu'un qui n'a pas suivi le projet de mettre le jeu en ligne sur **une machine en Europe**. Les étapes qui engagent un compte ou de l'argent sont marquées **💶 action payante ou contractuelle** : elles sont à faire par vous, pas par un outil automatique.

> **Ce qui a été vérifié, et ce qui ne l'a pas été.** Le build de production et les vrais processus serveur ont été lancés et testés de bout en bout dans Edge, derrière une passerelle locale qui reproduit le frontal (`pnpm --filter @game/app test:e2e`). Les fichiers Docker et Caddy ont été écrits et relus, et un test vérifie qu'ils concordent avec cette passerelle ; mais **Docker n'était pas installé sur la machine de développement : les images n'ont jamais été construites, et le TLS réel n'a jamais été essayé.** Faites les vérifications de la section 7 au premier lancement.

## 1. Ce qui tourne

```
Internet ──443──► web (Caddy) : TLS automatique, fichiers du client, en-têtes de sécurité
                    ├─ /api/accounts/*, /api/ranking/*  → accounts:8787  (comptes + classement, SQLite)
                    ├─ /lobby, /net (WebSocket)         → game:8788      (lobby + relais)
                    └─ /api/ranking/v1/matches, /health → refusés depuis Internet
game ──réseau interne──► accounts : rapports de match signés (HMAC)
```

Trois conteneurs (`deploy/docker-compose.yml`) sur un réseau interne ; seul `web` est exposé (ports 80 et 443). Les bases SQLite vivent dans le volume `data`.

## 2. La machine

| Besoin | Recommandation v1 |
|---|---|
| Région | Europe (Paris, Francfort, Amsterdam, Helsinki…), au plus près des joueurs |
| Processeur, mémoire | 2 vCPU, 4 Go (le relais garde jusqu'à ~3,4 Mo par partie de 30 min à 8 ; `RELAY_MAX_GAMES=200` ≈ 700 Mo au pire) |
| Disque | 20 Go (système, images, bases, sauvegardes) |
| Système | Linux récent (Debian 12 ou Ubuntu 24.04) |
| Réseau | IPv4 publique (IPv6 en plus si possible), ports 80 et 443 ouverts |

Offres comparables (VPS ou serveur cloud en Europe) : Hetzner Cloud, Scaleway, OVHcloud, entre autres. Les prix changent : comparez au moment de commander. **💶 Ouvrir le compte et commander la machine.**

## 3. Le nom de domaine

1. **💶 Acheter le domaine** (vérifiez au passage que le nom « Fracas » ne pose pas de problème de marque dans vos pays cibles).
2. Créer chez le registraire un enregistrement **A** (et **AAAA** si IPv6) vers l'adresse de la machine.
3. Attendre la propagation (`nslookup votre-domaine` doit renvoyer l'adresse).

## 4. Préparer la machine

```bash
# En tant qu'utilisateur avec sudo
sudo apt update && sudo apt upgrade -y
# Docker Engine et le plugin Compose : suivre https://docs.docker.com/engine/install/ (dépôt officiel)
sudo usermod -aG docker "$USER"   # puis se reconnecter
# Pare-feu : SSH, HTTP, HTTPS seulement
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp && sudo ufw enable
```

Copier le dépôt (clone Git ou archive) dans `/opt/fracas`.

## 5. Configurer

```bash
cd /opt/fracas
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
docker run --rm -v "$PWD/deploy:/d" node:24-bookworm-slim node /d/generate-secrets.ts   # ou : node deploy/generate-secrets.ts
```

Coller les deux lignes produites dans `deploy/.env`, puis renseigner `DOMAIN` et `ACME_EMAIL`. **Ne jamais commiter `deploy/.env`** (il est dans `.gitignore`) ni le transmettre par messagerie.

| Variable | Rôle |
|---|---|
| `DOMAIN` | Domaine du jeu ; Caddy obtient son certificat pour lui |
| `ACME_EMAIL` | Contact Let's Encrypt (obligatoire), prévenu avant l'expiration d'un certificat |
| `ACCOUNTS_TICKET_SECRETS` | Clés des tickets (comptes → lobby et relais), 32 caractères au moins |
| `RANKING_REPORT_SECRETS` | Clés des rapports de match (jeu → classement), distinctes des précédentes |
| `RELAY_MAX_GAMES` | Parties simultanées au plus (mémoire) |

Les autres réglages (contenu, régions, cookies `Secure`, proxy de confiance) sont fixés dans `docker-compose.yml`. Les serveurs refusent de démarrer si une clé manque ou est trop courte.

## 6. Lancer

```bash
cd /opt/fracas
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
docker compose -f deploy/docker-compose.yml ps        # les trois services « healthy »
docker compose -f deploy/docker-compose.yml logs -f   # journaux (heure ISO en tête)
```

Premier lancement conseillé : épingler les images de base par empreinte (`docker images --digests`, puis remplacer `node:24-bookworm-slim` et `caddy:2-alpine` par `…@sha256:…` dans `deploy/Dockerfile`), pour que les reconstructions suivantes soient identiques.

## 7. Vérifier après la mise en ligne

1. `https://votre-domaine/` affiche l'écran titre ; le cadenas du navigateur indique un certificat valide.
2. `curl -sI https://votre-domaine/ | grep -i -E 'content-security|strict-transport|x-content-type'` montre les trois en-têtes.
3. `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://votre-domaine/api/ranking/v1/matches` répond `404` (route interne bloquée).
4. `curl -s https://votre-domaine/api/ranking/v1/leaderboard` répond du JSON.
5. Deux navigateurs (ou un navigateur et une fenêtre privée) : En ligne → salon privé → rejoindre par le code → partie → résultats identiques. Puis, avec deux comptes, une partie rapide : la cote bouge dans « Profil ».
6. `docker compose … logs game | grep classement` montre « accepté (201) » pour la partie rapide.
7. Dans les outils du navigateur, la console ne montre aucune erreur de politique de sécurité (CSP).

## 8. Mettre à jour

```bash
cd /opt/fracas && git pull   # ou nouvelle archive
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Les salons et parties en cours sont perdus au redémarrage du serveur de jeu (état en mémoire, choix de la v1) : préférez une heure creuse. Les comptes, cotes et historiques sont dans les bases et restent.

## 9. Sauvegardes

À chaud, sans arrêter les serveurs (`VACUUM INTO`, copie cohérente) :

```bash
docker compose -f deploy/docker-compose.yml run --rm --user node \
  -v /opt/fracas-sauvegardes:/backup accounts node deploy/backup.ts /data /backup 14
```

Planifier cette commande chaque nuit (`crontab -e`), puis copier `/opt/fracas-sauvegardes` hors de la machine (**💶 stockage externe éventuel**). Pour restaurer : arrêter `accounts`, copier les deux fichiers voulus dans le volume `data` sous les noms `accounts.sqlite` et `ranking.sqlite`, relancer.

> Si `run --user node` refuse d'écrire dans `/backup`, créez le dossier avec le bon propriétaire : `sudo install -d -o 1000 -g 1000 /opt/fracas-sauvegardes`.

## 10. Changer les clés sans coupure

Les deux variables acceptent plusieurs clés séparées par des virgules ; **la première signe**, toutes sont acceptées.

1. Générer une nouvelle clé ; la mettre **en seconde position** des deux côtés ; relancer (`up -d`).
2. La passer **en première position** ; relancer.
3. Retirer l'ancienne ; relancer.

Une clé fuitée se change ainsi immédiatement (étapes 1 à 3 d'affilée) ; les sessions des joueurs ne dépendent pas de ces clés.

## 11. En cas d'incident

| Symptôme | Où regarder | Que faire |
|---|---|---|
| Le site ne répond pas | `docker compose ps`, `logs web` | Certificat refusé : vérifier le DNS et les ports 80/443 |
| « Serveur de jeu injoignable » chez les joueurs | `logs game`, `ps` (healthy ?) | `docker compose restart game` ; les joueurs se reconnectent seuls |
| Cotes qui ne bougent plus | `logs game | grep classement` | `refusé (401)` : clés de rapport différentes entre `game` et `accounts` ; `injoignable` : `accounts` arrêté |
| Mémoire saturée | `docker stats` | Baisser `RELAY_MAX_GAMES` ou prendre une machine plus grande |
| Disque plein | `df -h`, taille des journaux | Les journaux Docker sont limités (5 × 10 Mo par service) ; purger les vieilles sauvegardes |

Les journaux ne contiennent ni pseudo, ni mot de passe, ni ticket ; les adresses IP du frontal sont tronquées.

## 12. Essayer la production sans serveur

Sur un poste de développement (Node 24, pnpm) :

```bash
pnpm install
pnpm --filter @game/app build
pnpm --filter @game/app serve:prod   # http://127.0.0.1:8080/ : mêmes processus, sans Docker ni TLS
```
