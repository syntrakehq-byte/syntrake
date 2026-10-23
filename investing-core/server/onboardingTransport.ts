import { onboardingCommandSchema, onboardingFingerprint, parseStoredOnboardingRow,
  type OnboardingEvent, type OnboardingCommand } from "../onboarding/onboardingIntent";

export const R2C_PREVIEW_PROJECT = "zkqgpejlkgootkvkebhd";
export const R2C_PREVIEW_BRANCH = "candidate/investing-r2c-onboarding-20261022";
type Config = Readonly<Record<string,string | undefined>>;
type ClerkActor = Readonly<{
  userId: string | null;
  sessionId: string | null;
  getToken: () => Promise<string | null>;
}>;
export type Transport = (url:string,init:RequestInit) => Promise<Response>;
export class OnboardingBlocked extends Error {
  constructor(public readonly code:
    "DISABLED"|"UNAUTHENTICATED"|"INVALID_INPUT"|"TOKEN_UNAVAILABLE"|
    "UNAUTHORIZED"|"UNAVAILABLE"|"INVALID_RESPONSE"|"IDEMPOTENCY_CONFLICT") {
    super(code);
  }
}
export function isR2CPreviewEnabled(env:Config): boolean {
  return env.VERCEL_ENV==="preview"
    && (env.VERCEL_GIT_COMMIT_REF===R2C_PREVIEW_BRANCH ||
      (env.VERCEL_GIT_COMMIT_REF==="candidate/investing-r2c2-first-portfolio-20261023"
       && env.INVESTING_R2C2_PREVIEW_MODE==="enabled"
       && env.INVESTING_R2C2_SUPABASE_PROJECT_REF===R2C_PREVIEW_PROJECT))
    && env.INVESTING_R2C_PREVIEW_MODE==="enabled"
    && env.INVESTING_R2C_SUPABASE_PROJECT_REF===R2C_PREVIEW_PROJECT
    && env.NEXT_PUBLIC_SUPABASE_URL==="https://"+R2C_PREVIEW_PROJECT+".supabase.co"
    && /^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"");
}
export const onboardingHeaders=Object.freeze({
  "Cache-Control":"private, no-store, max-age=0",
  "Vary":"Cookie, Authorization",
  "X-Robots-Tag":"noindex, nofollow, noarchive",
  "Referrer-Policy":"no-referrer",
});
function jwtLooksPlausible(value:string|null):value is string {
  return !!value && value.length<=8192 && value.split(".").length===3
    && value.split(".").every(p=>/^[A-Za-z0-9_-]+$/.test(p));
}
async function bearer(actor:ClerkActor):Promise<string> {
  if(!actor.userId||!actor.sessionId)throw new OnboardingBlocked("UNAUTHENTICATED");
  let token:string|null;
  try { token=await actor.getToken(); }catch { throw new OnboardingBlocked("TOKEN_UNAVAILABLE"); }
  if(!jwtLooksPlausible(token))throw new OnboardingBlocked("TOKEN_UNAVAILABLE");
  return token;
}
function restUrl(env:Config):URL {
  return new URL("/rest/v1/onboarding_intents",env.NEXT_PUBLIC_SUPABASE_URL);
}
function headers(env:Config,token:string,read:boolean):HeadersInit {
  return {
    apikey:env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    Authorization:"Bearer "+token,
    ...(read?{"Accept-Profile":"investing"}:{"Content-Profile":"investing"}),
    Accept:"application/json",
    "Content-Type":"application/json",
  };
}
async function perform(request:Promise<Response>):Promise<Response> {
  let r:Response;
  try{r=await request;}catch{throw new OnboardingBlocked("UNAVAILABLE");}
  if(r.status===401||r.status===403)throw new OnboardingBlocked("UNAUTHORIZED");
  if(!r.ok)throw new OnboardingBlocked("UNAVAILABLE");
  return r;
}
const columns="id,pathway,import_source,objective,horizon_years,loss_capacity,evidence,financial_state,created_at";
async function selectEvents(
  env:Config,token:string,transport:Transport,filterKey?:string,
):Promise<OnboardingEvent[]> {
  const endpoint=restUrl(env);
  endpoint.searchParams.set("select",columns);
  endpoint.searchParams.set("order","created_at.desc,id.desc");
  endpoint.searchParams.set("limit",filterKey?"2":"1");
  if(filterKey)endpoint.searchParams.set("idempotency_key","eq."+filterKey);
  const r=await perform(transport(endpoint.toString(),{
    method:"GET",headers:headers(env,token,true),cache:"no-store",
    signal:AbortSignal.timeout(5000),
  }));
  let data:unknown;
  try{data=await r.json();}catch{throw new OnboardingBlocked("INVALID_RESPONSE");}
  if(!Array.isArray(data)||data.length>2)throw new OnboardingBlocked("INVALID_RESPONSE");
  try {return data.map(parseStoredOnboardingRow);}
  catch{throw new OnboardingBlocked("INVALID_RESPONSE");}
}
/**
 * GET latest user-declared onboarding path. Never [] on missing token,
 * network/permission errors; no account ID, capital, or holdings inferred.
 */
export async function latestOnboarding(
  env:Config,actor:ClerkActor,transport:Transport=fetch,
):Promise<OnboardingEvent|null> {
  if(!isR2CPreviewEnabled(env))throw new OnboardingBlocked("DISABLED");
  const token=await bearer(actor);
  return (await selectEvents(env,token,transport))[0]??null;
}
/**
 * Append a user-declared onboarding choice via signed Clerk JWT and Supabase
 * authenticated RLS. No PG privileged secret; no account/portfolio/ledger DML.
 */
export async function declareOnboarding(
  env:Config,actor:ClerkActor,untrusted:unknown,transport:Transport=fetch,
):Promise<OnboardingEvent> {
  if(!isR2CPreviewEnabled(env))throw new OnboardingBlocked("DISABLED");
  let input:OnboardingCommand;
  try{input=onboardingCommandSchema.parse(untrusted);}
  catch{throw new OnboardingBlocked("INVALID_INPUT");}
  const token=await bearer(actor);
  const hash=onboardingFingerprint(input.choice);
  const endpoint=restUrl(env);
  endpoint.searchParams.set("on_conflict","actor_user_id,idempotency_key");
  const choice=input.choice;
  const fields=choice.pathway==="HAS_PORTFOLIO"
    ?{import_source:choice.importSource,objective:null,horizon_years:null,loss_capacity:null}
    :{import_source:null,objective:choice.objective,horizon_years:choice.horizonYears,loss_capacity:choice.lossCapacity};
  const body={
    actor_user_id:actor.userId,
    idempotency_key:input.idempotencyKey,
    payload_sha256:hash,
    pathway:choice.pathway,
    ...fields,
    evidence:"USER_REPORTED" as const,
    financial_state:"NOT_PROVISIONED" as const,
  };
  await perform(transport(endpoint.toString(),{
    method:"POST",
    headers:{...headers(env,token,false),Prefer:"resolution=ignore-duplicates,return=minimal"},
    body:JSON.stringify(body),cache:"no-store",signal:AbortSignal.timeout(5000),
  }));
  const existing=await selectEvents(env,token,transport,input.idempotencyKey);
  if(existing.length!==1)throw new OnboardingBlocked("UNAVAILABLE");
  // A replay is accepted ONLY for the same canonical declaration. Comparing
  // canonical facts additionally protects from PostgREST race/malformed state.
  if(onboardingFingerprint(existing[0].choice)!==hash) {
    throw new OnboardingBlocked("IDEMPOTENCY_CONFLICT");
  }
  return existing[0];
}
