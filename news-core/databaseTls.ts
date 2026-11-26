export function normalizeNewsTlsCaPem(value: string): string {
  return value.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").trim();
}

// The verified Preview session pooler is IPv4-reachable. Keep the existing
// secret and distinct login; never rewrite production or other project URLs.
const PREVIEW_REF = "gehlmcjctcfdbtzlyswm";
const PREVIEW_DIRECT_HOST = "db." + PREVIEW_REF + ".supabase.co";
const PREVIEW_POOLER_HOST = "aws-1-eu-west-3.pooler.supabase.com";
export type NewsDatabaseRole = "news_reader" | "news_service" | "news_pipeline_verifier" | "news_factual_attestor" | "news_factual_writer";

export function newsDatabaseConnectionUrl(raw: string, role: NewsDatabaseRole, environment = process.env.VERCEL_ENV): { url: URL; sessionPooler: boolean } {
  const url = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.password ||
      url.port === "6543" || [...url.searchParams.keys()].some(key => ["options", "sslmode", "sslcert", "sslkey", "sslrootcert"].includes(key.toLowerCase()))) {
    throw new Error("NEWS_DATABASE_CONFIG_INVALID");
  }
  if (environment === "preview" && url.hostname === PREVIEW_DIRECT_HOST) {
    if (!/^[a-z_][a-z0-9_]*$/.test(url.username) || url.username === "postgres" || (url.port && url.port !== "5432") || url.pathname !== "/postgres") throw new Error("NEWS_PREVIEW_DB_CONFIG_INVALID");
    url.username += "." + PREVIEW_REF;
    url.hostname = PREVIEW_POOLER_HOST;
    url.port = "5432";
  }
  const sessionPooler = url.hostname.endsWith(".pooler.supabase.com");
  if (sessionPooler && (!url.username.includes(".") || url.port !== "5432")) throw new Error("NEWS_POOLER_CONFIG_INVALID");
  if (!sessionPooler) url.searchParams.set("options", "-c role=" + role);
  return { url, sessionPooler };
}

// Supavisor may not propagate startup options. Initialize and verify each
// session before it is handed to any caller, preserving the role boundary.
import { Pool, type PoolClient } from "pg";
export function makeNewsDatabasePool(raw: string, role: NewsDatabaseRole, ca: string, config: { max: number; connectionTimeoutMillis: number; idleTimeoutMillis: number; statement_timeout: number; application_name: string }, environment = process.env.VERCEL_ENV): Pool {
  const { url, sessionPooler } = newsDatabaseConnectionUrl(raw, role, environment);
  const { statement_timeout, ...rest } = config;
  const settings = {
    ...rest, connectionString: url.toString(),
    ssl: { ca: normalizeNewsTlsCaPem(ca), rejectUnauthorized: true },
    ...(sessionPooler ? { onConnect: async (client: PoolClient) => {
      await client.query("SET ROLE " + role);
      await client.query("select set_config('statement_timeout', $1, false)", [String(statement_timeout)]);
      const check = await client.query<{ role_name: string }>("select current_user as role_name");
      if (check.rows[0]?.role_name !== role) throw new Error("NEWS_DATABASE_ROLE_INVALID");
    } } : { statement_timeout }),
  };
  return new Pool(settings);
}
