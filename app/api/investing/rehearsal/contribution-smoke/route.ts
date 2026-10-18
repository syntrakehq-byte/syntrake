import { NextRequest, NextResponse } from "next/server";
import { recordUserReportedContributionInRehearsal } from "@/investing-core/server/recordContributionFromClerk";
import { ContributionBlocked } from "@/investing-core/server/recordUserReportedContribution";
import {
  fixedWriterSmokeDeclaration,
  hasSameOriginWriterIntent,
  isWriterHttpRehearsalEnabled,
  WriterSmokeBadInput,
} from "@/investing-core/server/writerHttpRehearsalGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const responseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
};

function reply(payload: Record<string, unknown>, status: number) {
  return NextResponse.json(payload, { status, headers: responseHeaders });
}

/**
 * Preview-only single-cent synthetic writer rehearsal. The session actor is
 * always obtained inside recordUserReportedContributionInRehearsal() from
 * verified server-side Clerk auth(). This route does not accept an actor,
 * role, session, JWT, SQL connection URL, cash amount or idempotency key.
 *
 * POST only. At most one committed USER_REPORTED journal for each of two
 * fixed preview fixture accounts; repeats return the same journal via the
 * deterministic idempotency key. Never claim this is broker-confirmed cash.
 *
 * IMPORTANT: This route stays 404 until armed by BRANCH-ONLY private envs.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isWriterHttpRehearsalEnabled(process.env)) {
    return reply({ error: "NOT_FOUND" }, 404);
  }
  if (!hasSameOriginWriterIntent({
    url: request.url,
    origin: request.headers.get("origin"),
    host: request.headers.get("host"),
    contentType: request.headers.get("content-type"),
    fetchSite: request.headers.get("sec-fetch-site"),
  }, process.env)) {
    return reply({ error: "BLOCKED" }, 403);
  }

  try {
    const text = await request.text();
    if (text.length === 0 || text.length > 256) return reply({ error: "INVALID_INPUT" }, 400);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return reply({ error: "INVALID_INPUT" }, 400);
    }
    const declaration = fixedWriterSmokeDeclaration(body);
    const outcome = await recordUserReportedContributionInRehearsal(declaration);
    // Never return session, actor, SQL errors, credentials, or raw provenance.
    return reply({
      state: "RECORDED_OR_IDEMPOTENT_REPLAY",
      evidenceStatus: outcome.evidenceStatus,
      transactionId: outcome.transactionId,
      currency: outcome.currency,
      amountMinor: outcome.amountMinor,
      confirmedByBroker: false,
    }, 200);
  } catch (error: unknown) {
    if (error instanceof WriterSmokeBadInput) return reply({ error: "INVALID_INPUT" }, 400);
    if (error instanceof ContributionBlocked) {
      if (error.code === "ACCOUNT_NOT_AUTHORIZED") return reply({ error: "BLOCKED" }, 403);
      if (error.code === "IDEMPOTENCY_CONFLICT" || error.code === "EXTERNAL_REFERENCE_CONFLICT") {
        return reply({ error: "CONFLICT" }, 409);
      }
    }
    // Unauthenticated Clerk, PostgreSQL timeout, DB failure and missing
    // subledgers all fail closed. Never use privileged fallback credentials.
    return reply({ error: "WRITE_UNAVAILABLE" }, 503);
  }
}
