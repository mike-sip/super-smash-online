/**
 * Limites contre les abus (SPEC-lobby.md, « Abus et limites ») : seaux à jetons, compteur de
 * connexions par adresse, mémoire des tickets déjà vus. Horloge injectée, aucune entrée-sortie.
 * Les adresses IP ne vivent qu'ici, en mémoire, et sont oubliées avec leurs seaux.
 */

export interface BucketRule {
  /** Jetons au plus (la rafale permise). */
  readonly capacity: number;
  /** Durée pour regagner un jeton, en ms. */
  readonly refillMs: number;
}

/** Seaux à jetons par clé. `take` renvoie `true` si l'action est permise (et consomme un jeton). */
export interface Buckets {
  take(key: string): boolean;
  /** Vrai si `take` réussirait, sans consommer. */
  peek(key: string): boolean;
  /** Seaux gardés en mémoire (les seaux pleins sont oubliés). */
  size(): number;
}

export function createBuckets(rule: BucketRule, now: () => number): Buckets {
  const buckets = new Map<string, { tokens: number; at: number }>();
  let lastSweep = now();

  function level(key: string, t: number): { tokens: number; at: number } | undefined {
    const b = buckets.get(key);
    if (b === undefined) return undefined;
    const tokens = Math.min(rule.capacity, b.tokens + (t - b.at) / rule.refillMs);
    b.tokens = tokens;
    b.at = t;
    return b;
  }

  function sweep(t: number): void {
    // Un seau qui serait plein est inutile : on l'oublie (pas de croissance sans fin de la mémoire).
    if (t - lastSweep < rule.refillMs * rule.capacity) return;
    lastSweep = t;
    for (const [key, b] of buckets) {
      if (b.tokens + (t - b.at) / rule.refillMs >= rule.capacity) buckets.delete(key);
    }
  }

  return {
    take(key) {
      const t = now();
      sweep(t);
      const b = level(key, t) ?? { tokens: rule.capacity, at: t };
      if (b.tokens < 1) return false;
      b.tokens -= 1;
      buckets.set(key, b);
      return true;
    },
    peek(key) {
      const b = level(key, now());
      return b === undefined || b.tokens >= 1;
    },
    size: () => buckets.size,
  };
}

/**
 * Clé d'une adresse pour les limites : les IPv6 regroupées par /64 (un abonné en a souvent un
 * bloc entier), les IPv4 vues en IPv6 ramenées à leur forme IPv4, longueur bornée. Comme dans
 * `accounts` ; ne lève jamais d'exception.
 */
export function addressKey(address: string): string {
  if (typeof address !== 'string' || address.length === 0) return '?';
  let a = address.trim().toLowerCase().slice(0, 64);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  if (mapped !== null) return mapped[1]!;
  if (!a.includes(':')) return a;
  const zone = a.indexOf('%');
  if (zone >= 0) a = a.slice(0, zone);
  const [head = '', tail] = a.split('::', 2);
  const left = head === '' ? [] : head.split(':');
  const right = tail === undefined || tail === '' ? [] : tail.split(':');
  const missing = tail === undefined ? 0 : Math.max(0, 8 - left.length - right.length);
  const groups = [...left, ...Array<string>(missing).fill('0'), ...right];
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

/** Connexions ouvertes par adresse, avec un plafond. */
export interface AddressCounter {
  /** Compte une connexion ; `false` (et rien n'est compté) si le plafond est atteint. */
  open(address: string): boolean;
  close(address: string): void;
  count(address: string): number;
}

export function createAddressCounter(max: number): AddressCounter {
  const counts = new Map<string, number>();
  return {
    open(address) {
      const key = addressKey(address);
      const n = counts.get(key) ?? 0;
      if (n >= max) return false;
      counts.set(key, n + 1);
      return true;
    },
    close(address) {
      const key = addressKey(address);
      const n = counts.get(key) ?? 0;
      if (n <= 1) counts.delete(key);
      else counts.set(key, n - 1);
    },
    count: (address) => counts.get(addressKey(address)) ?? 0,
  };
}

/** Identifiants de tickets déjà présentés, gardés `ttlMs` : un ticket rejoué est refusé. */
export interface ReplayGuard {
  /** `true` la première fois, `false` si `id` a déjà été vu pendant `ttlMs`. */
  first(id: string): boolean;
  size(): number;
}

export function createReplayGuard(ttlMs: number, now: () => number): ReplayGuard {
  const seen = new Map<string, number>();
  return {
    first(id) {
      const t = now();
      // Les plus anciens sont en tête (ordre d'insertion) : on purge par le début.
      for (const [key, at] of seen) {
        if (t - at < ttlMs) break;
        seen.delete(key);
      }
      if (seen.has(id)) return false;
      seen.set(id, t);
      return true;
    },
    size: () => seen.size,
  };
}
