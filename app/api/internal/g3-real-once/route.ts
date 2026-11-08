import { runTwelveDataRealOnce } from "@/market-data-core/realTwelveDataOnce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get("Authorization") !== `Bearer ${process.env.G3G_EXECUTOR_TOKEN}` || process.env.VERCEL_ENV !== "preview") return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  try {
    const sha = process.env.SYNTRAKE_R3E1_APPROVED_SHA ?? "";
    const result = await runTwelveDataRealOnce({ env: process.env, checkoutSha: sha, asOf: "2026-11-08", instrument: { kind: "EQUITY", symbol: "AAPL", mic: "XNGS", currency: "USD", key: "equity:AAPL:XNGS:USD", instrumentId: null, listingId: null }, sourceAlias: undefined });
    return Response.json({ status: "REAL_CALL_OK", provider: result.series.provider, symbol: result.series.instrument.symbol, candles: result.series.candles.length, usage: result.usage });
  } catch (error) { return Response.json({ error: "REAL_CALL_FAILED", reason: error instanceof Error ? error.message : "UNKNOWN" }, { status: 503 }); }
}
