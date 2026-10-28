import { Pool } from "pg";
import { requireVerifiedClerkActor } from "./requireVerifiedClerkActor";
import { createOnboardingService } from "../r2/onboardingPortfolio";
import { createPostgresPortfolioRepository } from "./postgresPortfolioRepository";

type ServerEnv = Readonly<Record<string, string | undefined>>;

/** Server-only entry point: Clerk is the sole source of actor identity. */
export function makeOnboardingPortfolioPool(env: ServerEnv): Pool {
  if (env.VERCEL_ENV === "production" || env.SYNTRAKE_ONBOARDING_PG_ENABLED !== "enabled") {
    throw new Error("ONBOARDING_PG_NOT_AUTHORIZED");
  }
  const url = env.SYNTRAKE_ONBOARDING_DATABASE_URL;
  if (!url) throw new Error("ONBOARDING_PG_NOT_CONFIGURED");
  const parsed = new URL(url);
  if (parsed.protocol !== "postgresql:" || parsed.search || parsed.hash || !parsed.password) {
    throw new Error("ONBOARDING_PG_NOT_CONFIGURED");
  }
  const ca = env.SYNTRAKE_ONBOARDING_PG_CA_PEM?.replace(/\\n/g, "\n");
  if (!ca) throw new Error("ONBOARDING_PG_TLS_NOT_CONFIGURED");
  return new Pool({ connectionString: url, ssl: { ca, rejectUnauthorized: true }, max: 4, connectionTimeoutMillis: 3000, idleTimeoutMillis: 5000, allowExitOnIdle: true });
}

export async function withOnboardingPortfolioFromClerk<T>(
  pool: Pick<Pool, "connect">,
  work: (service: ReturnType<typeof createOnboardingService>) => Promise<T>,
): Promise<T> {
  const actor = await requireVerifiedClerkActor();
  const service = createOnboardingService(
    createPostgresPortfolioRepository(pool, actor.userId),
    async () => actor,
  );
  return work(service);
}
