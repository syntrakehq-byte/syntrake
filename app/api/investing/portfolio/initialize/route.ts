import { auth } from "@clerk/nextjs/server";
import { handlePrivateFirstPortfolioPost } from "@/investing-core/server/firstPortfolioPreviewHttp";

// Candidate-only. Guard denies all Production requests before accessing Clerk/PG.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request:Request):Promise<Response>{
  return handlePrivateFirstPortfolioPost(request,process.env,async()=>{
    const session=await auth();
    return {userId:session.userId,sessionId:session.sessionId};
  });
}
