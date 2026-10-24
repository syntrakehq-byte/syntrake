import {z} from "zod";

/**
 * R2-F read-only black-box tenant-isolation probe against Supabase PostgREST.
 * Two REAL independent Clerk session tokens are required at manual runtime.
 *
 * Parsing a JWT envelope is NOT cryptographic verification. The gateway must
 * validate signatures; this probe requires positive own-account results and
 * an explicit 401/403 rejection when a valid token signature is tampered with.
 *
 * Neither source nor tests contain credentials or known customer IDs.
 */
const TARGET="zkqgpejlkgootkvkebhd";
const host="https://"+TARGET+".supabase.co";
const uuid=z.string().uuid();
const userId=z.string().regex(/^user_[A-Za-z0-9_-]{5,120}$/);
const row=z.object({id:uuid,owner_user_id:userId}).strict();
const jwtPart=/^[A-Za-z0-9_-]+$/;
type Actor=Readonly<{userId:string;accountId:string;jwt:string}>;
export type SignedRlsABInput=Readonly<{
  projectUrl:string;
  publishableKey:string;
  actorA:Actor;
  actorB:Actor;
}>;
export type SignedRlsABEvidence=Readonly<{
  state:"SIGNED_CLERK_AB_RLS_READ_ONLY_PASS";
  projectRef:"zkqgpejlkgootkvkebhd";
  distinctClerkActors:true;
  verifiedOwnAccountReads:2;
  deniedCrossActorReads:2;
  rejectedTamperedBearer:true;
  httpMethods:"GET_ONLY";
  financialState:"NOT_ASSESSED";
  noFinancialWrites:true;
  scope:"EXTERNAL_POSTGREST_READ_ONLY";
}>;
export type ReadTransport=(input:string,init:RequestInit)=>Promise<Response>;
export class SignedRlsABBlocked extends Error {
  constructor() {super("SIGNED_CLERK_AB_VERIFICATION_BLOCKED");}
}

function parseToken(actor:Actor,nowSeconds:number):void{
  if(!userId.safeParse(actor.userId).success||
    !uuid.safeParse(actor.accountId).success||
    actor.jwt.length<32||actor.jwt.length>8192)throw new SignedRlsABBlocked();
  const parts=actor.jwt.split(".");
  if(parts.length!==3||parts.some(part=>!jwtPart.test(part)))throw new SignedRlsABBlocked();
  try{
    const payload:unknown=JSON.parse(Buffer.from(parts[1],"base64url").toString("utf8"));
    if(!payload||typeof payload!=="object"||Array.isArray(payload))
      throw new SignedRlsABBlocked();
    const claims=payload as Record<string,unknown>;
    if(claims.sub!==actor.userId||claims.role!=="authenticated"||
      typeof claims.exp!=="number"||!Number.isSafeInteger(claims.exp)||
      claims.exp<=nowSeconds+30||
      typeof claims.iss!=="string"||!claims.iss.startsWith("https://"))
      throw new SignedRlsABBlocked();
  }catch {throw new SignedRlsABBlocked();}
}

function verifyPreconditions(input:SignedRlsABInput,nowSeconds:number):void{
  if(input.projectUrl!==host||
    !input.publishableKey.startsWith("sb_publishable_")||
    input.publishableKey.length<20||input.publishableKey.length>512)
    throw new SignedRlsABBlocked();
  parseToken(input.actorA,nowSeconds);
  parseToken(input.actorB,nowSeconds);
  if(input.actorA.userId===input.actorB.userId||
     input.actorA.accountId===input.actorB.accountId||
     input.actorA.jwt===input.actorB.jwt)throw new SignedRlsABBlocked();
}

async function probeAccount(
  input:SignedRlsABInput,token:string,accountId:string,
  transport:ReadTransport,expected:"OWN"|"OTHER"|"REJECT"
):Promise<void>{
  const url=new URL("/rest/v1/investment_accounts",host);
  url.searchParams.set("select","id,owner_user_id");
  url.searchParams.set("id","eq."+accountId);
  url.searchParams.set("limit","2");
  let reply:Response;
  try{
    reply=await transport(url.toString(),{
      method:"GET",
      headers:{
        apikey:input.publishableKey,
        Authorization:"Bearer "+token,
        "Accept-Profile":"investing",
        Accept:"application/json",
      },
      cache:"no-store",
      redirect:"error",
      signal:AbortSignal.timeout(6000),
    });
  }catch {throw new SignedRlsABBlocked();}
  if(expected==="REJECT"){
    // A bad signature MUST be rejected by the external identity gateway.
    // A 200 response, even empty, is not proof of secure JWT processing.
    if(reply.status!==401&&reply.status!==403)throw new SignedRlsABBlocked();
    return;
  }
  if(reply.status!==200)throw new SignedRlsABBlocked();
  let body:unknown;
  try{body=await reply.json();}
  catch{throw new SignedRlsABBlocked();}
  if(!Array.isArray(body)||body.length>1)throw new SignedRlsABBlocked();
  let records:z.infer<typeof row>[];
  try{records=body.map(x=>row.parse(x));}
  catch{throw new SignedRlsABBlocked();}
  if(expected==="OTHER"){
    if(records.length!==0)throw new SignedRlsABBlocked();
    return;
  }
  if(records.length!==1||records[0].id!==accountId)
    throw new SignedRlsABBlocked();
}

function tamperSignature(jwt:string):string {
  const parts=jwt.split(".");
  const first=parts[2][0];
  const altered=(first==="A"?"B":"A")+parts[2].slice(1);
  return parts[0]+"."+parts[1]+"."+altered;
}

/** External test has no capability to POST, mutate accounts, or assume cash. */
export async function verifySignedClerkRlsAB(
  input:SignedRlsABInput,
  transport:ReadTransport=fetch,
  nowSeconds=Math.floor(Date.now()/1000),
):Promise<SignedRlsABEvidence>{
  verifyPreconditions(input,nowSeconds);
  const {actorA:a,actorB:b}=input;
  // Both positive owner checks are mandatory: empty responses never count as
  // independent actor proof.
  await probeAccount(input,a.jwt,a.accountId,transport,"OWN");
  await probeAccount(input,b.jwt,b.accountId,transport,"OWN");
  // Query the foreign ID deliberately WITHOUT an owner filter: only the
  // server's RLS is permitted to hide these rows.
  await probeAccount(input,a.jwt,b.accountId,transport,"OTHER");
  await probeAccount(input,b.jwt,a.accountId,transport,"OTHER");
  await probeAccount(input,tamperSignature(a.jwt),a.accountId,transport,"REJECT");
  return Object.freeze({
    state:"SIGNED_CLERK_AB_RLS_READ_ONLY_PASS",
    projectRef:TARGET,
    distinctClerkActors:true,
    verifiedOwnAccountReads:2,
    deniedCrossActorReads:2,
    rejectedTamperedBearer:true,
    httpMethods:"GET_ONLY",
    financialState:"NOT_ASSESSED",
    noFinancialWrites:true,
    scope:"EXTERNAL_POSTGREST_READ_ONLY",
  });
}
