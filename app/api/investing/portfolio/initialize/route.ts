import {InitialPortfolioBlocked} from "@/investing-core/server/initializeFirstPortfolio";
import {isR2C2PreviewReady,provisionFromClerk,readInitialPortfolioFromClerk}
  from "@/investing-core/server/initialPortfolioRuntime";
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
 }
 return json(503,{error:"PROVISIONING_UNAVAILABLE"});
}
export async function GET(req:Request):Promise<Response>{
 if(!isR2C2PreviewReady(process.env))return json(404,{error:"NOT_FOUND"});
 const u=new URL(req.url);
 if(u.pathname!=="/api/investing/portfolio/initialize"||u.search) return json(400,{error:"INVALID_REQUEST"});
 try{
  const latest=await readInitialPortfolioFromClerk(process.env);
  return json(200,{state:latest?"INITIAL_PORTFOLIO_EXISTS":"NOT_PROVISIONED",latest});
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
