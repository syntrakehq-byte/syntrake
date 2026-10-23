import {createHash} from "node:crypto";
import {z} from "zod";
import type {Pool,PoolClient} from "pg";

export const initializeCommand=z.object({
  idempotencyKey:z.string().uuid(),
  accountName:z.string().trim().min(2).max(80),
  portfolioName:z.string().trim().min(2).max(80),
  baseCurrency:z.enum(["EUR","USD","GBP","CHF","JPY","KWD"]),
}).strict();
export type InitializeCommand=z.infer<typeof initializeCommand>;
export type InitialPortfolioReceipt=Readonly<{
  accountId:string;portfolioId:string;
  state:"STRUCTURE_CREATED_UNFUNDED";
  financialTruth:"UNAVAILABLE";
  ledgerMovementsCreated:false;
  brokerConfirmed:false;
  cashBalance:"UNAVAILABLE";
}>;
export class InitialPortfolioBlocked extends Error{
  constructor(public readonly code:
    "UNAUTHENTICATED"|"INVALID_INPUT"|"NO_ONBOARDING_INTENT"|
    "INITIAL_PORTFOLIO_ALREADY_EXISTS"|"IDEMPOTENCY_CONFLICT"|
    "NOT_AUTHORIZED"|"WRITE_UNAVAILABLE"){super(code);}
}
type ServerActor=Readonly<{userId:string|null;sessionId:string|null}>;
type DB=Pick<Pool,"connect">;
function receipt(accountId:string,portfolioId:string):InitialPortfolioReceipt{
  return {accountId,portfolioId,state:"STRUCTURE_CREATED_UNFUNDED",
    financialTruth:"UNAVAILABLE",ledgerMovementsCreated:false,brokerConfirmed:false,cashBalance:"UNAVAILABLE"};
}
function fingerprint(input:InitializeCommand):string{
  return createHash("sha256").update(JSON.stringify({
    accountName:input.accountName,portfolioName:input.portfolioName,
    baseCurrency:input.baseCurrency,operation:"INITIAL_INVESTING_PORTFOLIO_V1",
  }),"utf8").digest("hex");
}
/** Transaction-scoped NOLOGIN role. Only SERVER-VERIFIED Clerk user ID may be set. */
export async function initializeFirstInvestingPortfolio(
  pool:DB,actor:ServerActor,untrusted:unknown,
):Promise<InitialPortfolioReceipt>{
  if(!actor.userId||!actor.sessionId||!/^user_[A-Za-z0-9_-]{5,120}$/.test(actor.userId))
    throw new InitialPortfolioBlocked("UNAUTHENTICATED");
  const parsed=initializeCommand.safeParse(untrusted);
  if(!parsed.success)throw new InitialPortfolioBlocked("INVALID_INPUT");
  const data=parsed.data,hash=fingerprint(data);
  let db:PoolClient|undefined,open=false;
  try{
    db=await pool.connect();
    await db.query("BEGIN");open=true;
    await db.query("SET LOCAL ROLE investing_initial_provisioner");
    const role=await db.query<{role:string}>("select current_user as role");
    if(role.rows[0]?.role!=="investing_initial_provisioner")
      throw new InitialPortfolioBlocked("NOT_AUTHORIZED");
    await db.query("SELECT set_config('lock_timeout','1500ms',true),"+
      "set_config('statement_timeout','7000ms',true),"+
      "set_config('idle_in_transaction_session_timeout','9000ms',true)");
    await db.query("SELECT set_config('syntrake.actor_user_id',$1,true)",[actor.userId]);
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('syntrake.investing.initial:'||$1::text,20261023))",
      [actor.userId],
    );
    const prior=await db.query<{idempotency_key:string;request_sha256:string;account_id:string;portfolio_id:string}>(
      "SELECT idempotency_key,request_sha256,account_id,portfolio_id "+
      "FROM investing.initial_portfolio_receipts WHERE user_id=$1",
      [actor.userId],
    );
    if(prior.rows.length===1){
      const row=prior.rows[0];
      if(row.idempotency_key!==data.idempotencyKey||row.request_sha256!==hash)
        throw new InitialPortfolioBlocked("INITIAL_PORTFOLIO_ALREADY_EXISTS");
      await db.query("COMMIT");open=false;
      return receipt(row.account_id,row.portfolio_id);
    }
    const intent=await db.query<{id:string}>(
      "SELECT id FROM investing.onboarding_intents "+
      "WHERE actor_user_id=$1 AND evidence='USER_REPORTED' "+
      "AND financial_state='NOT_PROVISIONED' ORDER BY created_at DESC,id DESC LIMIT 1",
      [actor.userId],
    );
    if(intent.rows.length!==1)throw new InitialPortfolioBlocked("NO_ONBOARDING_INTENT");
    const c=await db.query<{code:string}>(
      "SELECT code FROM investing.supported_currencies WHERE code=$1",[data.baseCurrency]);
    if(c.rows.length!==1)throw new InitialPortfolioBlocked("INVALID_INPUT");
    await db.query(
      "INSERT INTO investing.identity_accounts(user_id) VALUES ($1) ON CONFLICT DO NOTHING",
      [actor.userId],
    );
    const account=await db.query<{id:string}>(
      "INSERT INTO investing.investment_accounts(owner_user_id,name,base_currency) "+
      "VALUES ($1,$2,$3) RETURNING id",
      [actor.userId,data.accountName,data.baseCurrency],
    );
    if(account.rows.length!==1)throw new InitialPortfolioBlocked("WRITE_UNAVAILABLE");
    const accountId=account.rows[0].id;
    await db.query(
      "INSERT INTO investing.account_memberships(investment_account_id,user_id,role) "+
      "VALUES ($1,$2,'owner')",[accountId,actor.userId],
    );
    const portfolio=await db.query<{id:string}>(
      "INSERT INTO investing.portfolios(investment_account_id,name) "+
      "VALUES ($1,$2) RETURNING id",[accountId,data.portfolioName],
    );
    if(portfolio.rows.length!==1)throw new InitialPortfolioBlocked("WRITE_UNAVAILABLE");
    const portfolioId=portfolio.rows[0].id;
    const codes=["cash","external_clearing","position_cost","income","expense","equity"];
    for(const code of codes){
      await db.query(
        "INSERT INTO investing.ledger_accounts(investment_account_id,code,currency) "+
        "VALUES ($1,$2,$3)",[accountId,code,data.baseCurrency],
      );
    }
    await db.query(
      "INSERT INTO investing.initial_portfolio_receipts"+
      "(user_id,idempotency_key,request_sha256,account_id,portfolio_id) "+
      "VALUES ($1,$2,$3,$4,$5)",
      [actor.userId,data.idempotencyKey,hash,accountId,portfolioId],
    );
    await db.query("COMMIT");open=false;
    return receipt(accountId,portfolioId);
  }catch(e){
    if(open&&db)await db.query("ROLLBACK").catch(()=>undefined);
    if(e instanceof InitialPortfolioBlocked)throw e;
    // Do not reveal schema, SQL statements or transport credentials to callers.
    throw new InitialPortfolioBlocked("WRITE_UNAVAILABLE");
  }finally{db?.release();}
}
