import { Pool } from "pg";

type Env = Readonly<Record<string, string | undefined>>;
export type R2ProductionDbCapability = "r2c2" | "bl2bl3" | "import";
const PRODUCTION_PROJECT_REF = "vbazzxqyuqcrmjytaboc";
const HEX_SHA = /^[0-9a-f]{40}$/;
const POOLER_HOST = /^aws-[0-9]+-eu-west-3\.pooler\.supabase\.com$/;

const CAPABILITY = {
  r2c2: {
    enabled: "SYNTRAKE_R2C2_PRODUCTION_ENABLED",
    databaseUrl: "SYNTRAKE_R2C2_PRODUCTION_DATABASE_URL",
    certificate: "SYNTRAKE_R2C2_PRODUCTION_PG_CA_PEM",
    login: "investing_initial_provisioner_prod_login",
  },
  bl2bl3: {
    enabled: "SYNTRAKE_BL2BL3_PRODUCTION_ENABLED",
    databaseUrl: "SYNTRAKE_BL2BL3_PRODUCTION_DATABASE_URL",
    certificate: "SYNTRAKE_BL2BL3_PRODUCTION_PG_CA_PEM",
    login: "investing_bl2bl3_prod_login",
  },
  import: {
    enabled: "SYNTRAKE_R2D_PRODUCTION_ENABLED",
    databaseUrl: "SYNTRAKE_R2D_PRODUCTION_DATABASE_URL",
    certificate: "SYNTRAKE_R2D_PRODUCTION_PG_CA_PEM",
    login: "investing_import_prod_login",
  },
} as const;

/**
 * Production requires deliberate, exact-SHA opt-in on the merged main branch.
 * A green Preview or a PR does NOT enable a Production capability. These
 * values must be set explicitly after release approval by an operator.
 */
export function isR2ProductionBaseReady(env: Env): boolean {
  return env.VERCEL_ENV === "production" &&
    env.VERCEL_GIT_COMMIT_REF === "main" &&
    env.SYNTRAKE_R2_PRODUCTION_ENABLED === "enabled" &&
    !!env.VERCEL_GIT_COMMIT_SHA && HEX_SHA.test(env.VERCEL_GIT_COMMIT_SHA) &&
    env.SYNTRAKE_R2_PRODUCTION_APPROVED_SHA === env.VERCEL_GIT_COMMIT_SHA &&
    env.SYNTRAKE_R2_PRODUCTION_PROJECT_REF === PRODUCTION_PROJECT_REF &&
    env.NEXT_PUBLIC_SUPABASE_URL === "https://" + PRODUCTION_PROJECT_REF + ".supabase.co" &&
    /^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "") &&
    /^pk_live_[A-Za-z0-9_-]{10,}$/.test(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "") &&
    /^sk_live_[A-Za-z0-9_-]{10,}$/.test(env.CLERK_SECRET_KEY || "");
}
export function isR2ProductionIntentReady(env: Env): boolean {
  return isR2ProductionBaseReady(env) &&
    env.SYNTRAKE_R2C_PRODUCTION_ENABLED === "enabled";
}
function productionCertificate(env: Env, capability: R2ProductionDbCapability): string {
  return env[CAPABILITY[capability].certificate]?.replace(/\\n/g,"\n") || "";
}
/**
 * No PostgreSQL connection until the full gate passes. Distinct credentials
 * for three NOINHERIT logins, one allowed SET-ONLY membership per capability.
 * Session pooler on 5432 and verified TLS. No service_role or postgres login.
 */
export function isR2ProductionDbReady(env: Env, capability: R2ProductionDbCapability): boolean {
  if (!isR2ProductionBaseReady(env)) return false;
  const c = CAPABILITY[capability];
  if (env[c.enabled] !== "enabled") return false;
  const host = env.SYNTRAKE_R2_PRODUCTION_POOLER_HOST;
  if (!host || !POOLER_HOST.test(host)) return false;
  const ca = productionCertificate(env, capability);
  if (!ca.includes("-----BEGIN CERTIFICATE-----") ||
      !ca.includes("-----END CERTIFICATE-----")) return false;
  const raw = env[c.databaseUrl];
  if (!raw || raw.length > 2048) return false;
  try {
    const db = new URL(raw);
    return db.protocol === "postgresql:" &&
      db.hostname === host && db.port === "5432" &&
      db.pathname === "/postgres" &&
      decodeURIComponent(db.username) === c.login + "." + PRODUCTION_PROJECT_REF &&
      Boolean(db.password) && db.search === "" && db.hash === "";
  } catch { return false; }
}

export function makeR2ProductionPool(env: Env, capability: R2ProductionDbCapability): Pool {
  if (!isR2ProductionDbReady(env, capability))
    throw new Error("R2_PRODUCTION_NOT_AUTHORIZED");
  return new Pool({
    connectionString: env[CAPABILITY[capability].databaseUrl]!,
    ssl: { ca: productionCertificate(env, capability), rejectUnauthorized: true },
    max: 2, connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 2000, allowExitOnIdle: true,
  });
}
