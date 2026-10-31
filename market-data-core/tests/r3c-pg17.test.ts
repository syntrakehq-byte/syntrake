import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client, Pool } from "pg";
const c = new Client({ host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER ?? "postgres", password: process.env.PGPASSWORD ?? "postgres", database: process.env.PGDATABASE ?? "postgres", connectionTimeoutMillis: 3000 });
const id = { p:"10000000-0000-0000-0000-000000000001", r:"10000000-0000-0000-0000-000000000002", i:"10000000-0000-0000-0000-000000000003", li:"10000000-0000-0000-0000-000000000004", bp:"10000000-0000-0000-0000-000000000005", j:"10000000-0000-0000-0000-000000000006" };
before(async () => { await c.connect(); assert.match((await c.query("SELECT current_setting('server_version') AS v")).rows[0].v, /^17\./); await c.query(await readFile(resolve(process.cwd(), "supabase/release-candidates/20261031150000_r3b_market_core_candidate.sql"), "utf8")); await c.query(await readFile(resolve(process.cwd(), "supabase/release-candidates/20261031170000_r3c_coordinator_candidate.sql"), "utf8")); await c.query(await readFile(resolve(process.cwd(), "supabase/release-candidates/20261031183000_r3c3_sql_recovery_candidate.sql"), "utf8")); await c.query("INSERT INTO market_core.providers VALUES ($1,'FAKE','ACTIVE')", [id.p]); await c.query("INSERT INTO market_core.license_policies VALUES ($1,'offline',true,true,NULL)", [id.r]); await c.query("INSERT INTO market_core.issuers VALUES ($1,'Offline')", [id.i]); await c.query("INSERT INTO market_core.instruments VALUES ($1,$2,'EQUITY','USD')", [id.li,id.i]); await c.query("INSERT INTO market_core.listings VALUES ($1,$2,'XNAS','USD','OFF',DATE '2020-01-01',NULL)", [id.li,id.li]); await c.query("INSERT INTO market_core.provider_budget_periods VALUES ($1,$2,'2026-01-01Z','2027-01-01Z',1,0,0)", [id.bp,id.p]); });
afterEach(async () => { await c.query("DELETE FROM market_core.ingestion_runs"); await c.query("DELETE FROM market_core.job_leases"); await c.query("DELETE FROM market_core.credit_reservations"); await c.query("DELETE FROM market_core.ingest_jobs"); await c.query("UPDATE market_core.provider_budget_periods SET reserved_credits=0, consumed_credits=0"); });
after(async () => { await c.query("DROP SCHEMA IF EXISTS market_core CASCADE"); await c.query("DROP EXTENSION IF EXISTS btree_gist"); await c.query("DROP ROLE IF EXISTS market_core_reader"); await c.query("DROP ROLE IF EXISTS market_core_ingest"); await c.query("DROP ROLE IF EXISTS market_core_coordinator_owner"); await c.query("DROP ROLE IF EXISTS anon"); await c.query("DROP ROLE IF EXISTS authenticated"); await c.end(); });
test("20 concurrent claims produce one active reservation and lease", async () => { await c.query("INSERT INTO market_core.ingest_jobs VALUES ($1,repeat('a',64),$2,$3,$4,$5,1,'idem-a','PENDING',0,3,'2026-01-01Z',NULL)", [id.j,id.li,id.p,id.r,id.bp]); const pool = new Pool({ host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 5432), user: process.env.PGUSER ?? "postgres", password: process.env.PGPASSWORD ?? "postgres", database: process.env.PGDATABASE ?? "postgres", max: 20 }); try { const results = await Promise.all(Array.from({length:20}, (_,n) => pool.query("SELECT * FROM market_core.claim_ingest_job($1,$2,'2026-01-01Z','5 minutes')", [`worker-${n}`,`20000000-0000-0000-0000-${String(n+1).padStart(12,'0')}`]))); const claims = results.flatMap(x=>x.rows); assert.equal(claims.length,1); } finally { await pool.end(); } assert.equal((await c.query("SELECT count(*)::int AS n FROM market_core.credit_reservations")).rows[0].n,1); assert.equal((await c.query("SELECT reserved_credits FROM market_core.provider_budget_periods WHERE budget_period_id=$1",[id.bp])).rows[0].reserved_credits,"1.000000"); });
test("idempotent job demand, budget exhaustion and rights-separated keys", async () => {
  // afterEach clears the previous test's rows: seed the original demand HERE,
  // otherwise ON CONFLICT inserts a new row and the replay assertion is false.
  await c.query("INSERT INTO market_core.ingest_jobs VALUES ($1,repeat('a',64),$2,$3,$4,$5,1,'idem-a','PENDING',0,3,'2026-01-01Z',NULL)",[id.j,id.li,id.p,id.r,id.bp]);
  const dup=await c.query("INSERT INTO market_core.ingest_jobs VALUES ('10000000-0000-0000-0000-000000000007',repeat('a',64),$1,$2,$3,$4,1,'idem-a','PENDING',0,3,'2026-01-01Z',NULL) ON CONFLICT (demand_key) DO NOTHING",[id.li,id.p,id.r,id.bp]);
  assert.equal(dup.rowCount,0);
  assert.equal((await c.query("SELECT count(*)::int AS n FROM market_core.ingest_jobs WHERE demand_key=repeat('a',64)")).rows[0].n,1);
  await c.query("INSERT INTO market_core.ingest_jobs VALUES ('10000000-0000-0000-0000-000000000008',repeat('b',64),$1,$2,$3,$4,1,'idem-b','PENDING',0,3,'2026-01-01Z',NULL)",[id.li,id.p,id.r,id.bp]);
  assert.equal((await c.query("SELECT state FROM market_core.ingest_jobs WHERE job_id='10000000-0000-0000-0000-000000000008'")).rows[0].state,"PENDING");
});
test("expired leases recover and retry without duplicating reservations", async () => { const job='10000000-0000-0000-0000-000000000009'; await c.query("INSERT INTO market_core.ingest_jobs VALUES ($1,repeat('c',64),$2,$3,$4,$5,1,'idem-c','PENDING',0,3,clock_timestamp(),NULL)",[job,id.li,id.p,id.r,id.bp]); const first=await c.query("SELECT * FROM market_core.claim_ingest_job('recovery-worker','30000000-0000-0000-0000-000000000001',clock_timestamp(),'1 minute')"); assert.equal(first.rows[0].job_id,job); await c.query("SELECT market_core.recover_expired_ingest_leases(clock_timestamp() + interval '2 minutes')"); // Recovery explicitly reschedules at simulated now+2m: claim using the same
  // logical clock after that point instead of the real earlier wall clock.
  const second=await c.query("SELECT * FROM market_core.claim_ingest_job('recovery-worker-2','30000000-0000-0000-0000-000000000012',clock_timestamp() + interval '2 minutes','5 minutes')"); assert.equal(second.rows[0].job_id,job); assert.equal((await c.query("SELECT count(*)::int AS n FROM market_core.credit_reservations WHERE job_id=$1",[job])).rows[0].n,1); assert.equal((await c.query("SELECT count(*)::int AS n FROM market_core.job_leases WHERE job_id=$1",[job])).rows[0].n,1); });
