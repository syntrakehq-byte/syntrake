import type {Pool,PoolClient} from "pg";

/**
 * R2 Preview data-plane preflight. A successful GitHub PG17 test is NOT proof
 * that an older Supabase Preview branch has a compatible schema/ACL.
 *
 * This is a READ-ONLY catalogue check. It does not apply migrations,
 * synthesize legacy coverage, grant roles, or execute privileged functions.
 * It deliberately fails closed if the historical user-executable
 * SECURITY DEFINER provisioning RPC still exists.
 */
export class PreviewImportCatalogBlocked extends Error {
  constructor() { super("R2_PREVIEW_CATALOG_BLOCKED"); }
}

type CatalogRow=Readonly<{
  missingCoverageColumns:string;
  incompatibleImportTables:string;
  safeWriterRole:boolean;
  privateImportRoleCanWrite:boolean;
  authenticatedCanInsert:boolean;
  writerCanPostLedger:boolean;
  writerCanFinalize:boolean;
  writerCanEditDeclaredCurrency:boolean;
  writerCanDeleteSnapshot:boolean;
  privilegedProvisioningRpcExposed:boolean;
}>;

/**
 * The pool must come from a private, server-only Preview DSN and must be
 * subject to the HTTP branch/ref/TLS authorization gate BEFORE this function.
 * Catalogue reads cannot establish that a claimed Clerk user owns a portfolio:
 * owner/RLS checks remain compulsory inside the financial operation itself.
 */
export async function assertPreviewImportCatalogReady(
  pool:Pick<Pool,"connect">,
):Promise<void> {
  let client:PoolClient|undefined;
  let opened=false;
  try {
    client=await pool.connect();
    await client.query("BEGIN READ ONLY");
    opened=true;
    // Prove the external restricted login can assume the intended NOLOGIN
    // role; all catalog checks happen under precisely that capability.
    await client.query("SET LOCAL ROLE investing_import_writer");
    const result=await client.query<CatalogRow>(
      "SELECT "+
      "(2 - (SELECT count(*) FROM pg_attribute "+
        "WHERE attrelid=to_regclass('investing.portfolio_import_snapshots') "+
        "AND attname IN ('reported_cash_coverage','reported_position_coverage') "+
        "AND atttypid='text'::regtype AND NOT attisdropped))::text AS \"missingCoverageColumns\","+
      "(4 - (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "+
        "WHERE n.nspname='investing' AND c.relkind='r' "+
        "AND c.relname IN ('portfolio_import_snapshots','portfolio_import_cash',"+
        "'portfolio_import_positions','portfolio_import_planned_contributions') "+
        "AND c.relrowsecurity AND c.relforcerowsecurity))::text AS \"incompatibleImportTables\","+
      "COALESCE((SELECT NOT rolcanlogin AND NOT rolbypassrls AND NOT rolsuper "+
        "FROM pg_roles WHERE rolname='investing_import_writer'),false) AS \"safeWriterRole\","+
      "COALESCE(has_table_privilege('investing_import_writer',"+
        "'investing.portfolio_import_snapshots','INSERT'),false) AS \"privateImportRoleCanWrite\","+
      "COALESCE(has_table_privilege('authenticated',"+
        "'investing.portfolio_import_snapshots','INSERT'),true) AS \"authenticatedCanInsert\","+
      "COALESCE(has_table_privilege('investing_import_writer',"+
        "'investing.ledger_transactions','INSERT'),true) AS \"writerCanPostLedger\","+
      "COALESCE(has_column_privilege('investing_import_writer',"+
        "'investing.portfolio_import_snapshots','snapshot_status','UPDATE'),false) AS \"writerCanFinalize\","+
      "COALESCE(has_column_privilege('investing_import_writer',"+
        "'investing.portfolio_import_snapshots','declared_base_currency','UPDATE'),true) AS \"writerCanEditDeclaredCurrency\","+
      "COALESCE(has_table_privilege('investing_import_writer',"+
        "'investing.portfolio_import_snapshots','DELETE'),true) AS \"writerCanDeleteSnapshot\","+
      "EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "+
        "WHERE n.nspname='investing' AND p.proname='provision_first_portfolio' "+
        "AND p.prosecdef AND has_function_privilege('authenticated',p.oid,'EXECUTE')) "+
        "AS \"privilegedProvisioningRpcExposed\""
    );
    // Read-only transaction ALWAYS ends before returning a readiness state.
    await client.query("ROLLBACK");
    opened=false;
    const d=result.rows[0];
    if(result.rows.length!==1 || !d ||
      d.missingCoverageColumns!=="0" ||
      d.incompatibleImportTables!=="0" ||
      d.safeWriterRole!==true ||
      d.privateImportRoleCanWrite!==true ||
      d.authenticatedCanInsert!==false ||
      d.writerCanPostLedger!==false ||
      d.writerCanFinalize!==true ||
      d.writerCanEditDeclaredCurrency!==false ||
      d.writerCanDeleteSnapshot!==false ||
      d.privilegedProvisioningRpcExposed!==false) {
      throw new PreviewImportCatalogBlocked();
    }
  }catch(e) {
    if(opened&&client)await client.query("ROLLBACK").catch(()=>undefined);
    if(e instanceof PreviewImportCatalogBlocked)throw e;
    // Never include SQL, actor info, environment refs or database details.
    throw new PreviewImportCatalogBlocked();
  }finally {
    client?.release();
  }
}
