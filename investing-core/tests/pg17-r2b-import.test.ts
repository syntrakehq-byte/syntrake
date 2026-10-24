import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, Pool } from "pg";
import { savePortfolioImport, PortfolioImportBlocked } from "../server/savePortfolioImport";
import { readOwnPortfolioImport, PortfolioImportReadBlocked } from "../server/readOwnPortfolioImport";
import {handlePortfolioImportHttp} from "../server/importPreviewHttp";
import {listOwnPortfolioImports} from "../server/listOwnPortfolioImports";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b1";
const PORT_A = "00000000-0000-4000-8000-0000000000a2";
const PORT_B = "00000000-0000-4000-8000-0000000000b2";
const actorA = { userId: "user_ci_investing_a", sessionId: "ci-session-a" };
const actorB = { userId: "user_ci_investing_b", sessionId: "ci-session-b" };
const draft = () => ({
  schemaVersion: "R2_IMPORT_DRAFT_V1" as const,
  source: "MANUAL_ENTRY" as const,
  sourceReference: "ci-import-source-001",
  asOf: "2026-10-22T18:00:00.000Z",
  portfolioName: "Long term",
  baseCurrency: "EUR",
  reportedCoverage: { cash: "PARTIAL" as const, positions: "PARTIAL" as const },
  cashBalances: [
    { currency: "USD", amountMinor: "9007199254740993" },
    { currency: "EUR", amountMinor: "32500" },
  ],
  positions: [
    { instrument: { isin: "US0378331005", mic: "XNAS", quoteCurrency: "USD" },
      quantity: "1.000000000001", reportedCostBasis: null },
  ],
  plannedContributions: [
    { currency: "EUR", amountMinor: "10000", dueDate: "2026-11-01" },
  ],
});

