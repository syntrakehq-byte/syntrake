import {auth} from "@clerk/nextjs/server";
import {handlePortfolioImportHttp} from "@/investing-core/server/importPreviewHttp";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request):Promise<Response>{
  return handlePortfolioImportHttp(request,process.env,async()=>{
    const actor=await auth();return {userId:actor.userId,sessionId:actor.sessionId};
  });
}
export async function POST(request:Request):Promise<Response>{
  return handlePortfolioImportHttp(request,process.env,async()=>{
    const actor=await auth();return {userId:actor.userId,sessionId:actor.sessionId};
  });
}
