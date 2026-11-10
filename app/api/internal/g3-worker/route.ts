import { handleG3HostedPreviewRequest, probeG3HostedPreviewReader, runG3HostedWorkerOnce } from "@/market-data-core/g3HostedPreviewExecutor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Private, bounded Preview entrypoint. There is intentionally no GET or timer. */
export async function POST(request: Request): Promise<Response> {
  return handleG3HostedPreviewRequest(request, process.env, {
    readiness: () => probeG3HostedPreviewReader(process.env),
    runOnce: () => runG3HostedWorkerOnce(process.env),
  });
}
