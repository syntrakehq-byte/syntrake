import type { PoolClient } from "pg";
import {
  initializeCommand, initializeFirstInvestingPortfolio, InitialPortfolioBlocked,
  type InitialPortfolioReceipt,
} from "./initializeFirstPortfolio";
import {
  isR2C2PortfolioPreviewReady,
  makeR2C2PortfolioPool,
} from "./onboardingPortfolioFromClerk";

/**
 * R2-C4: candidate-only, private PG runtime bridge. No public SQL RPC,
 * service_role, client-controlled owner, financial ledger posting or live broker.
 *
 * This route is physically present in a Draft, but stays 404 until an operator
 * separately authorizes the exact branch/ref, private login and TLS trust chain.
 */
type Env = Readonly<Record<string, string | undefined>>;
export type ClerkSession = Readonly<{userId:string|null;sessionId:string|null}>;
export type ActorProvider = () => Promise<ClerkSession>;
export type FirstPortfolioPool = Readonly<{connect:()=>Promise<PoolClient>}>;
export type PgFactory = (environment: Env) => FirstPortfolioPool & {end?:()=>Promise<void>};

const MAX_BODY_BYTES = 1024;

export function isR2C4PrivateWriteReady(env: Env): boolean {
  return isR2C2PortfolioPreviewReady(env);
}
export function makePrivateProvisioningPool(env: Env): FirstPortfolioPool & {end:()=>Promise<void>} {
  if (!isR2C4PrivateWriteReady(env)) throw new Error("PRIVATE_PREVIEW_NOT_CONFIGURED");
  return makeR2C2PortfolioPool(env);
}
const headers = Object.freeze({
  "Cache-Control":"private,no-store,max-age=0",
  "Vary":"Cookie,Authorization",
  "X-Content-Type-Options":"nosniff",
  "X-Robots-Tag":"noindex,nofollow,noarchive",
  "Referrer-Policy":"no-referrer",
});
function json(status:number,body:unknown):Response {
  return Response.json(body,{status,headers});
}
async function limitedJson(request:Request):Promise<unknown> {
  if (!request.body) throw new Error("EMPTY");
  const reader = request.body.getReader();
  let size = 0;
  const pieces:Uint8Array[] = [];
  try {
    while(true) {
      const {done,value} = await reader.read();
      if(done)break;
      size += value.byteLength;
      if(size>MAX_BODY_BYTES)throw new Error("OVERSIZE");
      pieces.push(value);
    }
  }catch(error) {
    await reader.cancel().catch(()=>undefined);
    throw error;
  }finally{reader.releaseLock();}
  if(size===0)throw new Error("EMPTY");
  const joined = new Uint8Array(size);
  let index=0;
  for(const part of pieces){joined.set(part,index);index+=part.byteLength;}
  return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(joined)) as unknown;
}
export async function handlePrivateFirstPortfolioPost(
  request:Request,
  env:Env,
  actorProvider:ActorProvider,
  poolFactory:PgFactory=makePrivateProvisioningPool,
):Promise<Response>{
  // Must check gate before loading auth(), reading body or touching DB.
  if(!isR2C4PrivateWriteReady(env))return json(404,{error:"NOT_FOUND"});
  let url:URL;
  try{url=new URL(request.url);}catch{return json(400,{error:"INVALID_REQUEST"});}
  if(request.method!=="POST")return json(405,{error:"METHOD_NOT_ALLOWED"});
  if(url.pathname!=="/api/investing/portfolio/initialize" || url.search!=="" ||
      url.hash!=="" || request.url.endsWith("?"))
    return json(400,{error:"INVALID_REQUEST"});
  if(request.headers.get("origin")!==url.origin ||
    request.headers.get("content-type")?.split(";")[0]?.trim()!=="application/json")
    return json(403,{error:"BLOCKED"});
  const len = request.headers.get("content-length");
  if(len!==null && (!/^\d+$/.test(len) || Number(len)>MAX_BODY_BYTES))
    return json(413,{error:"PAYLOAD_TOO_LARGE"});
  let actor:ClerkSession;
  try { actor = await actorProvider(); }
  catch { return json(503,{error:"AUTH_UNAVAILABLE"}); }
  if(!actor.userId||!actor.sessionId)return json(401,{error:"UNAUTHENTICATED"});

  let input:unknown;
  try {input=await limitedJson(request);}catch(error){
    return json(error instanceof Error&&error.message==="OVERSIZE"?413:400,{
      error:error instanceof Error&&error.message==="OVERSIZE"?"PAYLOAD_TOO_LARGE":"INVALID_INPUT",
    });
  }
  const normalized = initializeCommand.safeParse(input);
  if(!normalized.success)return json(400,{error:"INVALID_INPUT"});

  let pool:ReturnType<PgFactory>|undefined;
  try{
    pool=poolFactory(env);
    const receipt:InitialPortfolioReceipt = await initializeFirstInvestingPortfolio(
      pool, actor, normalized.data,
    );
    return json(201,{state:"STRUCTURE_CREATED_UNFUNDED",receipt,financialMovementsCreated:false});
  }catch(error){
    if(error instanceof InitialPortfolioBlocked){
      if(error.code==="UNAUTHENTICATED")return json(401,{error:"UNAUTHENTICATED"});
      if(error.code==="INVALID_INPUT")return json(400,{error:"INVALID_INPUT"});
      if(error.code==="NOT_AUTHORIZED")return json(403,{error:"BLOCKED"});
      if(error.code==="NO_ONBOARDING_INTENT")return json(409,{error:"NO_ONBOARDING_INTENT"});
      if(error.code==="INITIAL_PORTFOLIO_ALREADY_EXISTS"||
         error.code==="IDEMPOTENCY_CONFLICT")return json(409,{error:"ALREADY_EXISTS_OR_CONFLICT"});
    }
    return json(503,{error:"PROVISIONING_UNAVAILABLE"});
  }finally{
    await pool?.end?.().catch(()=>undefined);
  }
}