test("R2-B1 isolated PG17: owner A/B, immutable atomic import, negative capability", async () => {
  const url = process.env.INVESTING_PG17_R2B_URL;
  assert.ok(url, "isolated PG17 URL mandatory; never run on Production");
  const admin = new Client({ connectionString: url });
  await admin.connect();
  let pool: Pool | undefined;
  try {
    const version = await admin.query<{v:string}>("select current_setting('server_version') as v");
    assert.match(version.rows[0].v,/^17\./);
    await admin.query("create role anon noinherit");
    await admin.query("create role authenticated noinherit");
    await admin.query("create schema auth");
    await admin.query("create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$");
    await admin.query("grant usage on schema auth to authenticated");
    await admin.query("grant execute on function auth.jwt() to authenticated");
    for (const path of [
      "../../supabase/migrations/20261017160000_investing_core_foundation.sql",
      "../../supabase/migrations/20261018070000_investing_owner_membership_guard.sql",
      "../../supabase/release-candidates/20261022200000_r2b_unverified_portfolio_imports.sql",
    ]) {
      const sql=await readFile(new URL(path,import.meta.url),"utf8");
      await admin.query(sql);
    }
    const tables=await admin.query<{name:string;enabled:boolean;forced:boolean}>(
      "select c.relname as name,c.relrowsecurity enabled,c.relforcerowsecurity forced "+
      "from pg_class c join pg_namespace n on n.oid=c.relnamespace "+
      "where n.nspname='investing' and c.relkind='r' order by c.relname");
    assert.equal(tables.rows.length,13);
    for(const row of tables.rows.filter(r=>r.name.startsWith("portfolio_import_"))) {
      assert.equal(row.enabled,true); assert.equal(row.forced,true);
    }
    const rights=await admin.query<{
      anonRead:boolean;authRead:boolean;authWrite:boolean;writerRead:boolean;
      writerInsert:boolean;writerDelete:boolean;writerLedger:boolean;writerAccount:boolean;
    }>(
      "select has_table_privilege('anon','investing.portfolio_import_snapshots','SELECT') \"anonRead\","+
      "has_table_privilege('authenticated','investing.portfolio_import_snapshots','SELECT') \"authRead\","+
      "has_table_privilege('authenticated','investing.portfolio_import_snapshots','INSERT') \"authWrite\","+
      "has_table_privilege('investing_import_writer','investing.portfolio_import_snapshots','SELECT') \"writerRead\","+
      "has_table_privilege('investing_import_writer','investing.portfolio_import_snapshots','INSERT') \"writerInsert\","+
      "has_table_privilege('investing_import_writer','investing.portfolio_import_snapshots','DELETE') \"writerDelete\","+
      "has_table_privilege('investing_import_writer','investing.ledger_entries','INSERT') \"writerLedger\","+
      "has_table_privilege('investing_import_writer','investing.investment_accounts','INSERT') \"writerAccount\"");
    assert.deepEqual(rights.rows[0],{
      anonRead:false,authRead:false,authWrite:false,writerRead:true,
      writerInsert:true,writerDelete:false,writerLedger:false,writerAccount:false,
    });
    const role=await admin.query<{can_login:boolean;bypass:boolean}>(
      "select rolcanlogin can_login,rolbypassrls bypass from pg_roles where rolname='investing_import_writer'");
    assert.deepEqual(role.rows[0],{can_login:false,bypass:false});

    // CI fixtures. This is an ISOLATED disposable database, never Supabase.
    await admin.query("BEGIN");
    await admin.query("insert into investing.identity_accounts(user_id) values ($1),($2)",[actorA.userId,actorB.userId]);
    await admin.query("insert into investing.investment_accounts(id,owner_user_id,name,base_currency) values ($1,$2,'A','EUR'),($3,$4,'B','EUR')",[A,actorA.userId,B,actorB.userId]);
    await admin.query("insert into investing.account_memberships(investment_account_id,user_id,role) values ($1,$2,'owner'),($3,$4,'owner')",[A,actorA.userId,B,actorB.userId]);
    await admin.query("insert into investing.portfolios(id,investment_account_id,name) values ($1,$2,'Long A'),($3,$4,'Long B')",[PORT_A,A,PORT_B,B]);
    await admin.query("COMMIT");
    await admin.query("create role investing_import_ci login noinherit password 'ci-isolated-test-only'");
    await admin.query("grant investing_import_writer to investing_import_ci with inherit false, set true");
    await admin.query("grant connect on database syntrake_test to investing_import_ci");
    const runtime=new URL(url);
    runtime.username="investing_import_ci"; runtime.password="ci-isolated-test-only";
    pool=new Pool({connectionString:runtime.toString(),max:3});
    const command={portfolioId:PORT_A,idempotencyKey:"import-idempotent-0001",declaration:draft()};
    const first=await savePortfolioImport(pool,actorA,command);
    assert.equal(first.kind,"UNVERIFIED_IMPORT");
    assert.equal(first.ledgerChanged,false);
    const replay=await savePortfolioImport(pool,actorA,command);
    assert.deepEqual(first,replay);

    // True role-restricted owner readback: no admin bypass, no browser session.
    const read = await readOwnPortfolioImport(pool,actorA,{portfolioId:PORT_A,snapshotId:first.snapshotId});
    assert.equal(read.snapshotId,first.snapshotId);
    assert.equal(read.portfolioId,PORT_A);
    assert.equal(read.kind,"UNVERIFIED_IMPORT");
    assert.equal(read.evidenceStatus,"UNVERIFIED");
    assert.equal(read.provenance.sourceReference,draft().sourceReference);
    assert.equal(read.provenance.asOf,"2026-10-22T18:00:00.000Z");
    assert.equal(read.reportedCoverage.cash,"PARTIAL");
    assert.equal(read.reportedCoverage.positions,"PARTIAL");
    assert.deepEqual(read.cashBalances.map(c=>[c.currency,c.minor]),[
      ["EUR",32500n],["USD",9007199254740993n],
    ]);
    assert.equal(read.positions[0]?.quantityAtoms,1000000000001n);
    assert.equal(read.positions[0]?.reportedCostBasis,null);
    assert.deepEqual(read.plannedContributions.map(c=>[c.minor,c.dueDate,c.realized]),[
      [10000n,"2026-11-01",false],
    ]);
    assert.equal(read.verifiedCash,"UNAVAILABLE");
    assert.equal(read.valuation,"UNAVAILABLE");
    assert.equal(read.performance,"UNAVAILABLE");
    assert.equal(read.ledgerChanged,false);
    assert.equal(Object.isFrozen(read),true);
    assert.equal(Object.isFrozen(read.reportedCoverage),true);

    await assert.rejects(
      readOwnPortfolioImport(pool,actorB,{portfolioId:PORT_A,snapshotId:first.snapshotId}),
      (e:unknown)=>e instanceof PortfolioImportReadBlocked&&e.code==="NOT_AUTHORIZED");
    await assert.rejects(
      readOwnPortfolioImport(pool,{userId:null,sessionId:null},{portfolioId:PORT_A,snapshotId:first.snapshotId}),
      (e:unknown)=>e instanceof PortfolioImportReadBlocked&&e.code==="UNAUTHENTICATED");
    await assert.rejects(
      readOwnPortfolioImport(pool,actorA,{portfolioId:PORT_A,snapshotId:"forged"}),
      (e:unknown)=>e instanceof PortfolioImportReadBlocked&&e.code==="INVALID_INPUT");
    await assert.rejects(
      readOwnPortfolioImport(pool,actorA,{portfolioId:PORT_A,snapshotId:PORT_B}),
      (e:unknown)=>e instanceof PortfolioImportReadBlocked&&e.code==="NOT_FOUND");

    const journalCount=await admin.query<{count:string}>("select count(*)::text as count from investing.ledger_transactions");
    assert.equal(journalCount.rows[0].count,"0");
    const snapshots=await admin.query<{id:string;declared_base_currency:string; evidence_status:string; reported_cash_coverage:string;reported_position_coverage:string}>(
      "select id,declared_base_currency,evidence_status,reported_cash_coverage,reported_position_coverage from investing.portfolio_import_snapshots");
    assert.equal(snapshots.rows.length,1);
    assert.equal(snapshots.rows[0].id,first.snapshotId);
    assert.equal(snapshots.rows[0].declared_base_currency.trim(),"EUR");
    assert.equal(snapshots.rows[0].evidence_status,"UNVERIFIED");
    assert.equal(snapshots.rows[0].reported_cash_coverage,"PARTIAL");
    assert.equal(snapshots.rows[0].reported_position_coverage,"PARTIAL");
    const money=await admin.query<{currency:string;amount:string}>(
      "select currency,reported_amount_minor::text amount from investing.portfolio_import_cash order by currency");
    assert.deepEqual(money.rows.map(r=>[r.currency.trim(),r.amount]),[
      ["EUR","32500"],["USD","9007199254740993"],
    ]);
    const position=await admin.query<{atoms:string;reported_cost_minor:string|null}>(
      "select quantity_atoms::text atoms,reported_cost_minor::text from investing.portfolio_import_positions");
    assert.deepEqual(position.rows,[{atoms:"1000000000001",reported_cost_minor:null}]);
    const planned=await admin.query<{realized:boolean}>("select realized from investing.portfolio_import_planned_contributions");
    assert.deepEqual(planned.rows,[{realized:false}]);

    // Wrong owner; foreign tenant selector never establishes authority.
    await assert.rejects(
      savePortfolioImport(pool,actorB,{...command,idempotencyKey:"import-wrong-owner01"}),
      (e:unknown)=>e instanceof PortfolioImportBlocked&&e.code==="NOT_AUTHORIZED");
    await assert.rejects(
      savePortfolioImport(pool,actorA,{...command,declaration:{...draft(),cashBalances:[{currency:"EUR",amountMinor:"999"}]}}),
      (e:unknown)=>e instanceof PortfolioImportBlocked&&e.code==="IDEMPOTENCY_CONFLICT");
    // Reusing an idempotency key while changing declared coverage is forbidden.
    await assert.rejects(
      savePortfolioImport(pool,actorA,{...command,declaration:{
        ...draft(),reportedCoverage:{cash:"ASSERTED_COMPLETE",positions:"PARTIAL"},
      }}),
      (e:unknown)=>e instanceof PortfolioImportBlocked&&e.code==="IDEMPOTENCY_CONFLICT");
    await assert.rejects(
      savePortfolioImport(pool,actorA,{...command,idempotencyKey:"different-key-00001"}),
      (e:unknown)=>e instanceof PortfolioImportBlocked&&e.code==="SOURCE_CONFLICT");
    await assert.rejects(
      savePortfolioImport(pool,{userId:null,sessionId:null},command),
      (e:unknown)=>e instanceof PortfolioImportBlocked&&e.code==="UNAUTHENTICATED");
    await assert.rejects(
      savePortfolioImport(pool,actorA,{...command,declaration:{...draft(),actorId:actorB.userId}}),
      (e:unknown)=>e instanceof PortfolioImportBlocked&&e.code==="INVALID_INPUT");

    const concurrent=await Promise.all([
      savePortfolioImport(pool,actorB,{portfolioId:PORT_B,idempotencyKey:"import-b-concurrent1",declaration:draft()}),
      savePortfolioImport(pool,actorB,{portfolioId:PORT_B,idempotencyKey:"import-b-concurrent1",declaration:draft()}),
    ]);
    assert.deepEqual(concurrent[0],concurrent[1]);
    const ownB = await readOwnPortfolioImport(pool,actorB,{
      portfolioId:PORT_B,snapshotId:concurrent[0].snapshotId,
    });
    assert.equal(ownB.portfolioId,PORT_B);
    assert.equal(ownB.provenance.sourceReference,draft().sourceReference);
    await assert.rejects(
      readOwnPortfolioImport(pool,actorA,{portfolioId:PORT_B,snapshotId:concurrent[0].snapshotId}),
      (e:unknown)=>e instanceof PortfolioImportReadBlocked&&e.code==="NOT_AUTHORIZED");
    const bRows=await admin.query<{count:string}>(
      "select count(*)::text as count from investing.portfolio_import_snapshots where portfolio_id=$1",[PORT_B]);
    assert.equal(bRows.rows[0].count,"1");
    await assert.rejects(admin.query(
      "update investing.portfolio_import_cash set reported_amount_minor=123 where snapshot_id=$1",
      [first.snapshotId]), /immutable/);
    await assert.rejects(admin.query(
      "delete from investing.portfolio_import_snapshots where id=$1",[first.snapshotId]),/immutable/);

    // A finalized parent cannot receive a late cash row after COMMIT.
    const raw=await pool.connect();
    try {
      await raw.query("BEGIN");
      await raw.query("SET LOCAL ROLE investing_import_writer");
      await raw.query("SELECT set_config('syntrake.actor_user_id',$1,true)",[actorA.userId]);
      const visible=await raw.query<{id:string}>(
        "SELECT id FROM investing.portfolio_import_snapshots ORDER BY id");
      assert.deepEqual(visible.rows.map(r=>r.id),[first.snapshotId]);
      await assert.rejects(raw.query(
        "INSERT INTO investing.portfolio_import_cash "+
        "(snapshot_id,investment_account_id,portfolio_id,currency,reported_amount_minor) "+
        "VALUES ($1,$2,$3,'CHF',1)",[first.snapshotId,A,PORT_A]),
        /cannot append to finalized/);
      await raw.query("ROLLBACK");
    } finally {
      raw.release();
    }

    // Deferred COMMIT trigger rejects missing finalization and partial data:
    // a durable snapshot may NEVER be created before all expected rows.
    const headerSql=
      "INSERT INTO investing.portfolio_import_snapshots "+
      "(investment_account_id,portfolio_id,actor_user_id,idempotency_key,"+
      "payload_sha256,import_schema_version,declared_portfolio_name,"+
      "declared_base_currency,source_kind,source_reference,source_as_of,"+
      "expected_cash_rows,expected_position_rows,expected_planned_rows,"+
      "reported_cash_coverage,reported_position_coverage) "+
      "VALUES ($1,$2,$3,$4,$5,'R2_IMPORT_DRAFT_V1','Incomplete',"+
      "'EUR','MANUAL_ENTRY',$6,'2026-10-22T18:00:00.000Z',1,0,0,'PARTIAL','NOT_REPORTED')";
    await admin.query("BEGIN");
    await admin.query(headerSql,[
      A,PORT_A,actorA.userId,"unfinished-import-0001","a".repeat(64),"unfinished-source-0001"]);
    await assert.rejects(admin.query("COMMIT"),/unfinalized portfolio import/);
    await admin.query("ROLLBACK");

    await admin.query("BEGIN");
    const incomplete=await admin.query<{id:string}>(
      headerSql+" RETURNING id",
      [A,PORT_A,actorA.userId,"incomplete-import-001","b".repeat(64),"incomplete-source-001"]);
    await admin.query("UPDATE investing.portfolio_import_snapshots SET snapshot_status='finalized' WHERE id=$1",
      [incomplete.rows[0].id]);
    await assert.rejects(admin.query("COMMIT"),/incomplete portfolio import/);
    await admin.query("ROLLBACK");
    const leftovers=await admin.query<{count:string}>(
      "SELECT count(*)::text count FROM investing.portfolio_import_snapshots WHERE source_reference IN ('unfinished-source-0001','incomplete-source-001')");
    assert.equal(leftovers.rows[0].count,"0");

    // Declared absence is preserved as unknown and never silently becomes zero.
    const noCash=await savePortfolioImport(pool,actorA,{
      portfolioId:PORT_A,idempotencyKey:"ci-no-cash-coverage-0001",
      declaration:{...draft(),sourceReference:"ci-no-cash-source-0001",
        cashBalances:[],reportedCoverage:{cash:"NOT_REPORTED",positions:"ASSERTED_COMPLETE"}},
    });
    const savedCoverage=await admin.query<{
      reported_cash_coverage:string;reported_position_coverage:string;expected_cash_rows:number;evidence_status:string;
    }>(
      "SELECT reported_cash_coverage,reported_position_coverage,expected_cash_rows,evidence_status "+
      "FROM investing.portfolio_import_snapshots WHERE id=$1",[noCash.snapshotId]);
    assert.deepEqual(savedCoverage.rows,[{
      reported_cash_coverage:"NOT_REPORTED",reported_position_coverage:"ASSERTED_COMPLETE",
      expected_cash_rows:0,evidence_status:"UNVERIFIED",
    }]);
    const absentRows=await admin.query<{count:string}>(
      "SELECT count(*)::text count FROM investing.portfolio_import_cash WHERE snapshot_id=$1",
      [noCash.snapshotId]);
    assert.equal(absentRows.rows[0].count,"0");
    const noCashRead=await readOwnPortfolioImport(pool,actorA,{
      portfolioId:PORT_A,snapshotId:noCash.snapshotId,
    });
    assert.deepEqual(noCashRead.cashBalances,[]);
    assert.equal(noCashRead.reportedCoverage.cash,"NOT_REPORTED");
    assert.equal(noCashRead.reportedCoverage.positions,"ASSERTED_COMPLETE");
    assert.equal(noCashRead.verifiedCash,"UNAVAILABLE");
    assert.equal(noCashRead.ledgerChanged,false);

    // DB check must reject even privileged/synthetic callers that lie about scope.
    await assert.rejects(admin.query(
      "INSERT INTO investing.portfolio_import_snapshots "+
      "(investment_account_id,portfolio_id,actor_user_id,idempotency_key,payload_sha256,"+
      "import_schema_version,declared_portfolio_name,declared_base_currency,source_kind,"+
      "source_reference,source_as_of,expected_cash_rows,expected_position_rows,"+
      "expected_planned_rows,reported_cash_coverage,reported_position_coverage) "+
      "VALUES ($1,$2,$3,'sql-coverage-violation-1',$4,'R2_IMPORT_DRAFT_V1',"+
      "'Mismatch','EUR','MANUAL_ENTRY','sql-coverage-source-0001',"+
      "'2026-10-22T18:00:00.000Z',1,0,0,'NOT_REPORTED','ASSERTED_COMPLETE')",
      [A,PORT_A,actorA.userId,"c".repeat(64)]), /check constraint/);
    // R2-D full HTTP transport ↔ private role ↔ PostgreSQL readback.
    // This is ISOLATED PG17 with synthetic actors, never remote Supabase.
    const preview={
      VERCEL_ENV:"preview",
      VERCEL_GIT_COMMIT_REF:"candidate/investing-r2d-import-flow-20261024",
      INVESTING_R2C_PREVIEW_MODE:"enabled",
      INVESTING_R2C_SUPABASE_PROJECT_REF:"zkqgpejlkgootkvkebhd",
      NEXT_PUBLIC_SUPABASE_URL:"https://zkqgpejlkgootkvkebhd.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_ci_key_1234567890",
      INVESTING_R2D_IMPORT_ENABLED:"enabled",
      INVESTING_R2D_PROJECT_REF:"zkqgpejlkgootkvkebhd",
      INVESTING_R2D_PG_DSN:"postgresql://investing_import_preview_runtime:ci@db.zkqgpejlkgootkvkebhd.supabase.co:5432/postgres",
      INVESTING_R2D_PG_CA_PEM:"-----BEGIN CERTIFICATE-----\\nCI_DUMMY\\n-----END CERTIFICATE-----",
    };
    const endpoint="https://preview.example/api/investing/portfolio/import";
    const factory=()=>({connect:()=>pool!.connect()});
    const input={
      portfolioId:PORT_A,idempotencyKey:"ci-r2d-http-import-0001",
      declaration:{...draft(),sourceReference:"ci-r2d-http-source-0001",
        cashBalances:[],reportedCoverage:{cash:"NOT_REPORTED",positions:"ASSERTED_COMPLETE"}},
    };
    const create=(who:typeof actorA,command:unknown)=>handlePortfolioImportHttp(
      new Request(endpoint,{method:"POST",headers:{"origin":"https://preview.example",
        "content-type":"application/json"},body:JSON.stringify(command)}),
      preview,async()=>who,factory);
    const newOne=await create(actorA,input);
    assert.equal(newOne.status,201);
    const saved=await newOne.json();
    assert.equal(saved.state,"USER_REPORTED_UNVERIFIED_IMPORT");
    assert.equal(saved.receipt.kind,"UNVERIFIED_IMPORT");
    assert.equal(saved.receipt.ledgerChanged,false);
    assert.equal(saved.financialMovementsCreated,false);
    const snapshotId=saved.receipt.snapshotId as string;
    const httpReplay=await create(actorA,input);
    assert.equal(httpReplay.status,201);
    assert.equal((await httpReplay.json()).receipt.snapshotId,snapshotId);
    const altered=await create(actorA,{...input,declaration:{
      ...input.declaration,reportedCoverage:{cash:"ASSERTED_COMPLETE",positions:"ASSERTED_COMPLETE"},
    }});
    assert.equal(altered.status,409);
    const stolen=await create(actorB,input);
    assert.equal(stolen.status,403);

    const list=(who:typeof actorA,portfolioId:string)=>handlePortfolioImportHttp(
      new Request(endpoint+"?"+new URLSearchParams({portfolioId})),
      preview,async()=>who,factory);
    const history=await list(actorA,PORT_A);
    assert.equal(history.status,200);
    const h=await history.json();
    assert.equal(h.history.portfolioId,PORT_A);
    assert.equal(h.history.valuation,"UNAVAILABLE");
    assert.ok(h.history.records.some((item:{snapshotId:string})=>item.snapshotId===snapshotId));
    assert.equal((await list(actorB,PORT_A)).status,404);
    const detail=await handlePortfolioImportHttp(
      new Request(endpoint+"?"+new URLSearchParams({portfolioId:PORT_A,snapshotId})),
      preview,async()=>actorA,factory);
    assert.equal(detail.status,200);
    const d=await detail.json();
    assert.equal(d.snapshot.snapshotId,snapshotId);
    assert.equal(d.snapshot.portfolioId,PORT_A);
    assert.equal(d.snapshot.reportedCoverage.cash,"NOT_REPORTED");
    assert.equal(d.snapshot.verifiedCash,"UNAVAILABLE");
    assert.equal(d.snapshot.valuation,"UNAVAILABLE");
    assert.deepEqual(d.snapshot.cashBalances,[]);
    assert.equal(d.snapshot.positions[0].quantityAtoms,"1000000000001");
    assert.equal(d.snapshot.positions[0].reportedCostBasis,null);
    assert.equal(d.snapshot.plannedContributions[0].minor,"10000");
    assert.equal(d.snapshot.ledgerChanged,false);
    const stolenDetail=await handlePortfolioImportHttp(
      new Request(endpoint+"?"+new URLSearchParams({portfolioId:PORT_A,snapshotId})),
      preview,async()=>actorB,factory);
    assert.equal(stolenDetail.status,404);
    // R2-E: compare two real PG17 persisted declarations without making
    // trades, deposits, broker positions, payouts, or P&L.
    const secondImport=await create(actorA,{
      portfolioId:PORT_A,idempotencyKey:"ci-r2e-http-import-0002",
      declaration:{
        ...draft(),sourceReference:"ci-r2e-http-source-0002",
        asOf:"2026-10-23T18:00:00.000Z",
        cashBalances:[],
        positions:[{...draft().positions[0],quantity:"3.000000000000"}],
        reportedCoverage:{cash:"NOT_REPORTED",positions:"ASSERTED_COMPLETE"},
      },
    });
    assert.equal(secondImport.status,201);
    const laterId=(await secondImport.json()).receipt.snapshotId as string;
    const comparisonGet=(who:typeof actorA,afterId:string,beforeId:string)=>{
      const search=new URLSearchParams({
        portfolioId:PORT_A,snapshotId:afterId,baselineSnapshotId:beforeId,
      });
      return handlePortfolioImportHttp(new Request(endpoint+"?"+search),
        preview,async()=>who,factory);
    };
    const comparisonResponse=await comparisonGet(actorA,laterId,snapshotId);
    assert.equal(comparisonResponse.status,200);
    const compared=await comparisonResponse.json();
    assert.equal(compared.state,"UNVERIFIED_DECLARATION_COMPARISON");
    assert.equal(compared.comparison.kind,"UNVERIFIED_DECLARATION_COMPARISON_V1");
    assert.equal(compared.comparison.portfolioId,PORT_A);
    assert.equal(compared.comparison.beforeSnapshotId,snapshotId);
    assert.equal(compared.comparison.afterSnapshotId,laterId);
    assert.equal(compared.comparison.positions.length,1);
    assert.equal(compared.comparison.positions[0].change.reportedDifference,"1999999999999");
    assert.equal(compared.comparison.positions[0].change.financialMovement,"UNAVAILABLE");
    assert.equal(compared.comparison.cash.length,0,"cash omitted twice is still not EUR 0");
    assert.equal(compared.comparison.coverage.before.cash,"NOT_REPORTED");
    assert.equal(compared.comparison.buySellReconstruction,"UNAVAILABLE");
    assert.equal(compared.comparison.realizedContributions,"UNAVAILABLE");
    assert.equal(compared.comparison.income,"UNAVAILABLE");
    assert.equal(compared.comparison.performance,"UNAVAILABLE");
    assert.equal(compared.comparison.financialWrites,false);
    assert.equal(compared.financialMovementsCreated,false);

    const reverse=await comparisonGet(actorA,snapshotId,laterId);
    assert.equal(reverse.status,409);
    assert.equal((await reverse.json()).error,"COMPARISON_NOT_POSSIBLE");
    const stolenCompare=await comparisonGet(actorB,laterId,snapshotId);
    assert.equal(stolenCompare.status,404);
    const same=await comparisonGet(actorA,laterId,laterId);
    assert.equal(same.status,400);

    const untouched=await admin.query<{transactions:string;entries:string}>(
      "SELECT (SELECT count(*)::text FROM investing.ledger_transactions) transactions,"+
      "(SELECT count(*)::text FROM investing.ledger_entries) entries");
    assert.deepEqual(untouched.rows[0],{transactions:"0",entries:"0"});

    // Model actual historical Preview imports that had NO completeness fields.
    // The live Preview has two such rows; simulate only with disposable PG17.
    // This deliberate one-time test-schema compatibility change is not an app migration.
    await admin.query(
      "ALTER TABLE investing.portfolio_import_snapshots "+
      "ALTER COLUMN reported_cash_coverage DROP NOT NULL, "+
      "ALTER COLUMN reported_position_coverage DROP NOT NULL");
    await admin.query("BEGIN");
    const legacy=await admin.query<{id:string}>(
      "INSERT INTO investing.portfolio_import_snapshots "+
      "(investment_account_id,portfolio_id,actor_user_id,idempotency_key,payload_sha256,"+
      "import_schema_version,declared_portfolio_name,declared_base_currency,source_kind,"+
      "source_reference,source_as_of,expected_cash_rows,expected_position_rows,expected_planned_rows) "+
      "VALUES ($1,$2,$3,'ci-legacy-snapshot-001',$4,'R2_IMPORT_DRAFT_V1',"+
      "'Historical','EUR','MANUAL_ENTRY','historical-source-001',"+
      "'2026-10-22T18:00:00.000Z',0,1,0) RETURNING id",
      [A,PORT_A,actorA.userId,"d".repeat(64)]);
    const legacyId=legacy.rows[0].id;
    await admin.query(
      "INSERT INTO investing.portfolio_import_positions "+
      "(snapshot_id,investment_account_id,portfolio_id,isin,mic,quote_currency,quantity_atoms) "+
      "VALUES ($1,$2,$3,'US0378331005','XNAS','USD',1000000000000)",
      [legacyId,A,PORT_A]);
    await admin.query(
      "UPDATE investing.portfolio_import_snapshots SET snapshot_status='finalized' WHERE id=$1",
      [legacyId]);
    await admin.query("COMMIT");
    const legacyRead=await readOwnPortfolioImport(pool,actorA,{
      portfolioId:PORT_A,snapshotId:legacyId,
    });
    assert.equal(legacyRead.reportedCoverage.cash,"LEGACY_COVERAGE_UNKNOWN");
    assert.equal(legacyRead.reportedCoverage.positions,"LEGACY_COVERAGE_UNKNOWN");
    assert.equal(legacyRead.verifiedCash,"UNAVAILABLE");
    assert.equal(legacyRead.positions.length,1);
    assert.equal(legacyRead.cashBalances.length,0);
    const legacyHistory=await listOwnPortfolioImports(pool,actorA,PORT_A);
    const legacyItem=legacyHistory.records.find(x=>x.snapshotId===legacyId);
    assert.ok(legacyItem);
    assert.equal(legacyItem.reportedCoverage.cash,"LEGACY_COVERAGE_UNKNOWN");
    assert.equal(legacyItem.reportedCoverage.positions,"LEGACY_COVERAGE_UNKNOWN");
    await assert.rejects(
      readOwnPortfolioImport(pool,actorB,{portfolioId:PORT_A,snapshotId:legacyId}),
      (e:unknown)=>e instanceof PortfolioImportReadBlocked&&e.code==="NOT_AUTHORIZED");

  } finally {
    await pool?.end();
    await admin.end();
  }
});
