import { requireVerifiedClerkActor } from "@/investing-core/server/requireVerifiedClerkActor";
import { isG3HostedPreviewReady } from "@/market-data-core/g3HostedPreviewExecutor";
import { runPersonalMarketProbe } from "@/market-data-core/personalMarketProbe";
import { MarketDataError } from "@/market-data-core/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
};
function response(status: number, data: unknown): Response {
  return Response.json(data, { status, headers });
}

/** Interactive owner Preview smoke test. No user-supplied symbol and no data storage. */
export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/internal/g3-personal-probe" ||
      url.search !== "" || !isG3HostedPreviewReady(process.env)) {
    return response(404, { error: "NOT_FOUND" });
  }
  if (request.headers.get("origin") !== url.origin) {
    return response(403, { error: "ORIGIN_REJECTED" });
  }
  try {
    await requireVerifiedClerkActor();
  } catch {
    return response(401, { error: "UNAUTHENTICATED" });
  }
  try {
    return response(200, await runPersonalMarketProbe(process.env));
  } catch (error) {
    if (error instanceof MarketDataError) {
      if (error.code === "DISABLED") return response(423, { error: "PREVIEW_PROBE_DISABLED" });
      if (error.code === "RATE_LIMITED") return response(429, { error: "RATE_LIMITED" });
      if (error.code === "INVALID_PROVIDER_RESPONSE") return response(502, { error: "PROVIDER_VALIDATION_FAILED" });
      if (error.code === "PROVIDER_REJECTED") return response(502, { error: "PROVIDER_REJECTED" });
      if (error.code === "INVALID_REQUEST") return response(400, { error: "PROBE_INVALID_REQUEST" });
    }
    return response(503, { error: "PROVIDER_UNAVAILABLE" });
  }
}
