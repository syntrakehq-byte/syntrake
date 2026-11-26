import { getCache } from "@vercel/functions";

type CacheKind = "DAILY_QUOTE" | "DAILY_HISTORY";
type Env = Readonly<Record<string,string|undefined>>;
type Client = Readonly<{
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, opts: { ttl: number }): Promise<unknown>;
}>;
type Envelope = Readonly<{
  schema: 1;
  kind: CacheKind;
  revision: string;
  expiryEpochMs: number;
  value: unknown;
}>;

// Short-lived, non-durable Vercel Runtime Cache (not a Supabase warehouse).
// Vercel shares this cache among function instances within the same region.
export const MARKET_SHARED_CACHE_TTL_SECONDS = 30;

export function createVercelRuntimeMarketCache(options: Readonly<{
  env: Env;
  client?: Client;
  clock?: () => Date;
}>) {
  const sha = options.env.VERCEL_GIT_COMMIT_SHA;
  if (options.env.SYNTRAKE_MARKET_SHARED_CACHE !== "enabled" ||
      options.env.SYNTRAKE_MARKET_PERSISTENCE !== "disabled" ||
      (options.env.VERCEL_ENV !== "preview" && options.env.VERCEL_ENV !== "production") ||
      !sha || !/^[a-f0-9]{40}$/.test(sha) ||
      options.env.SYNTRAKE_MARKET_APPROVED_SHA !== sha) {
    throw new Error("MARKET_SHARED_CACHE_DISABLED");
  }
  const runtime = options.client ?? getCache({ namespace: "syntrake-market-r3-short-lived" });
  const clock = options.clock ?? (() => new Date());
  const safeKey = (key: string, kind: CacheKind) => {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("INVALID_CACHE_KEY");
    return "v1:" + sha + ":" + kind + ":" + key;
  };
  return {
    async read(key: string, kind: CacheKind): Promise<unknown | null> {
      const scoped = safeKey(key, kind);
      let stored: unknown;
      try { stored = await runtime.get(scoped); }
      catch {
        // Cache failure cannot fabricate a market price or block a provider read.
        console.warn("MARKET_SHORT_LIVED_CACHE_READ_UNAVAILABLE");
        return null;
      }
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
      const v = stored as Partial<Envelope>;
      if (v.schema !== 1 || v.revision !== sha || v.kind !== kind ||
          typeof v.expiryEpochMs !== "number" ||
          v.expiryEpochMs <= clock().getTime() ||
          v.expiryEpochMs > clock().getTime() + MARKET_SHARED_CACHE_TTL_SECONDS * 1000) {
        return null;
      }
      return v.value ?? null;
    },
    async write(key: string, kind: CacheKind, value: unknown): Promise<void> {
      const scoped = safeKey(key, kind);
      const record: Envelope = {
        schema: 1, kind, revision: sha,
        expiryEpochMs: clock().getTime() + MARKET_SHARED_CACHE_TTL_SECONDS * 1000,
        value,
      };
      try {
        await runtime.set(scoped, record, { ttl: MARKET_SHARED_CACHE_TTL_SECONDS });
      } catch {
        // Requests remain available if Runtime Cache is temporarily unavailable.
        console.warn("MARKET_SHORT_LIVED_CACHE_WRITE_UNAVAILABLE");
      }
    },
  };
}
