import {Pool} from "pg";
import {auth} from "@clerk/nextjs/server";
import {initializeFirstInvestingPortfolio,InitialPortfolioBlocked,
  type InitialPortfolioReceipt} from "./initializeFirstPortfolio";
export const R2C2_BRANCH="candidate/investing-r2c2-first-portfolio-20261023";
export const R2C2_PROJECT="zkqgpejlkgootkvkebhd";
type Env=Readonly<Record<string,string|undefined>>;
export function isR2C2PreviewReady(env:Env):boolean{
 return env.VERCEL_ENV==="preview"
  && env.VERCEL_GIT_COMMIT_REF===R2C2_BRANCH
  && env.INVESTING_R2C2_PREVIEW_MODE==="enabled"
  && env.INVESTING_R2C2_SUPABASE_PROJECT_REF===R2C2_PROJECT;
}
let pool:Pool|null=null;
function privatePool(env:Env):Pool{
 if(!isR2C2PreviewReady(env))throw new InitialPortfolioBlocked("NOT_AUTHORIZED");
 const value=env.INVESTING_R2C2_DATABASE_URL;
 if(!value)throw new InitialPortfolioBlocked("WRITE_UNAVAILABLE");
 let url:URL;
 try{url=new URL(value);}catch{throw new InitialPortfolioBlocked("WRITE_UNAVAILABLE");}
 if(url.protocol!=="postgresql:"&&url.protocol!=="postgres:")
  throw new InitialPortfolioBlocked("WRITE_UNAVAILABLE");
 if(!url.username||!url.password||!url.hostname||
    !(url.hostname==="db."+R2C2_PROJECT+".supabase.co"||
      url.hostname.endsWith(".pooler.supabase.com"))||
    !["5432","6543"].includes(url.port))throw new InitialPortfolioBlocked("WRITE_UNAVAILABLE");
 if(url.search||url.hash)throw new InitialPortfolioBlocked("WRITE_UNAVAILABLE");
 if(pool)return pool;
 const ca=env.INVESTING_R2C2_PG_CA_PEM;
 pool=new Pool({
  connectionString:value,ssl:ca?{rejectUnauthorized:true,ca}:{rejectUnauthorized:true},
  max:2,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,
  application_name:"syntrake-investing-r2c2-preview",
 });
 return pool;
}
export async function provisionFromClerk(env:Env,request:unknown):Promise<InitialPortfolioReceipt>{
 if(!isR2C2PreviewReady(env))throw new InitialPortfolioBlocked("NOT_AUTHORIZED");
 const session=await auth();
 return initializeFirstInvestingPortfolio(privatePool(env),
  {userId:session.userId,sessionId:session.sessionId},request);
}
export async function readInitialPortfolioFromClerk(env:Env):Promise<InitialPortfolioReceipt|null>{
 if(!isR2C2PreviewReady(env))throw new InitialPortfolioBlocked("NOT_AUTHORIZED");
 const session=await auth();
 if(!session.userId||!session.sessionId)throw new InitialPortfolioBlocked("UNAUTHENTICATED");
 const db=await privatePool(env).connect();let begun=false;
 try{
  await db.query("BEGIN");begun=true;
  await db.query("SET LOCAL ROLE investing_initial_provisioner");
  await db.query("SELECT set_config('syntrake.actor_user_id',$1,true)",[session.userId]);
  const r=await db.query<{account_id:string;portfolio_id:string}>(
   "SELECT account_id,portfolio_id FROM investing.initial_portfolio_receipts WHERE user_id=$1",
   [session.userId],
  );
  await db.query("COMMIT");begun=false;
  const row=r.rows[0];return row?{
   accountId:row.account_id,portfolioId:row.portfolio_id,
   state:"STRUCTURE_CREATED_UNFUNDED",financialTruth:"UNAVAILABLE",
   ledgerMovementsCreated:false,brokerConfirmed:false,cashBalance:"UNAVAILABLE",
  }:null;
 }catch{if(begun)await db.query("ROLLBACK").catch(()=>undefined);
  throw new InitialPortfolioBlocked("WRITE_UNAVAILABLE");}
 finally{db.release();}
}
