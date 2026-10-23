import {auth} from "@clerk/nextjs/server";
import {initializeCommand,InitialPortfolioBlocked,type InitialPortfolioReceipt}
 from "./initializeFirstPortfolio";

export const R2C2_BRANCH="candidate/investing-r2c2-first-portfolio-20261023";
export const R2C2_PROJECT="zkqgpejlkgootkvkebhd";
type Env=Readonly<Record<string,string|undefined>>;
type ClerkActor=Readonly<{
 userId:string|null;sessionId:string|null;getToken:()=>Promise<string|null>
}>;
export type HttpTransport=(url:string,init:RequestInit)=>Promise<Response>;
export function isR2C2PreviewReady(env:Env):boolean{
 return env.VERCEL_ENV==="preview"
  && env.VERCEL_GIT_COMMIT_REF===R2C2_BRANCH
  && env.INVESTING_R2C2_PREVIEW_MODE==="enabled"
  && env.INVESTING_R2C2_SUPABASE_PROJECT_REF===R2C2_PROJECT
  && env.NEXT_PUBLIC_SUPABASE_URL==="https://"+R2C2_PROJECT+".supabase.co"
  && /^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"");
}
async function authenticatedJwt(actor:ClerkActor):Promise<string>{
 if(!actor.userId||!actor.sessionId)
  throw new InitialPortfolioBlocked("UNAUTHENTICATED");
 let token:string|null;
 try{token=await actor.getToken();}catch{throw new InitialPortfolioBlocked("NOT_AUTHORIZED");}
 if(!token||token.length>8192||token.split(".").length!==3||
    !token.split(".").every(x=>/^[A-Za-z0-9_-]+$/.test(x)))
  throw new InitialPortfolioBlocked("NOT_AUTHORIZED");
 return token;
}
function requestHeaders(env:Env,token:string,isWrite:boolean):HeadersInit{
 return {
   apikey:env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
   Authorization:"Bearer "+token,
   ...(isWrite?{"Content-Profile":"investing"}:{"Accept-Profile":"investing"}),
   Accept:"application/json","Content-Type":"application/json",
 };
}
async function requestData(response:Promise<Response>):Promise<unknown>{
 let r:Response;
 try{r=await response;}catch{throw new InitialPortfolioBlocked("WRITE_UNAVAILABLE");}
 if(r.status===401||r.status===403)throw new InitialPortfolioBlocked("NOT_AUTHORIZED");
 if(!r.ok){
   // Do not return SQL diagnostic text to clients. Only private agreed
   // SQLSTATE codes receive a public semantic mapping.
   let parsed:unknown;
   try{parsed=await r.json();}catch{throw new InitialPortfolioBlocked("WRITE_UNAVAILABLE");}
   const code=parsed&&typeof parsed==="object"&&"code" in parsed
    ?(parsed as {code:unknown}).code:null;
   if(code==="P1204")throw new InitialPortfolioBlocked("NO_ONBOARDING_INTENT");
   if(code==="P1203")throw new InitialPortfolioBlocked("INITIAL_PORTFOLIO_ALREADY_EXISTS");
   if(code==="P1202")throw new InitialPortfolioBlocked("INVALID_INPUT");
   throw new InitialPortfolioBlocked("WRITE_UNAVAILABLE");
 }
 try{return await r.json();}catch{throw new InitialPortfolioBlocked("WRITE_UNAVAILABLE");}
}
function receipt(row:unknown):InitialPortfolioReceipt{
 if(!row||typeof row!=="object")throw new InitialPortfolioBlocked("WRITE_UNAVAILABLE");
 const p=row as Record<string,unknown>;
 if(typeof p.account_id!=="string"||typeof p.portfolio_id!=="string"
  ||p.state!=="STRUCTURE_CREATED_UNFUNDED"
  ||!(/^[0-9a-f-]{36}$/i.test(p.account_id)&&/^[0-9a-f-]{36}$/i.test(p.portfolio_id)))
  throw new InitialPortfolioBlocked("WRITE_UNAVAILABLE");
 return {
  accountId:p.account_id,portfolioId:p.portfolio_id,
  state:"STRUCTURE_CREATED_UNFUNDED",financialTruth:"UNAVAILABLE",
  ledgerMovementsCreated:false,brokerConfirmed:false,cashBalance:"UNAVAILABLE",
 };
}
export async function provisionViaVerifiedJwt(
 env:Env,actor:ClerkActor,raw:unknown,transport:HttpTransport=fetch,
):Promise<InitialPortfolioReceipt>{
 if(!isR2C2PreviewReady(env))throw new InitialPortfolioBlocked("NOT_AUTHORIZED");
 const input=initializeCommand.safeParse(raw);
 if(!input.success)throw new InitialPortfolioBlocked("INVALID_INPUT");
 const token=await authenticatedJwt(actor);
 const url=env.NEXT_PUBLIC_SUPABASE_URL+"/rest/v1/rpc/provision_first_portfolio";
 const result=await requestData(transport(url,{
  method:"POST",headers:requestHeaders(env,token,true),cache:"no-store",
  body:JSON.stringify({
   p_idempotency_key:input.data.idempotencyKey,
   p_account_name:input.data.accountName,
   p_portfolio_name:input.data.portfolioName,
   p_base_currency:input.data.baseCurrency,
  }),signal:AbortSignal.timeout(7000),
 }));
 if(!Array.isArray(result)||result.length!==1)
  throw new InitialPortfolioBlocked("WRITE_UNAVAILABLE");
 return receipt(result[0]);
}
export async function readViaVerifiedJwt(
 env:Env,actor:ClerkActor,transport:HttpTransport=fetch,
):Promise<InitialPortfolioReceipt|null>{
 if(!isR2C2PreviewReady(env))throw new InitialPortfolioBlocked("NOT_AUTHORIZED");
 const token=await authenticatedJwt(actor);
 const url=new URL("/rest/v1/initial_portfolio_receipts",env.NEXT_PUBLIC_SUPABASE_URL);
 url.searchParams.set("select","account_id,portfolio_id");
 url.searchParams.set("limit","2");
 const result=await requestData(transport(url.toString(),{
  method:"GET",headers:requestHeaders(env,token,false),cache:"no-store",
  signal:AbortSignal.timeout(7000),
 }));
 if(!Array.isArray(result)||result.length>1)
  throw new InitialPortfolioBlocked("WRITE_UNAVAILABLE");
 return result.length===0?null:receipt({...result[0],state:"STRUCTURE_CREATED_UNFUNDED"});
}
export async function provisionFromClerk(env:Env,request:unknown):Promise<InitialPortfolioReceipt>{
 const verified=await auth();
 return provisionViaVerifiedJwt(env,verified,request);
}
export async function readInitialPortfolioFromClerk(env:Env):Promise<InitialPortfolioReceipt|null>{
 const verified=await auth();
 return readViaVerifiedJwt(env,verified);
}
