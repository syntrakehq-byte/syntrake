import { getDynamicMarketCore } from "@/market-data-core/dynamicMarketServer";
import { handleMachineMarketCore } from "@/market-data-core/machineMarketCore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Session-independent, manually invoked by authenticated internal services. */
export async function POST(request:Request):Promise<Response> {
  return handleMachineMarketCore(request,process.env,getDynamicMarketCore());
}
