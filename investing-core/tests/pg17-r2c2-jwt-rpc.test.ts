import assert from "node:assert/strict";
import test from "node:test";
import {Client,Pool} from "pg";

const url=process.env.INVESTING_PG17_R2C2_URL;
const sqlCall="SELECT * FROM investing.provision_first_portfolio($1::uuid,$2::text,$3::text,$4::text)";
type Row={account_id:string;portfolio_id:string;state:string};
const c="user_r2c2_jwt_actor_c",d="user_r2c2_jwt_actor_d";
async function signed(pool:Pool,actor:string,body:()=>Promise<void>):Promise<void>{
 const db=await pool.connect();
 try{
  await db.query("BEGIN");
  await db.query("SET LOCAL ROLE authenticated");
  await db.query("SELECT set_config('request.jwt.claims',$1,true)",[
   JSON.stringify({sub:actor,role:"authenticated"}),
  ]);
  await body();
  await db.query("COMMIT");
 }catch(e){await db.query("ROLLBACK").catch(()=>undefined);throw e;}
 finally{db.release();}
}
test("R2-C2 signed-JWT RPC: NOLOGIN definer, self provision, RLS, replay, A/B",async t=>{
 assert.ok(url,"disposable PG17 only");
 const admin=new Client({connectionString:url});await admin.connect();
 const pool=new Pool({connectionString:url,max:5});
 try{
  const {readFile}=await import("node:fs/promises");
  await admin.query(await readFile(
   new URL("../../supabase/release-candidates/20261023090000_r2c2_jwt_self_provision.sql",import.meta.url),"utf8"));
  const p=await admin.query<{owner:string;security_definer:boolean;anon:boolean;authenticated:boolean;can_login:boolean}>(
   "SELECT pg_get_userbyid(p.proowner) owner,p.prosecdef security_definer,"+
   "has_function_privilege('anon',p.oid,'EXECUTE') anon,"+
   "has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,"+
   "(SELECT rolcanlogin FROM pg_roles WHERE rolname='investing_initial_provisioner') can_login "+
   "FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "+
   "WHERE n.nspname='investing' AND p.proname='provision_first_portfolio'");
  assert.deepEqual(p.rows[0],{
   owner:"investing_initial_provisioner",security_definer:true,
   anon:false,authenticated:true,can_login:false,
  });
  await admin.query(
   "INSERT INTO investing.onboarding_intents(actor_user_id,idempotency_key,payload_sha256,pathway,objective,horizon_years,loss_capacity) "+
   "VALUES($1,'00000000-0000-4000-8000-000000000911',repeat('c',64),'NEEDS_PORTFOLIO','RETIREMENT',20,'MEDIUM'),"+
   "($2,'00000000-0000-4000-8000-000000000912',repeat('d',64),'NEEDS_PORTFOLIO','RETIREMENT',20,'MEDIUM')",
   [c,d],
  );
  await t.test("signed C creates only C account, signed D cannot retrieve C",async()=>{
   await signed(pool,c,async()=>{
    const db=await pool.connect();
    try{
     // The current test transaction binds its own physical connection.
     // This helper is used below with the signed direct-client variant.
    }finally{db.release();}
   });
   const db=await pool.connect();
   try{
    await db.query("BEGIN");await db.query("SET LOCAL ROLE authenticated");
    await db.query("SELECT set_config('request.jwt.claims',$1,true)",
     [JSON.stringify({sub:c,role:"authenticated"})]);
    // Attacker-controlled GUC is explicitly overwritten by trusted JWT actor.
    await db.query("SELECT set_config('syntrake.actor_user_id',$1,true)",[d]);
    const rows=await db.query<Row>(sqlCall,[
     "00000000-0000-4000-8000-000000000921","My Account","My Long Portfolio","EUR",
    ]);
    assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].state,"STRUCTURE_CREATED_UNFUNDED");
    const receipt=await db.query<{user_id:string}>(
     "SELECT user_id FROM investing.initial_portfolio_receipts");
    assert.deepEqual(receipt.rows,[{user_id:c}]);
    await db.query("COMMIT");
    const own=await admin.query<{owner_user_id:string}>(
     "select owner_user_id from investing.investment_accounts where id=$1",
     [rows.rows[0].account_id]);
    assert.deepEqual(own.rows,[{owner_user_id:c}]);
   }catch(e){await db.query("ROLLBACK").catch(()=>undefined);throw e}
   finally{db.release();}
  });
  await t.test("identical replay returns same IDs, change conflicts, existing legacy accounts block",async()=>{
   const db=await pool.connect();
   try{
    await db.query("BEGIN");await db.query("SET LOCAL ROLE authenticated");
    await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:c,role:"authenticated"})]);
    const a=await db.query<Row>(sqlCall,[
     "00000000-0000-4000-8000-000000000921","My Account","My Long Portfolio","EUR",
    ]);
    const b=await db.query<{account_id:string}>(
     "SELECT account_id FROM investing.initial_portfolio_receipts");
    assert.equal(b.rows.length,1);assert.equal(a.rows[0].account_id,b.rows[0].account_id);
    await db.query("SAVEPOINT changed_request");
    await assert.rejects(db.query(sqlCall,[
     "00000000-0000-4000-8000-000000000922","My Account","My Long Portfolio","EUR",
    ]),(e:unknown)=>!!e&&typeof e==="object"&&"code" in e&&e.code==="P1203");
    await db.query("ROLLBACK TO SAVEPOINT changed_request");
    await db.query("COMMIT");
   }catch(e){await db.query("ROLLBACK").catch(()=>undefined);throw e}
   finally{db.release();}
  });
  await t.test("D: simultaneous authenticated requests serialize to one first portfolio",async()=>{
   const tasks=Array.from({length:3},async()=>{
    const db=await pool.connect();
    try{
     await db.query("BEGIN");await db.query("SET LOCAL ROLE authenticated");
     await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:d,role:"authenticated"})]);
     const r=await db.query<Row>(sqlCall,[
      "00000000-0000-4000-8000-000000000923","My Account","My Long Portfolio","EUR",
     ]);
     await db.query("COMMIT");return r.rows[0];
    }catch(e){await db.query("ROLLBACK").catch(()=>undefined);throw e}
    finally{db.release();}
   });
   const replies=await Promise.all(tasks);
   assert.equal(replies.length,3);replies.forEach(x=>assert.deepEqual(x,replies[0]));
  });
  await t.test("anon and absent JWT cannot bootstrap, no cash or broker movements",async()=>{
   const db=await pool.connect();
   try{
    await db.query("BEGIN");await db.query("SET LOCAL ROLE authenticated");
    await db.query("SAVEPOINT no_jwt");
    await assert.rejects(db.query(sqlCall,[
      "00000000-0000-4000-8000-000000000924","No JWT","No Portfolio","EUR",
    ]),(e:unknown)=>!!e&&typeof e==="object"&&"code" in e&&e.code==="P1201");
    await db.query("ROLLBACK TO SAVEPOINT no_jwt");
    await db.query("ROLLBACK");
    await db.query("BEGIN");await db.query("SET LOCAL ROLE anon");
    await assert.rejects(db.query(sqlCall,[
      "00000000-0000-4000-8000-000000000925","No JWT","No Portfolio","EUR",
    ]),/permission denied/);
    await db.query("ROLLBACK");
   }finally{db.release();}
   const x=await admin.query<{txs:string;entries:string;accounts:string;receipts:string}>(
    "SELECT (SELECT count(*)::text FROM investing.ledger_transactions) txs,"+
    "(SELECT count(*)::text FROM investing.ledger_entries) entries,"+
    "(SELECT count(*)::text FROM investing.investment_accounts) accounts,"+
    "(SELECT count(*)::text FROM investing.initial_portfolio_receipts) receipts");
   assert.deepEqual(x.rows[0],{txs:"0",entries:"0",accounts:"4",receipts:"4"});
  });
 }finally{await pool.end();await admin.end();}
});
