import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import {Client,Pool} from "pg";
import {initializeFirstInvestingPortfolio,InitialPortfolioBlocked}
 from "../server/initializeFirstPortfolio";
import {handlePrivateFirstPortfolioPost} from "../server/firstPortfolioPreviewHttp";

const A={userId:"user_ci_initial_actor_a",sessionId:"ci_clerk_session_a"};
const B={userId:"user_ci_initial_actor_b",sessionId:"ci_clerk_session_b"};
const C={userId:"user_ci_initial_actor_c",sessionId:"ci_clerk_session_c"};
const command=(idempotencyKey:string)=>({
 idempotencyKey,accountName:"Investing Principal",
 portfolioName:"Long-term Investing",baseCurrency:"EUR" as const,
});
const key="00000000-0000-4000-8000-000000000321";

test("R2-C2 real PG17: atomic, owner-scoped initial portfolio under dedicated NOLOGIN role",async t=>{
 const url=process.env.INVESTING_PG17_R2C2_URL;
 assert.ok(url,"isolated PG17 URL mandatory; never Production");
 const admin=new Client({connectionString:url});await admin.connect();
 let pool:Pool|undefined;
 try{
  assert.match((await admin.query<{v:string}>("select current_setting('server_version') v")).rows[0].v,/^17\./);
  await admin.query("create role anon noinherit");
  await admin.query("create role authenticated noinherit");
  await admin.query("create schema auth");
  await admin.query("create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$");
  await admin.query("grant usage on schema auth to authenticated");
  await admin.query("grant execute on function auth.jwt() to authenticated");
  const migrations=[
   "../../supabase/migrations/20261017160000_investing_core_foundation.sql",
   "../../supabase/migrations/20261018070000_investing_owner_membership_guard.sql",
   "../../supabase/release-candidates/20261022200000_r2b_unverified_portfolio_imports.sql",
   "../../supabase/release-candidates/20261022210000_r2c_onboarding_intents.sql",
   "../../supabase/release-candidates/20261023063000_r2c2_first_portfolio.sql",
  ];
  for(const path of migrations)await admin.query(await readFile(new URL(path,import.meta.url),"utf8"));
  const privilege=await admin.query<{anon:boolean;auth:boolean;provision:boolean;can_login:boolean;ledger:boolean;can_change_name:boolean;can_change_owner:boolean}>(
   "select has_table_privilege('anon','investing.investment_accounts','INSERT') anon,"+
   "has_table_privilege('authenticated','investing.investment_accounts','INSERT') auth,"+
   "has_table_privilege('investing_initial_provisioner','investing.investment_accounts','INSERT') provision,"+
   "(select rolcanlogin from pg_roles where rolname='investing_initial_provisioner') can_login,"+
   "has_table_privilege('investing_initial_provisioner','investing.ledger_entries','INSERT') ledger,"+
   "has_column_privilege('investing_initial_provisioner','investing.investment_accounts','name','UPDATE') can_change_name,"+
   "has_column_privilege('investing_initial_provisioner','investing.investment_accounts','owner_user_id','UPDATE') can_change_owner");
  assert.deepEqual(privilege.rows[0],{anon:false,auth:false,provision:true,can_login:false,ledger:false,
    can_change_name:false,can_change_owner:true});
  const privilegedRpc = await admin.query<{absent:boolean}>(
    "SELECT to_regprocedure('investing.provision_first_portfolio(uuid,text,text,text)') IS NULL AS absent");
  assert.equal(privilegedRpc.rows[0].absent,true,
    "R2-C2 MUST NOT expose historical SECURITY DEFINER RPC to authenticated");
  const roleGrant = await admin.query<{role_bypass:boolean;schema_create:boolean}>(
    "SELECT rolbypassrls AS role_bypass,"+
    "has_schema_privilege('investing_initial_provisioner','investing','CREATE') AS schema_create "+
    "FROM pg_roles WHERE rolname='investing_initial_provisioner'");
  assert.deepEqual(roleGrant.rows[0],{role_bypass:false,schema_create:false});
  await admin.query("INSERT INTO investing.onboarding_intents(actor_user_id,idempotency_key,payload_sha256,pathway,import_source) values "+
   "($1,'00000000-0000-4000-8000-000000000311',repeat('a',64),'HAS_PORTFOLIO','MANUAL_ENTRY'),"+
   "($2,'00000000-0000-4000-8000-000000000312',repeat('b',64),'HAS_PORTFOLIO','MANUAL_ENTRY')",
   [A.userId,B.userId]);
  await admin.query("create role ci_r2c2_runtime login noinherit password 'synthetic_ci_only_never_prod'");
  await admin.query("grant investing_initial_provisioner to ci_r2c2_runtime with inherit false, set true");
  const runtime=new URL(url);
  runtime.username="ci_r2c2_runtime";
  runtime.password="synthetic_ci_only_never_prod";
  pool=new Pool({connectionString:runtime.toString(),max:4});
  const isolated=pool;
  await t.test("unauthenticated, forged and no-onboarding rejected without SQL writes",async()=>{
   await assert.rejects(initializeFirstInvestingPortfolio(isolated,{userId:null,sessionId:null},command(key)),
    (e:unknown)=>e instanceof InitialPortfolioBlocked&&e.code==="UNAUTHENTICATED");
   await assert.rejects(initializeFirstInvestingPortfolio(isolated,A,{...command(key),userId:B.userId}),
    (e:unknown)=>e instanceof InitialPortfolioBlocked&&e.code==="INVALID_INPUT");
   await assert.rejects(initializeFirstInvestingPortfolio(isolated,C,command(key)),
    (e:unknown)=>e instanceof InitialPortfolioBlocked&&e.code==="NO_ONBOARDING_INTENT");
  });
  let savedA:Awaited<ReturnType<typeof initializeFirstInvestingPortfolio>>;
  await t.test("A creates one account, membership, portfolio, six empty subledgers",async()=>{
   savedA=await initializeFirstInvestingPortfolio(isolated,A,command(key));
   assert.equal(savedA.state,"STRUCTURE_CREATED_UNFUNDED");
   assert.equal(savedA.financialTruth,"UNAVAILABLE");
   assert.equal(savedA.ledgerMovementsCreated,false);
   assert.equal(savedA.cashBalance,"UNAVAILABLE");
   const counts=await admin.query<{account:string;membership:string;portfolio:string;subledgers:string;txs:string;entries:string}>(
    "select (select count(*)::text from investing.investment_accounts) account,"+
    "(select count(*)::text from investing.account_memberships) membership,"+
    "(select count(*)::text from investing.portfolios) portfolio,"+
    "(select count(*)::text from investing.ledger_accounts) subledgers,"+
    "(select count(*)::text from investing.ledger_transactions) txs,"+
    "(select count(*)::text from investing.ledger_entries) entries");
   assert.deepEqual(counts.rows[0],{account:"1",membership:"1",portfolio:"1",subledgers:"6",txs:"0",entries:"0"});
   assert.equal(savedA.accountId.length,36);
   assert.equal(savedA.portfolioId.length,36);
   const replay=await initializeFirstInvestingPortfolio(isolated,A,command(key));
   assert.deepEqual(savedA,replay);
   await assert.rejects(initializeFirstInvestingPortfolio(isolated,A,command("00000000-0000-4000-8000-000000000322")),
    (e:unknown)=>e instanceof InitialPortfolioBlocked&&e.code==="INITIAL_PORTFOLIO_ALREADY_EXISTS");
  });
  await t.test("private role cannot mutate holdings, account labels or create ledger money",async()=>{
    const db=await isolated.connect();let opened=false;
    try{
      await db.query("BEGIN");opened=true;
      await db.query("SET LOCAL ROLE investing_initial_provisioner");
      await db.query("SELECT set_config('syntrake.actor_user_id',$1,true)",[A.userId]);
      await db.query("SAVEPOINT blocked_label");
      await assert.rejects(db.query(
        "UPDATE investing.investment_accounts SET name='FORGED' WHERE id=$1",
        [savedA!.accountId]),/permission denied/);
      await db.query("ROLLBACK TO SAVEPOINT blocked_label");
      await db.query("SAVEPOINT blocked_ledger");
      await assert.rejects(db.query(
        "INSERT INTO investing.ledger_transactions "+
        "(investment_account_id,idempotency_user_id,idempotency_key,provenance) "+
        "VALUES ($1,$2,'fake-financial-posting-001','{}')",
        [savedA!.accountId,A.userId]),/permission denied/);
      await db.query("ROLLBACK TO SAVEPOINT blocked_ledger");
      await db.query("ROLLBACK");opened=false;
    }finally{if(opened)await db.query("ROLLBACK").catch(()=>undefined);db.release();}
    const label=await admin.query<{name:string}>(
      "SELECT name FROM investing.investment_accounts WHERE id=$1",
      [savedA!.accountId]);
    assert.equal(label.rows[0].name,"Investing Principal");
  });

  await t.test("B: 4 concurrent identical initial requests produce one account only",async()=>{
   const requests=Array.from({length:4},()=>initializeFirstInvestingPortfolio(isolated,B,command("00000000-0000-4000-8000-000000000323")));
   const results=await Promise.all(requests);
   for(const result of results)assert.deepEqual(result,results[0]);
   assert.notEqual(results[0].accountId,savedA!.accountId);
   const counts=await admin.query<{accounts:string;portfolios:string;ledgers:string;transactions:string}>(
    "select (select count(*)::text from investing.investment_accounts) accounts,"+
    "(select count(*)::text from investing.portfolios) portfolios,"+
    "(select count(*)::text from investing.ledger_accounts) ledgers,"+
    "(select count(*)::text from investing.ledger_transactions) transactions");
   assert.deepEqual(counts.rows[0],{accounts:"2",portfolios:"2",ledgers:"12",transactions:"0"});
  });
  await t.test("legacy owned account blocks duplicate first-account provisioning",async()=>{
    const legacy="user_ci_initial_actor_legacy";
    await admin.query("BEGIN");
    try {
      await admin.query("INSERT INTO investing.identity_accounts(user_id) VALUES ($1)",[legacy]);
      const old=await admin.query<{id:string}>(
        "INSERT INTO investing.investment_accounts(owner_user_id,name,base_currency) "+
        "VALUES ($1,'Existing Account','EUR') RETURNING id",[legacy]);
      await admin.query(
        "INSERT INTO investing.account_memberships(investment_account_id,user_id,role) "+
        "VALUES ($1,$2,'owner')",[old.rows[0].id,legacy]);
      await admin.query("COMMIT");
    }catch(e){await admin.query("ROLLBACK");throw e;}
    await admin.query(
      "INSERT INTO investing.onboarding_intents(actor_user_id,idempotency_key,payload_sha256,pathway,import_source) "+
      "VALUES ($1,'00000000-0000-4000-8000-000000000413',repeat('a',64),'HAS_PORTFOLIO','MANUAL_ENTRY')",
      [legacy]);
    await assert.rejects(initializeFirstInvestingPortfolio(isolated,
      {userId:legacy,sessionId:"legacy_session"},command("00000000-0000-4000-8000-000000000414")),
      (e:unknown)=>e instanceof InitialPortfolioBlocked&&e.code==="INITIAL_PORTFOLIO_ALREADY_EXISTS");
    const count=await admin.query<{v:string}>(
      "SELECT count(*)::text AS v FROM investing.investment_accounts WHERE owner_user_id=$1",[legacy]);
    assert.equal(count.rows[0].v,"1");
  });

  await t.test("R2-C4 private HTTP→Clerk actor→PG17 replay preserves account IDs, no ledger writes",async()=>{
    const environment={
      VERCEL_ENV:"preview",
      VERCEL_GIT_COMMIT_REF:"candidate/investing-r2-preview-security-compat-20261024",
      INVESTING_R2C_PREVIEW_MODE:"enabled",
      INVESTING_R2C_SUPABASE_PROJECT_REF:"zkqgpejlkgootkvkebhd",
      NEXT_PUBLIC_SUPABASE_URL:"https://zkqgpejlkgootkvkebhd.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_ci_key_1234567890",
      INVESTING_R2C4_PRIVATE_WRITE:"enabled",
      INVESTING_R2C4_PROJECT_REF:"zkqgpejlkgootkvkebhd",
      INVESTING_R2C4_PG_DSN:"postgresql://investing_initial_preview_runtime:ci@db.zkqgpejlkgootkvkebhd.supabase.co:5432/postgres",
      INVESTING_R2C4_PG_CA_PEM:"-----BEGIN CERTIFICATE-----\\nCI_DUMMY\\n-----END CERTIFICATE-----",
    };
    const endpoint="https://preview.example/api/investing/portfolio/initialize";
    const send=async(actor:{userId:string|null;sessionId:string|null},
      input:unknown)=>{
      const request=new Request(endpoint,{
        method:"POST",headers:{"origin":"https://preview.example",
          "content-type":"application/json"},body:JSON.stringify(input),
      });
      return handlePrivateFirstPortfolioPost(request,environment,async()=>actor,
        ()=>({connect:()=>isolated.connect()}));
    };
    const replay=await send(A,command(key));
    assert.equal(replay.status,201);
    const payload=await replay.json();
    assert.deepEqual(payload,{
      state:"STRUCTURE_CREATED_UNFUNDED",
      receipt:savedA,financialMovementsCreated:false,
    });
    const conflict=await send(B,command(key));
    assert.equal(conflict.status,409);
    assert.equal((await conflict.json()).error,"ALREADY_EXISTS_OR_CONFLICT");
    const noIntent=await send(C,command(key));
    assert.equal(noIntent.status,409);
    assert.equal((await noIntent.json()).error,"NO_ONBOARDING_INTENT");
    const noAuth=await send({userId:null,sessionId:null},command(key));
    assert.equal(noAuth.status,401);
    const financial=await admin.query<{tx:string;entries:string}>(
      "SELECT (SELECT count(*)::text FROM investing.ledger_transactions) tx,"+
      "(SELECT count(*)::text FROM investing.ledger_entries) entries",
    );
    assert.deepEqual(financial.rows[0],{tx:"0",entries:"0"});
  });

  await t.test("A/B RLS server actor may only read own receipts and identities",async()=>{
   const read=async(actor:string)=>{
    const db=await isolated.connect();let opened=false;
    try{
     await db.query("BEGIN");opened=true;
     await db.query("SET LOCAL ROLE investing_initial_provisioner");
     await db.query("SELECT set_config('syntrake.actor_user_id',$1,true)",[actor]);
     const x=await db.query<{user_id:string}>("SELECT user_id FROM investing.initial_portfolio_receipts");
     const portfolios=await db.query<{id:string}>("SELECT id FROM investing.portfolios");
     await db.query("COMMIT");opened=false;
     return {rows:x.rows,portfolioCount:portfolios.rows.length};
    }finally{if(opened)await db.query("ROLLBACK").catch(()=>undefined);db.release();}
   };
   const [a,b]=await Promise.all([read(A.userId),read(B.userId)]);
   assert.deepEqual(a.rows,[{user_id:A.userId}]);
   assert.deepEqual(b.rows,[{user_id:B.userId}]);
   assert.equal(a.portfolioCount,1);
   assert.equal(b.portfolioCount,1);
  });
 }finally{await pool?.end();await admin.end();}
});
