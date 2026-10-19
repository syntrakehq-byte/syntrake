import { Pool, type PoolConfig } from "pg";
import { X509Certificate } from "node:crypto";
import {
  SUPABASE_ROOT_2021_CA_PEM,
  SUPABASE_ROOT_2021_CA_SHA256,
} from "./supabaseRoot2021Ca";

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

// Deliberately compiled and pinned to the VERIFIED nonproduction branch.
// The production/main Supabase project ref is NEVER a permitted writer
// target, even when an operator accidentally sets MODE=rehearsal.
// Changes require exact SHA review and new isolated gate.
export const APPROVED_R0A_REHEARSAL_REF = "zkqgpejlkgootkvkebhd" as const;

export function parseRehearsalWriterPoolConfig(env: WriterEnvironment): PoolConfig {
  // A server-side flag is NOT user financial authorization. This gate only
  // prevents accidental activation by a non-rehearsal deployment.
  if (env.INVESTING_WRITER_MODE !== "rehearsal") {
    throw new InvestingWriterConfigurationBlocked();
  }
  const projectRef = env.INVESTING_WRITER_PROJECT_REF;
  const rawUrl = env.INVESTING_WRITER_DATABASE_URL;
  if (projectRef !== APPROVED_R0A_REHEARSAL_REF || !rawUrl) {
    throw new InvestingWriterConfigurationBlocked();
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new InvestingWriterConfigurationBlocked();
  }

  // Direct Supabase PG is IPv6-only unless a paid IPv4 add-on is enabled.
  // Vercel's IPv4-only outbound traffic requires Supavisor. In the
  // session-mode pooler, SET LOCAL ROLE and transaction-local RLS settings
  // remain on the same backend for the duration of the transaction.
  //
  // Never allow a generic pooler hostname from an untrusted request, role,
  // region, project ref, or arbitrary credentials. Both modes pin project
  // identity and the dedicated LOGIN. Region is independently verified as
  // eu-west-3 and the AWS gateway index is intentionally limited to 0 or 1.
  // The exact host still requires comparison to the Supabase Connect panel
  // before any Preview env is armed.
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new InvestingWriterConfigurationBlocked();
  }

  const login = decodeURIComponent(parsed.username);
  const direct = (
    parsed.hostname === `db.${projectRef}.supabase.co` &&
    parsed.port === "5432" &&
    login === "investing_writer_runtime" &&
    (env.INVESTING_WRITER_CONNECTION_MODE === undefined || env.INVESTING_WRITER_CONNECTION_MODE === "direct")
  );
  const sessionPooler = (
    env.INVESTING_WRITER_CONNECTION_MODE === "session-pooler" &&
    /^aws-[01]-eu-west-3[.]pooler[.]supabase[.]com$/.test(parsed.hostname) &&
    parsed.port === "5432" &&
    login === `investing_writer_runtime.${projectRef}`
  );
  if (
    (!direct && !sessionPooler) ||
    parsed.pathname !== "/postgres" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !parsed.password
  ) {
    throw new InvestingWriterConfigurationBlocked();
  }

  // Fail closed when the public trust anchor changes or expires. A CA
  // certificate alone is NOT successful SSL proof; Node TLS must check the
  // Supavisor server certificate chain AND its exact requested hostname.
  // No caller-controlled CA, sslmode, peer name or verification override.
  let ca: string | undefined;
  if (sessionPooler) {
    try {
      const cert = new X509Certificate(SUPABASE_ROOT_2021_CA_PEM);
      const now = Date.now();
      if (
        !cert.ca ||
        cert.fingerprint256 !== SUPABASE_ROOT_2021_CA_SHA256 ||
        !cert.subject.includes("CN=Supabase Root 2021 CA") ||
        !cert.issuer.includes("CN=Supabase Root 2021 CA") ||
        !Number.isFinite(Date.parse(cert.validFrom)) ||
        !(Date.parse(cert.validFrom) <= now && now < Date.parse(cert.validTo))
      ) throw new InvestingWriterConfigurationBlocked();
      ca = SUPABASE_ROOT_2021_CA_PEM;
    } catch {
      throw new InvestingWriterConfigurationBlocked();
    }
  }

  // Never use a no-verify SSL mode, environment CA override, or URL
  // parameters as the source of TLS policy. Pin SNI / peer hostname.
  return {
    connectionString: rawUrl,
    ssl: sessionPooler
      ? { rejectUnauthorized: true, ca, servername: parsed.hostname }
      : { rejectUnauthorized: true },
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
