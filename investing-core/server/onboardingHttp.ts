import {
  declareOnboarding, isR2CPreviewEnabled, latestOnboarding,
  OnboardingBlocked, onboardingHeaders, type Transport,
} from "./onboardingTransport";
import type { onboardingCommandSchema } from "../onboarding/onboardingIntent";
import type { z } from "zod";
type Env=Readonly<Record<string,string|undefined>>;
type Session=Readonly<{userId:string|null;sessionId:string|null;getToken:()=>Promise<string|null>}>;
type Load=()=>Promise<Session>;
export type Command=z.infer<typeof onboardingCommandSchema>;
function json(status:number,body:unknown):Response{
  return Response.json(body,{status,headers:onboardingHeaders});
}
export async function handleInvestingOnboardingHttp(
  request:Request,env:Env,verifiedSession:Load,transport:Transport=fetch,
):Promise<Response>{
  if(!isR2CPreviewEnabled(env))return json(404,{error:"NOT_FOUND"});
  let url:URL;
  try{url=new URL(request.url);}catch{return json(400,{error:"INVALID_REQUEST"});}
  if(url.pathname!=="/api/investing/onboarding"||url.search!==""||url.hash!==""||request.url.endsWith("?"))
    return json(400,{error:"INVALID_REQUEST"});
  if(request.method!=="GET"&&request.method!=="POST")
    return json(405,{error:"METHOD_NOT_ALLOWED"});
  if(request.method==="POST"){
    const origin=request.headers.get("origin");
    if(!origin||origin!==url.origin||request.headers.get("content-type")?.split(";")[0]?.trim()!=="application/json")
      return json(403,{error:"BLOCKED"});
    const length=Number(request.headers.get("content-length")??0);
    if(!Number.isFinite(length)||length>2048||length<0)return json(413,{error:"PAYLOAD_TOO_LARGE"});
  }
  let session:Session;
  try{session=await verifiedSession();}
  catch{return json(503,{error:"AUTH_UNAVAILABLE"});}
  try{
    if(request.method==="GET"){
      const latest=await latestOnboarding(env,session,transport);
      return json(200,{state:latest?"USER_REPORTED_INTENT":"NO_DECLARED_INTENT",
        latest,financialState:"NOT_PROVISIONED",executionAuthority:"NONE"});
    }
    let data:unknown;
    try{data=await request.json();}catch{return json(400,{error:"INVALID_INPUT"});}
    const saved=await declareOnboarding(env,session,data,transport);
    return json(201,{state:"USER_REPORTED_INTENT",latest:saved,
      financialState:"NOT_PROVISIONED",executionAuthority:"NONE"});
  }catch(e){
    if(e instanceof OnboardingBlocked){
      if(e.code==="UNAUTHENTICATED")return json(401,{error:"UNAUTHENTICATED"});
      if(e.code==="INVALID_INPUT")return json(400,{error:"INVALID_INPUT"});
      if(e.code==="UNAUTHORIZED")return json(403,{error:"BLOCKED"});
      if(e.code==="IDEMPOTENCY_CONFLICT")return json(409,{error:"IDEMPOTENCY_CONFLICT"});
      if(e.code==="DISABLED")return json(404,{error:"NOT_FOUND"});
    }
    return json(503,{error:"ONBOARDING_UNAVAILABLE"});
  }
}
