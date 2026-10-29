import { handleOnboardingPortfolioPreviewPost } from "@/investing-core/server/onboardingPortfolioPreviewHttp";
import { requireVerifiedClerkActor } from "@/investing-core/server/requireVerifiedClerkActor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleOnboardingPortfolioPreviewPost(request, process.env, requireVerifiedClerkActor);
}
