import {z} from "zod";
import type {Pool} from "pg";
import {PortfolioImportReadBlocked} from "./readOwnPortfolioImport";
type Actor=Readonly<{userId:string|null;sessionId:string|null}>;
export type ImportList=Readonly<{
  kind:"UNVERIFIED_IMPORT_HISTORY";
  portfolioId:string;
  records:readonly Readonly<{
    snapshotId:string; sourceReference:string; asOf:string;
    reportedCoverage:Readonly<{cash:"NOT_REPORTED"|"PARTIAL"|"ASSERTED_COMPLETE";
      positions:"NOT_REPORTED"|"PARTIAL"|"ASSERTED_COMPLETE"}>;
    evidenceStatus:"UNVERIFIED";
  }>[];
  hasMore:boolean;
  valuation:"UNAVAILABLE";
  financialWrites:false;
}>;
const coverage=z.enum(["NOT_REPORTED","PARTIAL","ASSERTED_COMPLETE"]);
export async function listOwnPortfolioImports(
  pool:Pick<Pool,"connect">,actor:Actor,portfolioIdUntrusted:unknown,
):Promise<ImportList>{
  if(!actor.userId||!actor.sessionId)throw new PortfolioImportReadBlocked("UNAUTHENTICATED");
  const portfolioId=z.string().uuid().safeParse(portfolioIdUntrusted);
  if(!portfolioId.success)throw new PortfolioImportReadBlocked("INVALID_INPUT");
  const db=await pool.connect().catch(()=>{throw new PortfolioImportReadBlocked("READ_UNAVAILABLE")});
  let tx=false;
  try{
    await db.query("BEGIN READ ONLY");tx=true;
    await db.query("SET LOCAL ROLE investing_import_writer");
    await db.query("SELECT set_config('syntrake.actor_user_id',$1,true)",[actor.userId]);
    const owner=await db.query<{id:string}>(
      "SELECT p.id FROM investing.portfolios p "+
      "JOIN investing.investment_accounts a ON a.id=p.investment_account_id "+
      "JOIN investing.account_memberships m ON m.investment_account_id=a.id "+
      "AND m.user_id=a.owner_user_id AND m.role='owner' "+
      "WHERE p.id=$1 AND a.owner_user_id=$2",
      [portfolioId.data,actor.userId]);
    if(owner.rows.length!==1)throw new PortfolioImportReadBlocked("NOT_AUTHORIZED");
    const rows=await db.query<{
      id:string;source_reference:string;as_of:string;
      reported_cash_coverage:string;reported_position_coverage:string;evidence_status:string;
    }>(
      "SELECT id,source_reference,"+
      "to_char(source_as_of AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS as_of,"+
      "reported_cash_coverage,reported_position_coverage,evidence_status "+
      "FROM investing.portfolio_import_snapshots "+
      "WHERE portfolio_id=$1 AND actor_user_id=$2 AND snapshot_status='finalized' "+
      "ORDER BY created_at DESC,id DESC LIMIT 21",
      [portfolioId.data,actor.userId]);
    const records=rows.rows.slice(0,20).map(v=>{
      if(v.evidence_status!=="UNVERIFIED")throw new PortfolioImportReadBlocked("READ_UNAVAILABLE");
      return Object.freeze({
        snapshotId:z.string().uuid().parse(v.id),
        sourceReference:v.source_reference,
        asOf:v.as_of,
        reportedCoverage:Object.freeze({
          cash:coverage.parse(v.reported_cash_coverage),
          positions:coverage.parse(v.reported_position_coverage),
        }),
        evidenceStatus:"UNVERIFIED" as const,
      });
    });
    await db.query("COMMIT");tx=false;
    return Object.freeze({kind:"UNVERIFIED_IMPORT_HISTORY",portfolioId:portfolioId.data,
      records:Object.freeze(records),hasMore:rows.rows.length>20,
      valuation:"UNAVAILABLE",financialWrites:false});
  }catch(e){
    if(tx)await db.query("ROLLBACK").catch(()=>undefined);
    if(e instanceof PortfolioImportReadBlocked)throw e;
    throw new PortfolioImportReadBlocked("READ_UNAVAILABLE");
  }finally{db.release();}
}
