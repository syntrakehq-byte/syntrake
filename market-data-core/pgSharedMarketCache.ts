import type { Client } from "pg";
import { createG3PreviewClient } from "./g3PreviewPinnedClients";
import { isG3HostedPreviewReady } from "./g3HostedPreviewExecutor";

type Env = Readonly<Record<string, string | undefined>>;
type Kind = "DAILY_QUOTE" | "DAILY_HISTORY";
type DbFactory = (env: Env, kind: "reader" | "ingest") => Client;
const KEY = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export type SharedMarketCache = Readonly<{
  read(key: string, kind: Kind): Promise<unknown | null>;
  write(key: string, kind: Kind, value: unknown): Promise<void>;
}>;

/**
 * Turn shared caching off without a dedicated ingest connection and
 * a registered policy permitting short-lived price/history storage.
 * This mode never writes canonical observations or financial ledgers.
 */
export function isSharedMarketCacheConfigured(env: Env): boolean {
  return isG3HostedPreviewReady(env) &&
    env.G3G_SHARED_CACHE_MODE === "enabled" &&
    env.G3G_WORKER_MODE === "disabled" &&
    UUID.test(env.G3G_SHARED_CACHE_RIGHTS_POLICY_ID ?? "") &&
    !!env.MARKET_DATA_READER_DATABASE_URL &&
    !!env.G3G_INGEST_DATABASE_URL &&
    typeof env.MARKET_DATA_READER_CA_PEM === "string" &&
    env.MARKET_DATA_READER_CA_PEM.includes("-----BEGIN CERTIFICATE-----");
}

export function createPostgresSharedMarketCache(input: Readonly<{
  env: Env;
  clientFactory?: DbFactory;
}>): SharedMarketCache {
  const { env } = input;
  if (!isSharedMarketCacheConfigured(env)) throw new Error("SHARED_CACHE_NOT_CONFIGURED");
  const factory = input.clientFactory ?? createG3PreviewClient;
  const policyId = env.G3G_SHARED_CACHE_RIGHTS_POLICY_ID!;

  async function withRole<T>(
    clientKind: "reader" | "ingest",
    role: "market_core_reader" | "market_core_cache",
    run: (client: Client) => Promise<T>,
  ): Promise<T> {
    const db = factory(env, clientKind);
    await db.connect();
    try {
      await db.query("SET ROLE " + role);
      return await run(db);
    } finally {
      await db.end().catch(() => {});
    }
  }
  function guard(key: string, kind: Kind) {
    if (!KEY.test(key) || (kind !== "DAILY_QUOTE" && kind !== "DAILY_HISTORY")) {
      throw new Error("SHARED_CACHE_INVALID_KEY");
    }
  }

  return {
    async read(key, kind) {
      guard(key, kind);
      return withRole("reader", "market_core_reader", async db => {
        const r = await db.query<{ payload: unknown }>(
          [
            "SELECT c.payload FROM market_core.shared_market_cache c",
            "JOIN market_core.license_policies lp ON lp.rights_policy_id=c.rights_policy_id",
            "WHERE c.cache_key=$1 AND c.cache_kind=$2 AND c.rights_policy_id=$3::uuid",
            "AND c.expires_at>clock_timestamp() AND c.retention_until>clock_timestamp()",
            "AND lp.cache_allowed=true AND lp.retention_until IS NOT NULL",
            "AND lp.retention_until>clock_timestamp() LIMIT 1",
          ].join(" "),
          [key, kind, policyId],
        );
        return r.rows[0]?.payload ?? null;
      });
    },
    async write(key, kind, value) {
      guard(key, kind);
      const raw = JSON.stringify(value);
      if (!raw || raw.length > 400_000) throw new Error("SHARED_CACHE_PAYLOAD_REJECTED");
      await withRole("ingest", "market_core_cache", async db => {
        // Purge on write is not a replacement for the independent retention
        // cleanup that must be tested before enabling shared caching.
        await db.query(
          "DELETE FROM market_core.shared_market_cache WHERE expires_at<=clock_timestamp()",
        );
        const result = await db.query(
          [
            "INSERT INTO market_core.shared_market_cache",
            "(cache_key,cache_kind,rights_policy_id,payload,cached_at,expires_at,retention_until)",
            "SELECT $1,$2,lp.rights_policy_id,$4::jsonb,",
            "clock_timestamp(),",
            "LEAST(clock_timestamp()+INTERVAL '60 seconds',lp.retention_until),",
            "lp.retention_until FROM market_core.license_policies lp",
            "WHERE lp.rights_policy_id=$3::uuid AND lp.cache_allowed=true",
            "AND lp.retention_until IS NOT NULL",
            "AND lp.retention_until>clock_timestamp()+INTERVAL '1 second'",
            "ON CONFLICT (cache_key) DO UPDATE SET",
            "cache_kind=EXCLUDED.cache_kind,",
            "rights_policy_id=EXCLUDED.rights_policy_id,",
            "payload=EXCLUDED.payload,",
            "cached_at=EXCLUDED.cached_at,",
            "expires_at=EXCLUDED.expires_at,",
            "retention_until=EXCLUDED.retention_until",
            "RETURNING cache_key",
          ].join(" "),
          [key, kind, policyId, raw],
        );
        if (result.rowCount !== 1) throw new Error("SHARED_CACHE_STORAGE_REJECTED");
      });
    },
  };
}
