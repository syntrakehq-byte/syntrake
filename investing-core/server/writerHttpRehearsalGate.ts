import { z } from "zod";
import { parseRehearsalWriterPoolConfig, APPROVED_R0A_REHEARSAL_REF } from "./privateWriterPool";

/**
 * TEMPORARY, uniquely pinned PREVIEW rehearsal route.
 *
 * This controls deployment exposure, NOT ownership. The actual account owner
 * is the Clerk server auth() actor and PostgreSQL writer RLS. Never treat
 * client-supplied accountId, mode, headers or secrets as authority.
 */
export const R0A_WRITER_REHEARSAL_BRANCH =
  "candidate/investing-r0a-writer-e2e-preview-20261018" as const;

const TEST_ACCOUNTS = Object.freeze({
  A: "f886c954-0a0f-419c-890a-b77ecb0c36cf",
  C: "676ae244-9ead-449c-861d-2f34a81285e3",
} as const);

type Env = Readonly<Record<string, string | undefined>>;

export function isWriterHttpRehearsalEnabled(env: Env): boolean {
  if (
    env.VERCEL_ENV !== "preview" ||
    env.VERCEL_GIT_COMMIT_REF !== R0A_WRITER_REHEARSAL_BRANCH ||
    env.INVESTING_R0A_WRITER_HTTP_MODE !== "rehearsal-armed" ||
    env.INVESTING_WRITER_MODE !== "rehearsal" ||
    env.INVESTING_WRITER_PROJECT_REF !== APPROVED_R0A_REHEARSAL_REF ||
    !env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_") ||
    !env.CLERK_SECRET_KEY?.startsWith("sk_test_")
  ) return false;
  try {
    // Same allowlisted direct PG host, low-privilege LOGIN and enforced TLS
    // policy as the original writer transport. No pool is opened here.
    parseRehearsalWriterPoolConfig(env);
    return true;
  } catch {
    return false;
  }
}


/**
 * Separately gated read-only connectivity probe. DOES NOT depend on the
 * write-arming flag, so the contribution POST remains 404 throughout testing.
 * Preview deployment, branch, Clerk test instance, fixed DB project and
 * existing low-privilege connection parser are all mandatory.
 */
export function isWriterConnectionProbeEnabled(env: Env): boolean {
  if (
    env.VERCEL_ENV !== "preview" ||
    env.VERCEL_GIT_COMMIT_REF !== R0A_WRITER_REHEARSAL_BRANCH ||
    env.INVESTING_WRITER_MODE !== "rehearsal" ||
    env.INVESTING_WRITER_PROJECT_REF !== APPROVED_R0A_REHEARSAL_REF ||
    env.INVESTING_WRITER_CONNECTION_MODE !== "session-pooler" ||
    !env.VERCEL_URL?.endsWith(".vercel.app") ||
    !env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_") ||
    !env.CLERK_SECRET_KEY?.startsWith("sk_test_")
  ) return false;
  try {
    parseRehearsalWriterPoolConfig(env);
    return true;
  } catch {
    return false;
  }
}

/** Same-origin POST on the exact deployment URL; Vercel protection stays on. */
export function hasSameOriginWriterIntent(
  input: Readonly<{ url: string; origin: string | null; host: string | null; contentType: string | null; fetchSite: string | null }>,
  env: Env,
): boolean {
  try {
    const url = new URL(input.url);
    const deployedHost = env.VERCEL_URL;
    return !!deployedHost &&
      deployedHost.endsWith(".vercel.app") &&
      url.protocol === "https:" &&
      url.host === deployedHost &&
      input.host === deployedHost &&
      url.pathname === "/api/investing/rehearsal/contribution-smoke" &&
      url.search === "" &&
      input.origin === url.origin &&
      input.contentType?.split(";")[0].trim().toLowerCase() === "application/json" &&
      (input.fetchSite === "same-origin" || input.fetchSite === null);
  } catch {
    return false;
  }
}

const Body = z.strictObject({
  accountId: z.string().uuid(),
});

export class WriterSmokeBadInput extends Error {
  constructor() {
    super("WRITER_SMOKE_BAD_INPUT");
  }
}

export function fixedWriterSmokeDeclaration(body: unknown): {
  accountId: string;
  idempotencyKey: string;
  currency: "EUR";
  amountMinor: "1";
  externalReference: string;
} {
  const parsed = Body.safeParse(body);
  if (!parsed.success) throw new WriterSmokeBadInput();
  let label: "A" | "C";
  if (parsed.data.accountId === TEST_ACCOUNTS.A) label = "A";
  else if (parsed.data.accountId === TEST_ACCOUNTS.C) label = "C";
  else throw new WriterSmokeBadInput();

  // At most one POSTED, replayable, 1-minor-unit USER_REPORTED journal
  // per fixture account. No arbitrary amount, reference or idempotency key.
  // This is SYNTHETIC preview-only evidence, never confirmed broker cash.
  return {
    accountId: parsed.data.accountId,
    idempotencyKey: `r0a-preview-writer-test-20261018-${label}-one`,
    currency: "EUR",
    amountMinor: "1",
    externalReference: `r0a-preview-synthetic-${label}-20261018`,
  };
}
