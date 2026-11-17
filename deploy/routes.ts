/**
 * Routes et en-têtes du frontal de production, décrits une seule fois. La passerelle locale
 * (`gateway.ts`, tests et `serve:prod`) les applique ; un test vérifie que le `Caddyfile` dit la
 * même chose.
 */

export type Upstream = 'accounts' | 'game';

export interface Route {
  /** Préfixe de chemin (ou chemin exact si `exact`). */
  readonly path: string;
  readonly exact?: boolean;
  /** Serveur qui répond, ou `block` : refusé (404) depuis l'extérieur. */
  readonly to: Upstream | 'block';
  readonly websocket?: boolean;
}

/** Dans l'ordre : la première qui correspond gagne. Le reste : fichiers statiques du client. */
export const ROUTES: readonly Route[] = [
  // Les rapports de match ne viennent que du serveur de jeu, par le réseau interne.
  // Préfixe : « /matches/ » et ses variantes ne passent pas non plus.
  { path: '/api/ranking/v1/matches', to: 'block' },
  { path: '/api/accounts/', to: 'accounts' },
  { path: '/api/ranking/', to: 'accounts' },
  { path: '/lobby', exact: true, to: 'game', websocket: true },
  { path: '/net', exact: true, to: 'game', websocket: true },
  // La santé des serveurs se lit sur le réseau interne (Docker, supervision), pas depuis Internet.
  { path: '/health', to: 'block' },
];

/** Politique de sécurité du contenu : rien d'autre que le site lui-même. */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

/** En-têtes ajoutés à toutes les réponses du frontal. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy':
    'gamepad=(self), camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

/** Ajouté seulement en https (le frontal de production). */
export const HSTS = 'max-age=31536000; includeSubDomains';

/** Fichiers à empreinte : cache d'un an ; `index.html` : jamais en cache. */
export const CACHE_ASSETS = 'public, max-age=31536000, immutable';
export const CACHE_HTML = 'no-cache';

export function routeFor(pathname: string): Route | null {
  for (const r of ROUTES) {
    if (
      r.exact === true ? pathname === r.path : pathname === r.path || pathname.startsWith(r.path)
    ) {
      return r;
    }
  }
  return null;
}
