import {InitialPortfolioBlocked} from "./initializeFirstPortfolio";
import {isR2C2PreviewReady,type HttpTransport} from "./initialPortfolioRuntime";

/**
 * Read-only discovery for owners of pre-R2-C2 Investing accounts.
 * This is NOT an account migration, receipt synthesis, or financial reconciliation.
 * Clerk auth() supplies the actor server-side; Supabase verifies JWT and enforces RLS.
 */
type Env=Readonly<Record<string,string|undefined>>;
type Actor=Readonly<{
 userId:string|null;sessionId:string|null;getToken:()=>Promise<string|null>;
}>;
export type ExistingAccountReview=Readonly<{
 accountId:string|null;
 portfolioIds:readonly string[];
 accountMultiplicity:"ONE"|"MULTIPLE";
 financialTruth:"UNAVAILABLE";
 reconciliation:"REQUIRED";
 evidence:"SUPABASE_RLS_READ";
}>;

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const clerkId=/^user_[A-Za-z0-9_-]{5,120}$/;
async function rows(env:Env,token:string,table:"investment_accounts"|"portfolios",
 filterName:string,filterId:string,select:string,limit:number,
 transport:HttpTransport):Promise<unknown[]>{
 const url=new URL("/rest/v1/"+table,env.NEXT_PUBLIC_SUPABASE_URL);
 url.searchParams.set("select",select);
 url.searchParams.set(filterName,"eq."+filterId);
 url.searchParams.set("limit",String(limit));
 let response:Response;
 try{
  response=await transport(url.toString(),{
   method:"GET",
   headers:{apikey:env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    Authorization:"Bearer "+token,"Accept-Profile":"investing",Accept:"application/json"},
   cache:"no-store",signal:AbortSignal.timeout(5000),
  });
 }catch{throw new InitialPortfolioBlocked("READ_UNAVAILABLE");}
 if(response.status===401||response.status===403)
  throw new InitialPortfolioBlocked("NOT_AUTHORIZED");
 if(!response.ok)throw new InitialPortfolioBlocked("READ_UNAVAILABLE");
 let value:unknown;
 try{value=await response.json();}catch{throw new InitialPortfolioBlocked("READ_UNAVAILABLE");}
 if(!Array.isArray(value)||value.length>limit)
  throw new InitialPortfolioBlocked("READ_UNAVAILABLE");
 return value;
}
export async function inspectExistingAccountViaClerkJwt(
 env:Env,actor:Actor,transport:HttpTransport=fetch,
):Promise<ExistingAccountReview|null>{
 if(!isR2C2PreviewReady(env))throw new InitialPortfolioBlocked("NOT_AUTHORIZED");
 if(!actor.userId||!clerkId.test(actor.userId)||!actor.sessionId)
  throw new InitialPortfolioBlocked("UNAUTHENTICATED");
 let token:string|null;
 try{token=await actor.getToken();}catch{throw new InitialPortfolioBlocked("NOT_AUTHORIZED");}
 if(!token||token.length>8192||!token.split(".").every(p=>/^[a-zA-Z0-9_-]+$/.test(p))||
    token.split(".").length!==3)
  throw new InitialPortfolioBlocked("NOT_AUTHORIZED");
 // No user-controlled query parameters or account ids. Both filters originate
 // from the authenticated Clerk session or verified owner-scoped RLS response.
 const own=await rows(env,token,"investment_accounts",
  "owner_user_id",actor.userId,"id,owner_user_id",2,transport);
 if(own.some(x=>!x||typeof x!=="object"||
   (x as Record<string,unknown>).owner_user_id!==actor.userId||
   typeof (x as Record<string,unknown>).id!=="string"||
   !uuid.test((x as Record<string,string>).id)))
  throw new InitialPortfolioBlocked("READ_UNAVAILABLE");
 if(own.length===0)return null;
 if(own.length===2)return {
  accountId:null,portfolioIds:[],accountMultiplicity:"MULTIPLE",
  financialTruth:"UNAVAILABLE",reconciliation:"REQUIRED",evidence:"SUPABASE_RLS_READ",
 };
 const accountId=(own[0] as {id:string}).id;
 const portfolioRows=await rows(env,token,"portfolios",
  "investment_account_id",accountId,"id,investment_account_id",51,transport);
 if(portfolioRows.length===51||portfolioRows.some(x=>!x||typeof x!=="object"||
   (x as Record<string,unknown>).investment_account_id!==accountId||
   typeof (x as Record<string,unknown>).id!=="string"||
   !uuid.test((x as Record<string,string>).id)))
  throw new InitialPortfolioBlocked("READ_UNAVAILABLE");
 const ids=portfolioRows.map(x=>(x as {id:string}).id);
 if(new Set(ids).size!==ids.length)throw new InitialPortfolioBlocked("READ_UNAVAILABLE");
 return {
  accountId,portfolioIds:ids,accountMultiplicity:"ONE",
  financialTruth:"UNAVAILABLE",reconciliation:"REQUIRED",evidence:"SUPABASE_RLS_READ",
 };
}
