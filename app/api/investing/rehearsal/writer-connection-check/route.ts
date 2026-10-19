import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedClerkActor } from "@/investing-core/server/requireVerifiedClerkActor";
import { createRehearsalWriterPool } from "@/investing-core/server/privateWriterPool";
import { isWriterConnectionProbeEnabled } from "@/investing-core/server/writerHttpRehearsalGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noCache = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
};

/** Whitelisted PostgreSQL/TLS/network error families: NEVER expose raw pg Error.message, credentials or host. */
export function connectionProbeFailureKind(error: unknown):
  "AUTH_REJECTED" | "TLS_REJECTED" | "NETWORK_FAILED" | "DB_PERMISSION_DENIED" |
  "DATABASE_REJECTED" | "INTERNAL_ERROR" {
  if (!error || typeof error !== "object") return "INTERNAL_ERROR";
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  if (code === "28P01" || code === "28000") return "AUTH_REJECTED";
  if (new Set(["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "ERR_TLS_CERT_ALTNAME_INVALID", "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT",
    "CERT_HAS_EXPIRED"]).has(code)) return "TLS_REJECTED";
  if (new Set(["ETIMEDOUT", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN",
    "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH"]).has(code)) return "NETWORK_FAILED";
  if (code === "42501") return "DB_PERMISSION_DENIED";
  if (/^[0-9A-Z]{5}$/.test(code)) return "DATABASE_REJECTED";
  return "INTERNAL_ERROR";
}

function reply(code: number, payload: Record<string, unknown>) {
  return NextResponse.json(payload, { status: code, headers: noCache });
}

/**
 * GET ONLY, no SQL DML, no user-supplied actor, account ID, token or DB URL.
 * Tests an actual TLS connection to the dedicated preview writer LOGIN,
 * explicit SET LOCAL ROLE and read-only RLS-scoped subledger SELECT.
 *
 * Financial POST remains DISABLED while its independent arming flag is absent.
 * This diagnostic is ephemeral and MUST NOT be merged to production.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isWriterConnectionProbeEnabled(process.env)) return reply(404, { error: "NOT_FOUND" });

  // Vercel Deployment Protection remains enabled. Do not answer through an
  // alias or another host; no token, query argument or CSRF shortcut.
  const url = new URL(request.url);
  if (
    url.protocol !== "https:" ||
    url.host !== process.env.VERCEL_URL ||
    request.headers.get("host") !== process.env.VERCEL_URL ||
    url.search !== "" ||
    url.pathname !== "/api/investing/rehearsal/writer-connection-check"
  ) return reply(404, { error: "NOT_FOUND" });

  let actor: Awaited<ReturnType<typeof requireVerifiedClerkActor>>;
  try {
    actor = await requireVerifiedClerkActor();
  } catch {
    return reply(401, { error: "UNAUTHENTICATED" });
  }

  // Connection is created only AFTER Clerk server auth succeeds.
  let pool: ReturnType<typeof createRehearsalWriterPool>;
  try {
    pool = createRehearsalWriterPool();
  } catch {
    return reply(503, { error: "CONNECTION_UNAVAILABLE" });
  }

  let failureStage: "CONNECT" | "BEGIN" | "ROLE" | "ACTOR" | "ACCOUNT_RLS" | "SUBLEDGER_RLS" = "CONNECT";
  try {
    const client = await pool.connect();
    let broken = false;
    try {
      failureStage = "BEGIN";
      await client.query("begin read only");
      await client.query("set local statement_timeout = '4500ms'");
      await client.query("set local lock_timeout = '1000ms'");
      const login = await client.query<{ role: string; version: number }>(
        "select current_user as role, current_setting('server_version_num')::integer as version"
      );
      if (login.rowCount !== 1 ||
          login.rows[0].role !== "investing_writer_runtime" ||
          login.rows[0].version < 170000 || login.rows[0].version >= 180000) {
        return reply(503, { error: "CONNECTION_UNAVAILABLE" });
      }

      failureStage = "ROLE";
      await client.query("set local role investing_contribution_writer");
      const role = await client.query<{ role: string }>("select current_user as role");
      if (role.rows[0]?.role !== "investing_contribution_writer") {
        return reply(503, { error: "CONNECTION_UNAVAILABLE" });
      }
      failureStage = "ACTOR";
      await client.query("select set_config('syntrake.actor_user_id', $1, true)", [actor.userId]);

      // SQL RLS, not client accountId, determines visibility. Restrict the
      // successful response to the two already-provisioned test fixtures.
      failureStage = "ACCOUNT_RLS";
      const own = await client.query<{ id: string; name: string }>(
        `select id::text as id, name from investing.investment_accounts
         where id in (
           'f886c954-0a0f-419c-890a-b77ecb0c36cf'::uuid,
           '676ae244-9ead-449c-861d-2f34a81285e3'::uuid
         )`
      );
      if (own.rowCount !== 1) return reply(403, { error: "BLOCKED" });
      const row = own.rows[0];
      if (!(
        (row.id === "f886c954-0a0f-419c-890a-b77ecb0c36cf" &&
         row.name === "R0-A Clerk A - PREVIEW TEST 2026-10-18") ||
        (row.id === "676ae244-9ead-449c-861d-2f34a81285e3" &&
         row.name === "R0-A Clerk C - PREVIEW TEST 2026-10-18")
      )) return reply(403, { error: "BLOCKED" });

      failureStage = "SUBLEDGER_RLS";
      const subledgers = await client.query<{ code: string }>(
        "select code from investing.ledger_accounts where investment_account_id=$1 and currency='EUR' and code in ('cash','external_clearing')",
        [row.id],
      );
      if (subledgers.rowCount !== 2 ||
        new Set(subledgers.rows.map(x => x.code)).size !== 2) {
        return reply(503, { error: "CONNECTION_UNAVAILABLE" });
      }
      // No COMMIT is possible: explicitly rolled back in finally.
      return reply(200, {
        state: "READ_ONLY_WRITER_CONNECTION_PASS",
        loginVerified: true,
        capabilityVerified: true,
        ownAccountVisible: true,
        subledgersReady: true,
        financialWrites: false,
      });
    } finally {
      try { await client.query("rollback"); } catch { broken = true; }
      client.release(broken);
    }
  } catch (error: unknown) {
    return reply(503, {
      error: "CONNECTION_UNAVAILABLE",
      failureStage,
      failureKind: connectionProbeFailureKind(error),
    });
  } finally {
    await pool.end().catch(() => undefined);
  }
}
