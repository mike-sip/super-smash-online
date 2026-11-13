/**
 * Limitation des tentatives, par seaux à jetons. En mémoire : le serveur des comptes est un seul
 * processus (voir SPEC-accounts.md). L'interface permet de passer plus tard à un stockage partagé.
 */

export interface RateRule {
  /** Tentatives permises d'affilée. */
  readonly capacity: number;
  /** Durée en secondes pour que le seau, vide, redevienne plein. */
  readonly windowSeconds: number;
}

export interface RateLimiter {
  /** Consomme une tentative. Renvoie 0 si elle est permise, sinon le délai d'attente en secondes. */
  hit(key: string): number;
  /** Délai d'attente en secondes, sans rien consommer ; 0 si une tentative est permise. */
  peek(key: string): number;
  /** Oublie la clé : le seau redevient plein. */
  reset(key: string): void;
}

/** Règles de la spec. */
export const RATE_RULES = {
  /** Connexion, inscription, conversion, changement de mot de passe, suppression : par adresse IP. */
  authPerAddress: { capacity: 20, windowSeconds: 60 },
  /** Création d'invités : par adresse IP. Une salle de huit joueurs derrière une même box passe. */
  guestPerAddress: { capacity: 30, windowSeconds: 3600 },
  /** Échecs de connexion : par pseudo, quelle que soit l'adresse. */
  loginFailuresPerPseudo: { capacity: 10, windowSeconds: 900 },
} as const satisfies Record<string, RateRule>;

interface Bucket {
  tokens: number;
  updated: number;
}

/** Au-delà, les seaux les plus anciens sont oubliés. */
const DEFAULT_MAX_KEYS = 100_000;

export class MemoryRateLimiter implements RateLimiter {
  readonly #capacity: number;
  /** Jetons rendus par milliseconde. */
  readonly #rate: number;
  readonly #windowMs: number;
  readonly #maxKeys: number;
  readonly #now: () => number;
  readonly #buckets = new Map<string, Bucket>();

  constructor(rule: RateRule & { readonly maxKeys?: number }, now: () => number = Date.now) {
    this.#capacity = rule.capacity;
    this.#windowMs = rule.windowSeconds * 1000;
    this.#rate = rule.capacity / this.#windowMs;
    this.#maxKeys = rule.maxKeys ?? DEFAULT_MAX_KEYS;
    this.#now = now;
  }

  /** Nombre de clés suivies. */
  get size(): number {
    return this.#buckets.size;
  }

  #tokens(key: string, now: number): number {
    const bucket = this.#buckets.get(key);
    if (bucket === undefined) return this.#capacity;
    return Math.min(this.#capacity, bucket.tokens + (now - bucket.updated) * this.#rate);
  }

  #wait(tokens: number): number {
    return tokens >= 1 ? 0 : Math.ceil((1 - tokens) / this.#rate / 1000);
  }

  hit(key: string): number {
    const now = this.#now();
    const tokens = this.#tokens(key, now);
    if (tokens < 1) return this.#wait(tokens);
    // Réinsérée en fin de table : l'ordre de la table est celui du dernier usage.
    this.#buckets.delete(key);
    this.#buckets.set(key, { tokens: tokens - 1, updated: now });
    if (this.#buckets.size > this.#maxKeys) this.#evict();
    return 0;
  }

  peek(key: string): number {
    return this.#wait(this.#tokens(key, this.#now()));
  }

  reset(key: string): void {
    this.#buckets.delete(key);
  }

  /** Oublie les seaux redevenus pleins. À appeler régulièrement. */
  sweep(): void {
    const now = this.#now();
    for (const [key, bucket] of this.#buckets) {
      if (now - bucket.updated >= this.#windowMs) this.#buckets.delete(key);
    }
  }

  #evict(): void {
    this.sweep();
    // Toujours trop : les moins récemment utilisés partent en premier.
    for (const key of this.#buckets.keys()) {
      if (this.#buckets.size <= this.#maxKeys) break;
      this.#buckets.delete(key);
    }
  }
}
