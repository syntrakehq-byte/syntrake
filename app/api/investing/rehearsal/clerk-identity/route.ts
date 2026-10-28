import { handleClerkABIdentityProbe } from "@/investing-core/server/clerkIdentityProbe";
import { requireVerifiedClerkActor } from "@/investing-core/server/requireVerifiedClerkActor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleClerkABIdentityProbe(request, process.env, requireVerifiedClerkActor);
}
