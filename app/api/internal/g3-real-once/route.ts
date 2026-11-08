import { runTwelveDataRealOnce } from "@/market-data-core/realTwelveDataOnce";
export const runtime = "nodejs";
export async function POST(request: Request): Promise<Response> {
  if (request.headers.get("Authorization") !== `Bearer ${process.env.G3G_EXECUTOR_TOKEN}` || process.env.VERCEL_ENV !== "preview") return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  try { const sha = process.env.SYNTRAKE_R3E1_APPROVED_SHA ?? ""; const input = { env: process.env, checkoutSha: sha, instrument: { kind: "EQUITY", symbol: "AAPL", mic: "XNGS", currency: "USD", key: "EQUITY:XNGS:AAPL:USD", instrumentId: null, listingId: null }, sourceAlias: undefined } as unknown as Parameters<typeof runTwelveDataRealOnce>[0]; const r = await runTwelveDataRealOnce(input); return Response.json({ status: "REAL_CALL_OK", provider: r.series.provider, symbol: r.series.instrument.symbol, candles: r.series.candles.length, usage: r.usage }); } catch (e) { return Response.json({ error: "REAL_CALL_FAILED", reason: e instanceof Error ? e.message : "UNKNOWN" }, { status: 503 }); }
}