test("ingest role is restricted to append-only coordinator operations", async () => { await c.query("SET ROLE market_core_ingest"); await assert.rejects(c.query("UPDATE market_core.ingest_jobs SET state='COMMITTED'")); await assert.rejects(c.query("DELETE FROM market_core.ingest_jobs")); await c.query("RESET ROLE"); });
test("SET ROLE can execute only the coordinator RPC and recover leases", async () => { await c.query("INSERT INTO market_core.ingest_jobs VALUES ('10000000-0000-0000-0000-000000000010',repeat('d',64),$1,$2,$3,$4,1,'idem-d','PENDING',0,3,'2026-01-01Z',NULL)",[id.li,id.p,id.r,id.bp]); await c.query("SET ROLE market_core_ingest"); await assert.rejects(c.query("SELECT * FROM market_core.claim_ingest_job('role-worker','30000000-0000-0000-0000-000000000002',clock_timestamp(),interval '5 minutes')"));
  await assert.rejects(c.query("SELECT market_core.recover_expired_ingest_leases(clock_timestamp())"));
  const claimed = await c.query("SELECT * FROM market_core.claim_ingest_job_safe('role-worker','30000000-0000-0000-0000-000000000002')");
  assert.equal(claimed.rowCount,1);
  await c.query("RESET ROLE");
  // Expiry is simulated only by the privileged test fixture; restricted workers
  // cannot pass a fake server time or mutate the lease.
  await c.query("UPDATE market_core.job_leases SET leased_at=clock_timestamp()-interval '10 minutes', heartbeat_at=clock_timestamp()-interval '9 minutes', lease_until=clock_timestamp()-interval '1 minute' WHERE job_id=$1",[claimed.rows[0].job_id]);
  await c.query("SET ROLE market_core_ingest");
  const recovered = await c.query("SELECT market_core.recover_expired_ingest_leases_safe() AS n");
  assert.equal(recovered.rows[0].n,1);
  await c.query("RESET ROLE"); });
