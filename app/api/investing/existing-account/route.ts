import { auth } from "@clerk/nextjs/server";
import { handleExistingAccountReviewGet } from "@/investing-core/server/existingAccountReviewHttp";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  return handleExistingAccountReviewGet(request, process.env, async () => {
    const s = await auth();
    return {
      userId: s.userId,
      sessionId: s.sessionId,
      getToken: () => s.getToken(),
    };
  });
}
