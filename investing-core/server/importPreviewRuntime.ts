import { Pool } from "pg";
import { isR2CPreviewEnabled } from "./onboardingTransport";

/** Isolated, SHA-locked Preview-only import capability. Never Production. */
type Env = Readonly<Record<string, string | undefined>>;
const PRODUCTION_PROJECT_REF = "vbazzxqyuqcrmjytaboc";
const PRIVATE_LOGIN = "investing_import_preview_login";

/**
 * Separate private LOGIN (NOINHERIT, NOBYPASSRLS) may SET LOCAL ROLE
 * investing_import_writer; it is never the NOLOGIN role itself. Same isolated
 * Supabase project as R2-C2 / BL2/BL3, but completely separate credentials.
 */
export function isR2DImportReady(env: Env): boolean {
  if (!isR2CPreviewEnabled(env) ||
      env.VERCEL_ENV !== "preview" ||
      env.INVESTING_R2D_IMPORT_ENABLED !== "enabled") return false;

  const projectRef = env.SYNTRAKE_ONBOARDING_PREVIEW_PROJECT_REF;
  if (!projectRef || !/^[a-z0-9]{20}$/.test(projectRef) ||
      projectRef === PRODUCTION_PROJECT_REF ||
      env.INVESTING_R2D_PROJECT_REF !== projectRef ||
      env.NEXT_PUBLIC_SUPABASE_URL !== `https://${projectRef}.supabase.co`) return false;

  const poolerHost = env.INVESTING_R2D_POOLER_HOST;
  if (!poolerHost || !/^aws-[0-9]+-eu-west-3\.pooler\.supabase\.com$/.test(poolerHost)) return false;

  const ca = env.INVESTING_R2D_PG_CA_PEM?.replace(/\\n/g, "\n");
  const raw = env.INVESTING_R2D_PG_DSN;
  if (!ca?.includes("-----BEGIN CERTIFICATE-----") ||
      !ca.includes("-----END CERTIFICATE-----") ||
      !raw || raw.length > 2048) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "postgresql:" &&
      url.hostname === poolerHost &&
      url.port === "5432" && url.pathname === "/postgres" &&
      decodeURIComponent(url.username) === PRIVATE_LOGIN + "." + projectRef &&
      Boolean(url.password) && url.search === "" && url.hash === "";
  } catch {
    return false;
  }
}
export function makeImportPool(env: Env): Pool {
  if (!isR2DImportReady(env)) throw new Error("IMPORT_PREVIEW_NOT_AUTHORIZED");
  return new Pool({
    connectionString: env.INVESTING_R2D_PG_DSN!,
    ssl: {
      ca: env.INVESTING_R2D_PG_CA_PEM!.replace(/\\n/g, "\n"),
      rejectUnauthorized: true,
    },
    max: 2, connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 2000, allowExitOnIdle: true,
  });
}
