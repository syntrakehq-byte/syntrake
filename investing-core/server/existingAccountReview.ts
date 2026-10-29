import { z } from "zod";
import { isR2COperationalReady } from "./onboardingTransport";

/**
 * R2-C3 READ ONLY: preserves existing R0/R1 account identities.
 * A missing first-provisioning receipt does not authorize a duplicate account.
 * Clerk session is obtained server-side; Supabase verifies its JWT and RLS.
 *
 * No financial value, holding, cash, broker state, or reconciliation is inferred.
 */
type Env = Readonly<Record<string, string | undefined>>;
export type VerifiedClerkSession = Readonly<{
  userId: string | null;
  sessionId: string | null;
  getToken: () => Promise<string | null>;
}>;
export type Transport = (url: string, init: RequestInit) => Promise<Response>;
export class ExistingAccountReadBlocked extends Error {
  constructor(public readonly code:
    "DISABLED" | "UNAUTHENTICATED" | "NOT_AUTHORIZED" | "READ_UNAVAILABLE") {
    super(code);
  }
}
export type ExistingAccountReview = Readonly<{
  kind: "EXISTING_INVESTING_ACCOUNTS";
  accountId: string | null;
  portfolioIds: readonly string[];
  accountMultiplicity: "ONE" | "MULTIPLE";
  financialTruth: "UNAVAILABLE";
  reconciliation: "REQUIRED";
  evidence: "SUPABASE_RLS_READ";
  financialWrites: false;
}>;

const clerkUser = /^user_[A-Za-z0-9_-]{5,120}$/;
const accountSchema = z.object({
  id: z.string().uuid(),
  owner_user_id: z.string().regex(clerkUser),
}).strict();
const portfolioSchema = z.object({
  id: z.string().uuid(),
  investment_account_id: z.string().uuid(),
}).strict();
function bearerShape(token: string | null): token is string {
  return typeof token === "string" && token.length <= 8192 &&
    token.split(".").length === 3 &&
    token.split(".").every(part => part.length > 0 && /^[A-Za-z0-9_-]+$/.test(part));
}
async function fetchRows(env: Env, token: string,
  table: "investment_accounts" | "portfolios",
  filter: "owner_user_id" | "investment_account_id",
  id: string, columns: string, maximum: number,
  transport: Transport): Promise<unknown[]> {
  const url = new URL("/rest/v1/" + table, env.NEXT_PUBLIC_SUPABASE_URL);
  url.searchParams.set("select", columns);
  url.searchParams.set(filter, "eq." + id);
  url.searchParams.set("limit", String(maximum));
  url.searchParams.set("order", "id.asc");
  let response: Response;
  try {
    response = await transport(url.toString(), {
      method: "GET",
      headers: {
        apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        Authorization: "Bearer " + token,
        "Accept-Profile": "investing",
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new ExistingAccountReadBlocked("READ_UNAVAILABLE");
  }
  if (response.status === 401 || response.status === 403) {
    throw new ExistingAccountReadBlocked("NOT_AUTHORIZED");
  }
  if (!response.ok) throw new ExistingAccountReadBlocked("READ_UNAVAILABLE");
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new ExistingAccountReadBlocked("READ_UNAVAILABLE"); }
  if (!Array.isArray(body) || body.length > maximum) {
    throw new ExistingAccountReadBlocked("READ_UNAVAILABLE");
  }
  return body;
}

/** Only a verified server actor and authorized Supabase RLS rows can scope this read. */
export async function inspectOwnExistingInvestingAccounts(
  env: Env, actor: VerifiedClerkSession, transport: Transport = fetch,
): Promise<ExistingAccountReview | null> {
  if (!isR2COperationalReady(env)) throw new ExistingAccountReadBlocked("DISABLED");
  if (!actor.userId || !clerkUser.test(actor.userId) || !actor.sessionId) {
    throw new ExistingAccountReadBlocked("UNAUTHENTICATED");
  }
  let token: string | null;
  try { token = await actor.getToken(); }
  catch { throw new ExistingAccountReadBlocked("NOT_AUTHORIZED"); }
  if (!bearerShape(token)) throw new ExistingAccountReadBlocked("NOT_AUTHORIZED");

  // Two rows are enough to distinguish 1 vs multiple, without picking a
  // random account. The client cannot supply account IDs or user IDs.
  const own = await fetchRows(env, token, "investment_accounts",
    "owner_user_id", actor.userId, "id,owner_user_id", 2, transport);
  let accounts: z.infer<typeof accountSchema>[];
  try { accounts = own.map(row => accountSchema.parse(row)); }
  catch { throw new ExistingAccountReadBlocked("READ_UNAVAILABLE"); }
  if (accounts.some(row => row.owner_user_id !== actor.userId) ||
      (accounts.length === 2 && accounts[0].id === accounts[1].id)) {
    throw new ExistingAccountReadBlocked("READ_UNAVAILABLE");
  }
  if (accounts.length === 0) return null;
  if (accounts.length === 2) return Object.freeze({
    kind: "EXISTING_INVESTING_ACCOUNTS",
    accountId: null,
    portfolioIds: Object.freeze([]),
    accountMultiplicity: "MULTIPLE",
    financialTruth: "UNAVAILABLE",
    reconciliation: "REQUIRED",
    evidence: "SUPABASE_RLS_READ",
    financialWrites: false,
  });

  const accountId = accounts[0].id;
  // Overflow rather than truncation: a partial view is an unsafe foundation
  // for a future reconciliation or subsequent first-account decisions.
  const rawPortfolios = await fetchRows(env, token, "portfolios",
    "investment_account_id", accountId, "id,investment_account_id", 51, transport);
  let portfolios: z.infer<typeof portfolioSchema>[];
  try { portfolios = rawPortfolios.map(row => portfolioSchema.parse(row)); }
  catch { throw new ExistingAccountReadBlocked("READ_UNAVAILABLE"); }
  if (portfolios.length === 51 ||
      portfolios.some(row => row.investment_account_id !== accountId) ||
      new Set(portfolios.map(row => row.id)).size !== portfolios.length) {
    throw new ExistingAccountReadBlocked("READ_UNAVAILABLE");
  }
  return Object.freeze({
    kind: "EXISTING_INVESTING_ACCOUNTS",
    accountId,
    portfolioIds: Object.freeze(portfolios.map(row => row.id)),
    accountMultiplicity: "ONE",
    financialTruth: "UNAVAILABLE",
    reconciliation: "REQUIRED",
    evidence: "SUPABASE_RLS_READ",
    financialWrites: false,
  });
}
