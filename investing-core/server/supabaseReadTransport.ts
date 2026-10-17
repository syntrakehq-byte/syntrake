import { z } from "zod";

/**
 * Read-only PostgREST transport for Investing.
 *
 * The trust boundary is the server adapter in loadOwnInvestmentAccounts.ts:
 * it MUST pass Clerk's verified auth() session, never caller-supplied JSON,
 * headers, or a JWT presented by a client.
 *
 * Supabase verifies the JWT signature, issuer, audience and roles; this
 * transport checks only shape and fails closed on invalid responses.
 * No claim is made that a JWT is cryptographically valid at this layer.
 */
export type ClerkSessionFromServerAuth = Readonly<{
  userId: string | null;
  sessionId: string | null;
  getToken: () => Promise<string | null>;
}>;

export type InvestingReadConfiguration = Readonly<{
  url: string | undefined;
  publishableKey: string | undefined;
}>;

export type InvestingAccountSummary = Readonly<{
  id: string;
  name: string;
  baseCurrency: string;
}>;

export type InvestingReadResult = Readonly<{
  evidence: "SUPABASE_REST_RESPONSE";
  actorId: string;
  state: "AVAILABLE" | "EMPTY_OR_UNPROVISIONED";
  accounts: readonly InvestingAccountSummary[];
}>;

export type ReadTransport = (url: string, init: RequestInit) => Promise<Response>;

export class InvestingReadBlocked extends Error {
  constructor(
    public readonly code:
      | "UNAUTHENTICATED"
      | "INVALID_CONFIGURATION"
      | "TOKEN_UNAVAILABLE"
      | "READ_UNAUTHORIZED"
      | "READ_UNAVAILABLE"
      | "INVALID_READ_RESPONSE",
  ) {
    super(code);
    this.name = "InvestingReadBlocked";
  }
}

const accountRows = z.array(
  z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(120),
    base_currency: z.string().length(3),
  }).strict(),
).max(50);

function requireSupabaseUrl(raw: string | undefined): URL {
  if (!raw) throw new InvestingReadBlocked("INVALID_CONFIGURATION");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new InvestingReadBlocked("INVALID_CONFIGURATION");
  }
  if (
    url.protocol !== "https:" ||
    !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new InvestingReadBlocked("INVALID_CONFIGURATION");
  }
  return url;
}

function requirePublishableKey(value: string | undefined): string {
  if (!value || !/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(value)) {
    // Blocks accidentally wiring a secret/service_role or legacy key.
    throw new InvestingReadBlocked("INVALID_CONFIGURATION");
  }
  return value;
}

function plausibleJwt(token: string | null): token is string {
  if (!token || token.length > 8192) return false;
  const parts = token.split(".");
  return parts.length === 3 && parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part));
}

/**
 * Only reads the signed-in user's own investing account summaries.
 * There is no caller-selected user ID or portfolio/account filter.
 * Read authority is Supabase's signature validation and PostgreSQL RLS.
 */
export async function readOwnInvestingAccounts(
  session: ClerkSessionFromServerAuth,
  configuration: InvestingReadConfiguration,
  transport: ReadTransport = fetch,
): Promise<InvestingReadResult> {
  if (!session.userId || !session.sessionId || typeof session.getToken !== "function") {
    throw new InvestingReadBlocked("UNAUTHENTICATED");
  }

  const url = requireSupabaseUrl(configuration.url);
  const apiKey = requirePublishableKey(configuration.publishableKey);

  let token: string | null;
  try {
    token = await session.getToken();
  } catch {
    throw new InvestingReadBlocked("TOKEN_UNAVAILABLE");
  }
  if (!plausibleJwt(token)) throw new InvestingReadBlocked("TOKEN_UNAVAILABLE");

  const endpoint = new URL("/rest/v1/investment_accounts", url);
  endpoint.searchParams.set("select", "id,name,base_currency");
  endpoint.searchParams.set("order", "id.asc");
  endpoint.searchParams.set("limit", "50");

  let response: Response;
  try {
    response = await transport(endpoint.toString(), {
      method: "GET",
      headers: {
        apikey: apiKey,
        Authorization: "Bearer " + token,
        "Accept-Profile": "investing",
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // No fallback to a privileged key, other tenant, cache, or invented [].
    throw new InvestingReadBlocked("READ_UNAVAILABLE");
  }

  if (response.status === 401 || response.status === 403) {
    throw new InvestingReadBlocked("READ_UNAUTHORIZED");
  }
  if (!response.ok) throw new InvestingReadBlocked("READ_UNAVAILABLE");

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new InvestingReadBlocked("INVALID_READ_RESPONSE");
  }
  const parsed = accountRows.safeParse(payload);
  if (!parsed.success) throw new InvestingReadBlocked("INVALID_READ_RESPONSE");

  return {
    evidence: "SUPABASE_REST_RESPONSE",
    actorId: session.userId,
    state: parsed.data.length ? "AVAILABLE" : "EMPTY_OR_UNPROVISIONED",
    accounts: parsed.data.map(({ id, name, base_currency }) => ({
      id,
      name,
      baseCurrency: base_currency,
    })),
  };
}