test("offline ACK is lease-bound, idempotent and consumes the reserved budget once", async () => { const fixtureTimestamp = new Date(); await c.query("INSERT INTO market_core.ingest_jobs VALUES ('10000000-0000-0000-0000-000000000011',repeat('e',64),$1,$2,$3,$4,1,'idem-e','PENDING',0,3,clock_timestamp(),NULL)",[id.li,id.p,id.r,id.bp]); const rev='50000000-0000-0000-0000-000000000001'; await c.query("INSERT INTO market_core.market_observations VALUES ('50000000-0000-0000-0000-000000000002',$1,$2,$3,'1day','2026-01-01','UTC','none',clock_timestamp())",[id.li,id.p,id.r]); await c.query("INSERT INTO market_core.market_observation_revisions VALUES ($1,'50000000-0000-0000-0000-000000000002',$2,NULL,repeat('f',64),1,1,1,1,NULL,$3,$3,$3,NULL,'{}')",[rev,id.li,fixtureTimestamp]); const claim = await c.query("SELECT * FROM market_core.claim_ingest_job('ack-worker','30000000-0000-0000-0000-000000000003',clock_timestamp(),'5 minutes')"); assert.equal(claim.rowCount,1); const started = await c.query("SELECT market_core.start_ingest_fetch($1,$2) AS ok",[claim.rows[0].job_id,"30000000-0000-0000-0000-000000000003"]); assert.equal(started.rows[0].ok,true); const bad = await c.query("SELECT market_core.complete_ingest_job($1,'30000000-0000-0000-0000-000000000099',$2,'provider-run-e',$3,1) AS ok",[claim.rows[0].job_id,'40000000-0000-0000-0000-000000000001',rev]); assert.equal(bad.rows[0].ok,false); assert.equal((await c.query("SELECT count(*)::int AS n FROM market_core.ingestion_runs WHERE job_id=$1",[claim.rows[0].job_id])).rows[0].n,0); const ack = await c.query("SELECT market_core.complete_ingest_job($1,'30000000-0000-0000-0000-000000000003',$2,'provider-run-e',$3,1) AS ok",[claim.rows[0].job_id,'40000000-0000-0000-0000-000000000001',rev]); assert.equal(ack.rows[0].ok,true); const again = await c.query("SELECT market_core.complete_ingest_job($1,'30000000-0000-0000-0000-000000000003',$2,'provider-run-e',$3,1) AS ok",[claim.rows[0].job_id,'40000000-0000-0000-0000-000000000002',rev]); assert.equal(again.rows[0].ok,false); assert.equal((await c.query("SELECT state FROM market_core.ingest_jobs WHERE job_id=$1",[claim.rows[0].job_id])).rows[0].state,"COMMITTED"); });


