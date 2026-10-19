import { NextRequest, NextResponse } from "next/server";
import { requireVerifiedClerkActor } from "@/investing-core/server/requireVerifiedClerkActor";
import { createRehearsalWriterPool } from "@/investing-core/server/privateWriterPool";
import { isWriterConnectionProbeEnabled } from "@/investing-core/server/writerHttpRehearsalGate";
import { connectionProbeFailureKind } from "@/investing-core/server/writerConnectionProbeFailure";
import { writerReadProbeVerdict } from "@/investing-core/server/writerReadProbeVerdict";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noCache = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
};

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
      const actorContext = await client.query<{ matches: boolean }>(
        "select current_setting('syntrake.actor_user_id', true) = $1 as matches",
        [actor.userId],
      );
      if (actorContext.rowCount !== 1 || actorContext.rows[0]?.matches !== true) {
        return reply(503, {
          error: "CONNECTION_UNAVAILABLE",
          failureStage: "ACTOR",
          failureKind: "INTERNAL_ERROR",
        });
      }
      failureStage = "ACCOUNT_RLS";
      const own = await client.query<{ id: string; name: string }>(
        `select id::text as id, name from investing.investment_accounts
         where id in (
           'f886c954-0a0f-419c-890a-b77ecb0c36cf'::uuid,
           '676ae244-9ead-449c-861d-2f34a81285e3'::uuid
         )`
      );
      // Respond with only a fixed classification, never Clerk identity or
      // raw account data. RLS remains the source of authority.
      const verdict = writerReadProbeVerdict(own.rows);
      if (verdict !== "OWNED_TEST_ACCOUNT") {
        return reply(403, { error: "BLOCKED", reason: verdict });
      }
      const row = own.rows[0];

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
