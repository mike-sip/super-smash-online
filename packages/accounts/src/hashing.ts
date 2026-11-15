/**
 * Hachage des mots de passe par scrypt. Les paramètres sont écrits dans l'empreinte stockée,
 * pour pouvoir les durcir plus tard : une empreinte périmée est recalculée à la connexion suivante.
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

export interface HashParams {
  /** log2 de N, le coût en calcul et en mémoire. */
  readonly logN: number;
  /** Taille de bloc. */
  readonly r: number;
  /** Parallélisme (calculé en série par Node : multiplie la durée, pas la mémoire). */
  readonly p: number;
}

/**
 * N = 2^15, r = 8, p = 3 : l'une des combinaisons que l'OWASP donne comme équivalentes à son
 * minimum (N = 2^17, r = 8, p = 1), avec quatre fois moins de mémoire (32 Mo par calcul).
 */
export const PRODUCTION_HASH_PARAMS: HashParams = { logN: 15, r: 8, p: 3 };

const SALT_BYTES = 16;
const KEY_BYTES = 32;
const PREFIX = 'scrypt';
/** Bornes acceptées à la relecture : au-delà, une empreinte serait un moyen de saturer le serveur. */
const LIMITS = { logN: [1, 20], r: [1, 32], p: [1, 16] } as const;

/** Trop de calculs en attente : le serveur répond « occupé ». */
export class HasherBusyError extends Error {
  constructor() {
    super('Trop de calculs de mot de passe en attente.');
    this.name = 'HasherBusyError';
  }
}

interface Parsed {
  readonly params: HashParams;
  readonly salt: Buffer;
  readonly key: Buffer;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function parse(stored: string): Parsed | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return null;
  const [logN, r, p] = parts
    .slice(1, 4)
    .map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  const params = { logN: logN!, r: r!, p: p! };
  for (const name of ['logN', 'r', 'p'] as const) {
    const [min, max] = LIMITS[name];
    if (!(params[name] >= min && params[name] <= max)) return null;
  }
  const [salt64, key64] = [parts[4]!, parts[5]!];
  if (!BASE64URL.test(salt64) || !BASE64URL.test(key64)) return null;
  const salt = Buffer.from(salt64, 'base64url');
  const key = Buffer.from(key64, 'base64url');
  if (salt.length !== SALT_BYTES || key.length !== KEY_BYTES) return null;
  return { params, salt, key };
}

function derive(password: string, salt: Buffer, params: HashParams): Promise<Buffer> {
  const N = 2 ** params.logN;
  const options: ScryptOptions = {
    N,
    r: params.r,
    p: params.p,
    // Node refuse un calcul qui dépasse `maxmem` ; il faut environ 128 × N × r octets.
    maxmem: 256 * N * params.r,
  };
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, options, (error, key) => {
      if (error === null) resolve(key);
      else reject(error);
    });
  });
}

export interface HasherLimits {
  /** Calculs menés en même temps ; chacun prend 128 × N × r octets de mémoire. */
  readonly maxConcurrent: number;
  /** Calculs en attente au-delà desquels on refuse. */
  readonly maxQueue: number;
}

const DEFAULT_LIMITS: HasherLimits = { maxConcurrent: 2, maxQueue: 32 };

export class PasswordHasher {
  readonly params: HashParams;
  readonly #limits: HasherLimits;
  #active = 0;
  readonly #waiting: (() => void)[] = [];
  /** Empreinte d'un mot de passe que personne ne connaît, pour les comptes inexistants. */
  #dummy: Promise<string> | null = null;

  constructor(params: HashParams = PRODUCTION_HASH_PARAMS, limits: Partial<HasherLimits> = {}) {
    this.params = params;
    this.#limits = { ...DEFAULT_LIMITS, ...limits };
  }

  /** Calcule une empreinte. Lève `HasherBusyError` si la file est pleine. */
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await this.#run(() => derive(password, salt, this.params));
    const { logN, r, p } = this.params;
    return [PREFIX, logN, r, p, salt.toString('base64url'), key.toString('base64url')].join('$');
  }

  /**
   * Vrai si le mot de passe correspond. Avec `stored` à `null` (compte inexistant), le même
   * calcul est fait sur une empreinte factice, pour répondre dans le même temps, et le résultat
   * est faux. Une empreinte mal formée donne faux, sans erreur.
   */
  async verify(password: string, stored: string | null): Promise<boolean> {
    const target = stored ?? (await this.#dummyHash());
    const parsed = parse(target);
    if (parsed === null) return false;
    const key = await this.#run(() => derive(password, parsed.salt, parsed.params));
    return timingSafeEqual(key, parsed.key) && stored !== null;
  }

  /** Vrai si l'empreinte n'a pas été faite avec les paramètres actuels. */
  needsRehash(stored: string): boolean {
    const parsed = parse(stored);
    if (parsed === null) return true;
    const { logN, r, p } = parsed.params;
    return logN !== this.params.logN || r !== this.params.r || p !== this.params.p;
  }

  /**
   * Prépare l'empreinte factice. Sans cela, la première connexion à un pseudo inconnu ferait deux
   * calculs au lieu d'un, et répondrait plus lentement qu'un mauvais mot de passe.
   */
  async warmUp(): Promise<void> {
    await this.#dummyHash();
  }

  #dummyHash(): Promise<string> {
    this.#dummy ??= this.hash(randomBytes(32).toString('base64url'));
    return this.#dummy;
  }

  async #run<T>(task: () => Promise<T>): Promise<T> {
    if (this.#active >= this.#limits.maxConcurrent) {
      if (this.#waiting.length >= this.#limits.maxQueue) throw new HasherBusyError();
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    } else {
      this.#active++;
    }
    try {
      return await task();
    } finally {
      // La place est passée directement au suivant, sans repasser par zéro.
      const next = this.#waiting.shift();
      if (next === undefined) this.#active--;
      else next();
    }
  }
}