test("SECURITY DEFINER is a NOLOGIN/NOBYPASSRLS owner, not the PG17 superuser", async () => {
  const r = await c.query("SELECT rolcanlogin,rolbypassrls,rolsuper FROM pg_roles WHERE rolname='market_core_coordinator_owner'");
  assert.equal(r.rows.length,1);
  assert.equal(r.rows[0].rolcanlogin,false);
  assert.equal(r.rows[0].rolbypassrls,false);
  assert.equal(r.rows[0].rolsuper,false);
  const fn = await c.query("SELECT proname,pg_get_userbyid(proowner) AS owner FROM pg_proc JOIN pg_namespace n ON n.oid=pronamespace WHERE n.nspname='market_core' AND proname IN ('claim_ingest_job','claim_ingest_job_safe','recover_expired_ingest_leases','recover_expired_ingest_leases_safe','start_ingest_fetch','complete_ingest_job')");
  assert.equal(fn.rows.length,6);
  assert.ok(fn.rows.every((x: {owner: string}) => x.owner === "market_core_coordinator_owner"));
});

test("pre-fetch terminal expiry releases reserved credits once", async () => {
  const job="10000000-0000-0000-0000-000000000012";
  const token="30000000-0000-0000-0000-000000000013";
  await c.query("INSERT INTO market_core.ingest_jobs VALUES ($1,repeat('f',64),$2,$3,$4,$5,1,'idem-f','PENDING',0,1,clock_timestamp(),NULL)",[job,id.li,id.p,id.r,id.bp]);
  const claim=await c.query("SELECT * FROM market_core.claim_ingest_job_safe('terminal-worker',$1)",[token]);
  assert.equal(claim.rows[0].job_id,job);
  assert.equal((await c.query("SELECT reserved_credits::text AS x FROM market_core.provider_budget_periods")).rows[0].x,"1.000000");
  const recovered=await c.query("SELECT market_core.recover_expired_ingest_leases(clock_timestamp()+interval '6 minutes') AS n");
  assert.equal(recovered.rows[0].n,1);
  const j=await c.query("SELECT state,last_error FROM market_core.ingest_jobs WHERE job_id=$1",[job]);
  assert.equal(j.rows[0].state,"DEAD_LETTER");
  assert.equal(j.rows[0].last_error,"MAX_ATTEMPTS_PRE_FETCH");
  assert.equal((await c.query("SELECT state FROM market_core.credit_reservations WHERE job_id=$1",[job])).rows[0].state,"RELEASED");
  assert.equal((await c.query("SELECT reserved_credits::text AS x FROM market_core.provider_budget_periods")).rows[0].x,"0.000000");
  assert.equal((await c.query("SELECT market_core.recover_expired_ingest_leases(clock_timestamp()+interval '7 minutes') AS n")).rows[0].n,0);
  assert.equal((await c.query("SELECT reserved_credits::text AS x FROM market_core.provider_budget_periods")).rows[0].x,"0.000000");
});

