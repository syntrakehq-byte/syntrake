import { Pool } from "pg";
import type { Actor } from "../contracts";
import { requireVerifiedClerkActor } from "./requireVerifiedClerkActor";
import { createOnboardingService } from "../r2/onboardingPortfolio";
import { createPostgresPortfolioRepository } from "./postgresPortfolioRepository";

type ServerEnv = Readonly<Record<string, string | undefined>>;
type PoolConnection = Pick<Pool, "connect">;

// This is a safety fence, not a source of user/financial data.
const PRODUCTION_PROJECT_REF = "vbazzxqyuqcrmjytaboc";
const PREVIEW_BRANCH = "feat/bl2bl3-canonical-draft";
const PRIVATE_LOGIN = "investing_bl2bl3_preview_login";
const R2C2_PRIVATE_LOGIN = "investing_initial_provisioner_preview_login";

export function isOnboardingPortfolioPreviewReady(env: ServerEnv): boolean {
  if (env.VERCEL_ENV !== "preview" ||
      env.VERCEL_GIT_COMMIT_REF !== PREVIEW_BRANCH ||
      env.SYNTRAKE_ONBOARDING_PG_ENABLED !== "enabled") return false;
  const approved = env.SYNTRAKE_ONBOARDING_APPROVED_PREVIEW_SHA;
  if (!approved || !/^[a-f0-9]{40}$/.test(approved) ||
      env.VERCEL_GIT_COMMIT_SHA !== approved) return false;
  const ref = env.SYNTRAKE_ONBOARDING_PREVIEW_PROJECT_REF;
  if (!ref || !/^[a-z0-9]{20}$/.test(ref) || ref === PRODUCTION_PROJECT_REF) return false;
  if (env.NEXT_PUBLIC_SUPABASE_URL !== "https://" + ref + ".supabase.co") return false;
  const ca = env.SYNTRAKE_ONBOARDING_PG_CA_PEM?.replace(/\\n/g, "\n");
  if (!ca?.includes("-----BEGIN CERTIFICATE-----") || !ca.includes("-----END CERTIFICATE-----")) return false;
  const url = env.SYNTRAKE_ONBOARDING_DATABASE_URL;
  if (!url || url.length > 2048) return false;
  try {
    const db = new URL(url);
    // Vercel functions use IPv4. Supabase direct db.<ref> is IPv6 by
    // default; require the actual Session-pooler host configured by operator.
    // No transaction pooler: this Repository relies on SET LOCAL ROLE,
    // transaction-scoped advisory locks, and COMMIT-time constraint triggers.
    const poolerHost = env.SYNTRAKE_ONBOARDING_POOLER_HOST;
    return db.protocol === "postgresql:" &&
      !!poolerHost && /^aws-[0-9]+-eu-west-3\.pooler\.supabase\.com$/.test(poolerHost) &&
      db.hostname === poolerHost &&
      db.port === "5432" && db.pathname === "/postgres" &&
      decodeURIComponent(db.username) === PRIVATE_LOGIN + "." + ref &&
      Boolean(db.password) && db.search === "" && db.hash === "";
  } catch {
    return false;
  }
}

/** Server-only, preview-only and TLS-verified database connection. */
export function makeOnboardingPortfolioPool(env: ServerEnv): Pool {
  if (!isOnboardingPortfolioPreviewReady(env)) throw new Error("ONBOARDING_PG_NOT_AUTHORIZED");
  return new Pool({
    connectionString: env.SYNTRAKE_ONBOARDING_DATABASE_URL!,
    ssl: { ca: env.SYNTRAKE_ONBOARDING_PG_CA_PEM!.replace(/\\n/g, "\n"), rejectUnauthorized: true },
    max: 2,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 2000,
    allowExitOnIdle: true,
  });
}

/** R2-C2 has a separate capability gate and LOGIN; it never reuses BL2/BL3 credentials. */
export function isR2C2PortfolioPreviewReady(env: ServerEnv): boolean {
  if (env.VERCEL_ENV !== "preview" ||
      env.VERCEL_GIT_COMMIT_REF !== PREVIEW_BRANCH ||
      env.SYNTRAKE_R2C2_PG_ENABLED !== "enabled") return false;
  const approved = env.SYNTRAKE_ONBOARDING_APPROVED_PREVIEW_SHA;
  const ref = env.SYNTRAKE_ONBOARDING_PREVIEW_PROJECT_REF;
  if (!approved || !/^[a-f0-9]{40}$/.test(approved) || env.VERCEL_GIT_COMMIT_SHA !== approved ||
      !ref || !/^[a-z0-9]{20}$/.test(ref) || ref === PRODUCTION_PROJECT_REF ||
      env.NEXT_PUBLIC_SUPABASE_URL !== "https://" + ref + ".supabase.co") return false;
  const ca = env.SYNTRAKE_R2C2_PG_CA_PEM?.replace(/\\n/g, "\n");
  if (!ca?.includes("-----BEGIN CERTIFICATE-----") || !ca.includes("-----END CERTIFICATE-----")) return false;
  const url = env.SYNTRAKE_R2C2_DATABASE_URL;
  const host = env.SYNTRAKE_R2C2_POOLER_HOST;
  if (!url || !host || !/^aws-[0-9]+-eu-west-3\.pooler\.supabase\.com$/.test(host)) return false;
  try {
    const db = new URL(url);
    return db.protocol === "postgresql:" && db.hostname === host && db.port === "5432" &&
      db.pathname === "/postgres" && decodeURIComponent(db.username) === R2C2_PRIVATE_LOGIN + "." + ref &&
      Boolean(db.password) && db.search === "" && db.hash === "";
  } catch { return false; }
}

export function makeR2C2PortfolioPool(env: ServerEnv): Pool {
  if (!isR2C2PortfolioPreviewReady(env)) throw new Error("R2C2_PG_NOT_AUTHORIZED");
  return new Pool({
    connectionString: env.SYNTRAKE_R2C2_DATABASE_URL!,
    ssl: { ca: env.SYNTRAKE_R2C2_PG_CA_PEM!.replace(/\\n/g, "\n"), rejectUnauthorized: true },
    max: 2, connectionTimeoutMillis: 3000, idleTimeoutMillis: 2000, allowExitOnIdle: true,
  });
}

/** Clerk is the sole source of actor identity. Injecting an actor is for internal harnesses only. */
export async function withOnboardingPortfolioFromClerk<T>(
  pool: PoolConnection,
  work: (service: ReturnType<typeof createOnboardingService>) => Promise<T>,
  loadActor: () => Promise<Actor> = requireVerifiedClerkActor,
): Promise<T> {
  const actor = await loadActor();
  if (!actor?.userId || !actor?.sessionId) throw new Error("UNAUTHENTICATED");
  const service = createOnboardingService(
    createPostgresPortfolioRepository(pool, actor.userId),
    async () => actor,
  );
  return work(service);
}
