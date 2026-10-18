import { Pool, type PoolConfig } from "pg";

/**
 * Private server-side PostgreSQL transport for the *rehearsal* writer.
 * No caller-provided credentials, no browser exposure, no HTTP handler.
 *
 * Creation is lazy: merely constructing the Pool does not connect to PG.
 * Live/production financial authority is deliberately NOT supported.
 */
export class InvestingWriterConfigurationBlocked extends Error {
  constructor() {
    super("INVESTING_WRITER_CONFIGURATION_BLOCKED");
    this.name = "InvestingWriterConfigurationBlocked";
  }
}

type WriterEnvironment = Readonly<Record<string, string | undefined>>;

export function parseRehearsalWriterPoolConfig(env: WriterEnvironment): PoolConfig {
  // A server-side flag is NOT user financial authorization. This gate only
  // prevents accidental activation by a non-rehearsal deployment.
  if (env.INVESTING_WRITER_MODE !== "rehearsal") {
    throw new InvestingWriterConfigurationBlocked();
  }
  const projectRef = env.INVESTING_WRITER_PROJECT_REF;
  const rawUrl = env.INVESTING_WRITER_DATABASE_URL;
  if (!projectRef || !/^[a-z]{20}$/.test(projectRef) || !rawUrl) {
    throw new InvestingWriterConfigurationBlocked();
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new InvestingWriterConfigurationBlocked();
  }

  // Only a single explicitly pinned Supabase rehearsal direct DB host.
  // Pooler URLs, arbitrary host overrides, SSL downgrades and URL query
  // parameters are not accepted by this R0-A rehearsal adapter.
  if (
    parsed.protocol !== "postgresql:" &&
    parsed.protocol !== "postgres:"
  ) {
    throw new InvestingWriterConfigurationBlocked();
  }
  if (
    parsed.hostname !== `db.${projectRef}.supabase.co` ||
    parsed.port !== "5432" ||
    parsed.pathname !== "/postgres" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !parsed.username ||
    !parsed.password
  ) {
    throw new InvestingWriterConfigurationBlocked();
  }

  // Distinct private LOGIN, NOT postgres, service_role or NOLOGIN capability.
  const login = decodeURIComponent(parsed.username);
  if (
    !/^investing_[a-z0-9_]{3,60}$/.test(login) ||
    login === "investing_contribution_writer" ||
    login.startsWith("investing_ci_")
  ) {
    throw new InvestingWriterConfigurationBlocked();
  }

  // Never use a no-verify SSL mode, an environment CA override, or a
  // supplied connection string as the source of TLS policy.
  return {
    connectionString: rawUrl,
    ssl: { rejectUnauthorized: true },
    max: 2,
    connectionTimeoutMillis: 2500,
    idleTimeoutMillis: 10000,
    allowExitOnIdle: true,
  };
}

/**
 * Constructs a NONCONNECTED pool. No global singleton is initialized
 * during Next.js build/import. A future authorized route must close it
 * at shutdown or use a bounded lifecycle manager with isolated authority.
 */
export function createRehearsalWriterPool(env: WriterEnvironment = process.env): Pool {
  return new Pool(parseRehearsalWriterPoolConfig(env));
}