test("conflicting run cannot ACK, debit credits, or commit the job", async () => {
  const job="10000000-0000-0000-0000-000000000014";
  const token="30000000-0000-0000-0000-000000000015";
  const rev="50000000-0000-0000-0000-000000000016";
  await c.query("INSERT INTO market_core.ingest_jobs VALUES ($1,repeat('1',64),$2,$3,$4,$5,1,'idem-conflict','PENDING',0,3,clock_timestamp(),NULL)",[job,id.li,id.p,id.r,id.bp]);
  await c.query("INSERT INTO market_core.market_observations VALUES ('50000000-0000-0000-0000-000000000017',$1,$2,$3,'1day','2026-01-02','UTC','none',clock_timestamp())",[id.li,id.p,id.r]);
  const fixtureTimestamp = new Date(); await c.query("INSERT INTO market_core.market_observation_revisions VALUES ($1,'50000000-0000-0000-0000-000000000017',$2,NULL,repeat('e',64),1,1,1,1,NULL,$3,$3,$3,NULL,'{}')",[rev,id.li,fixtureTimestamp]);
  const claim=await c.query("SELECT * FROM market_core.claim_ingest_job_safe('conflict-worker',$1)",[token]);
  assert.equal(claim.rows[0].job_id,job);
  assert.equal((await c.query("SELECT market_core.start_ingest_fetch($1,$2) AS ok",[job,token])).rows[0].ok,true);
  // Privileged fixture deliberately creates a conflicting key before the ACK.
  await c.query("INSERT INTO market_core.ingestion_runs VALUES ('40000000-0000-0000-0000-000000000018',$1,'idem-conflict','RETRY',NULL,'FIXTURE',clock_timestamp(),'same-provider-run')",[job]);
  const ack=await c.query("SELECT market_core.complete_ingest_job($1,$2,'40000000-0000-0000-0000-000000000019','same-provider-run',$3,1) AS ok",[job,token,rev]);
  assert.equal(ack.rows[0].ok,false);
  assert.equal((await c.query("SELECT state FROM market_core.ingest_jobs WHERE job_id=$1",[job])).rows[0].state,"FETCHING");
  assert.equal((await c.query("SELECT state FROM market_core.credit_reservations WHERE job_id=$1",[job])).rows[0].state,"RESERVED");
  const budget=await c.query("SELECT reserved_credits::text AS reserved,consumed_credits::text AS consumed FROM market_core.provider_budget_periods");
  assert.equal(budget.rows[0].reserved,"1.000000");
  assert.equal(budget.rows[0].consumed,"0.000000");
});


test("lost rights during pre-fetch retry releases reservation and forbids any refetch", async () => {
  const job="10000000-0000-0000-0000-000000000020";
  const token="30000000-0000-0000-0000-000000000021";
  await c.query("INSERT INTO market_core.ingest_jobs VALUES ($1,repeat('2',64),$2,$3,$4,$5,1,'idem-revoked','PENDING',0,3,clock_timestamp(),NULL)",[job,id.li,id.p,id.r,id.bp]);
  assert.equal((await c.query("SELECT count(*) AS n FROM market_core.claim_ingest_job_safe('rights-worker',$1)",[token])).rows[0].n,"1");
  await c.query("UPDATE market_core.job_leases SET leased_at=clock_timestamp()-interval '10 minutes',heartbeat_at=clock_timestamp()-interval '9 minutes',lease_until=clock_timestamp()-interval '1 minute' WHERE job_id=$1",[job]);
  assert.equal((await c.query("SELECT market_core.recover_expired_ingest_leases_safe() AS n")).rows[0].n,1);
  await c.query("UPDATE market_core.license_policies SET cache_allowed=false WHERE rights_policy_id=$1",[id.r]);
  try {
    assert.equal((await c.query("SELECT count(*) AS n FROM market_core.claim_ingest_job_safe('rights-worker-2','30000000-0000-0000-0000-000000000022')")).rows[0].n,"0");
    assert.equal((await c.query("SELECT state FROM market_core.ingest_jobs WHERE job_id=$1",[job])).rows[0].state,"DEAD_LETTER");
    assert.equal((await c.query("SELECT state FROM market_core.credit_reservations WHERE job_id=$1",[job])).rows[0].state,"RELEASED");
    const budget=await c.query("SELECT reserved_credits::text AS x,consumed_credits::text AS y FROM market_core.provider_budget_periods");
    assert.equal(budget.rows[0].x,"0.000000");
    assert.equal(budget.rows[0].y,"0.000000");
  } finally {
    await c.query("UPDATE market_core.license_policies SET cache_allowed=true WHERE rights_policy_id=$1",[id.r]);
  }
});
