import {auth} from "@clerk/nextjs/server";
import {InitialPortfolioBlocked} from "@/investing-core/server/initializeFirstPortfolio";
import {isR2C2PreviewReady,provisionFromClerk,readViaVerifiedJwt}
  from "@/investing-core/server/initialPortfolioRuntime";
import {inspectExistingAccountViaClerkJwt}
  from "@/investing-core/server/legacyAccountReconciliation";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private,no-store,max-age=0",
  "Vary":"Cookie,Authorization","X-Robots-Tag":"noindex,nofollow",
  "Referrer-Policy":"no-referrer"};
function json(status:number,body:unknown){return Response.json(body,{status,headers});}
function httpError(e:unknown):Response{
 if(e instanceof InitialPortfolioBlocked){
  if(e.code==="UNAUTHENTICATED")return json(401,{error:"UNAUTHENTICATED"});
  if(e.code==="INVALID_INPUT")return json(400,{error:"INVALID_INPUT"});
  if(e.code==="NO_ONBOARDING_INTENT")return json(409,{error:"NO_ONBOARDING_INTENT"});
  if(e.code==="INITIAL_PORTFOLIO_ALREADY_EXISTS"||e.code==="IDEMPOTENCY_CONFLICT")
   return json(409,{error:"INITIAL_PORTFOLIO_ALREADY_EXISTS"});
  if(e.code==="NOT_AUTHORIZED")return json(403,{error:"BLOCKED"});
  if(e.code==="READ_UNAVAILABLE")return json(503,{error:"READ_UNAVAILABLE"});
 }
 return json(503,{error:"PROVISIONING_UNAVAILABLE"});
}
export async function GET(req:Request):Promise<Response>{
 if(!isR2C2PreviewReady(process.env))return json(404,{error:"NOT_FOUND"});
 const u=new URL(req.url);
 if(u.pathname!=="/api/investing/portfolio/initialize"||u.search) return json(400,{error:"INVALID_REQUEST"});
 try{
  // Preserve the R2-C2 receipt as the highest-authority initial creation
  // evidence. Only when absent, discover legacy account structures READ-ONLY.
  const actor=await auth();
  const latest=await readViaVerifiedJwt(process.env,actor);
  if(latest)return json(200,{state:"INITIAL_PORTFOLIO_EXISTS",latest,existing:null});
  const existing=await inspectExistingAccountViaClerkJwt(process.env,actor);
  return json(200,{state:existing?"EXISTING_ACCOUNT_RECONCILIATION_REQUIRED":"NOT_PROVISIONED",
    latest:null,existing});
 }catch(e){return httpError(e);}
}
export async function POST(req:Request):Promise<Response>{
 if(!isR2C2PreviewReady(process.env))return json(404,{error:"NOT_FOUND"});
 const u=new URL(req.url);
 if(u.pathname!=="/api/investing/portfolio/initialize"||u.search)return json(400,{error:"INVALID_REQUEST"});
 if(req.headers.get("origin")!==u.origin||req.headers.get("content-type")?.split(";")[0]?.trim()!=="application/json")
  return json(403,{error:"BLOCKED"});
 const len=Number(req.headers.get("content-length")||0);
 if(!Number.isFinite(len)||len>2048||len<0)return json(413,{error:"PAYLOAD_TOO_LARGE"});
 let body:unknown;
 try{body=await req.json();}catch{return json(400,{error:"INVALID_INPUT"});}
 try{
  const receipt=await provisionFromClerk(process.env,body);
  return json(201,{state:"INITIAL_PORTFOLIO_CREATED",receipt});
 }catch(e){return httpError(e);}
}
