import type { NextRequest } from "next/server";
import { requireVerifiedClerkActor } from "@/investing-core/server/requireVerifiedClerkActor";
import { getDynamicMarketCore } from "@/market-data-core/dynamicMarketServer";
import { handleInvestingSelectionQuote } from "@/investing-core/marketDataQuoteHttp";
import { handleInvestingMarketDataRead, loadInvestingMarketDataFromPostgres } from "@/market-data-core/investingMarketDataHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  return handleInvestingMarketDataRead(
    request.url,
    process.env,
    requireVerifiedClerkActor,
    (query, actor) => loadInvestingMarketDataFromPostgres(query, actor, process.env),
  );
}

/** Portfolio selection delegates directly to the shared Market Core. */
export async function POST(request: NextRequest): Promise<Response> {
  return handleInvestingSelectionQuote(request, requireVerifiedClerkActor, getDynamicMarketCore());
}
