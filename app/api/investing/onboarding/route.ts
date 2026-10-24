import { auth } from "@clerk/nextjs/server";
import { handleInvestingOnboardingHttp } from "@/investing-core/server/onboardingHttp";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const session=async()=>{
  const value=await auth();
  return {userId:value.userId,sessionId:value.sessionId,getToken:()=>value.getToken()};
};
export async function GET(request:Request):Promise<Response>{
  return handleInvestingOnboardingHttp(request,process.env,session);
}
export async function POST(request:Request):Promise<Response>{
  return handleInvestingOnboardingHttp(request,process.env,session);
}
