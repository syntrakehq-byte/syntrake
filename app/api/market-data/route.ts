import type { NextRequest } from "next/server";
import type { Actor } from "@/investing-core/contracts";
import { requireVerifiedClerkActor } from "@/investing-core/server/requireVerifiedClerkActor";
import { handleOnDemandMarketDataHttp } from "@/market-data-core/onDemandMarketDataHttp";
import {
  createSharedMarketGateway, isSharedMarketDataPreviewEnabled,
  resolveSharedMarketDemand,
} from "@/market-data-core/sharedMarketServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The same /api/market-data endpoint serves Investing and Trading. */
export async function GET(request: NextRequest): Promise<Response> {
  if (!isSharedMarketDataPreviewEnabled(process.env)) {
    return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  }
  let verifiedActor: Actor | null = null;
  return handleOnDemandMarketDataHttp(request, {
    authenticate: async () => {
      const actor = await requireVerifiedClerkActor();
      verifiedActor = actor;
      return actor;
    },
    resolve: (listingId, actor) => resolveSharedMarketDemand(listingId, actor, process.env),
    request: async demand => {
      // Authentication already completed. All data reads use the restricted
      // reader LOGIN and the existing PIT + rights validation.
      if (verifiedActor === null) throw new Error("UNAUTHENTICATED");
      const gateway = createSharedMarketGateway(verifiedActor, process.env);
      return gateway.request(demand);
    },
  });
}
