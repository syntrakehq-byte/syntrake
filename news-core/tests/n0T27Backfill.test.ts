import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, Pool } from "pg";
import { fetchSafeExternal } from "../sourceSecurity";
import { fetchSecFilings } from "../secAdapter";
import { PostgresNewsStore } from "../postgresStore";
import { runNewsExecutorOnce } from "../autonomousExecutor";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const CIK = "0000320193";
const USER_AGENT = process.env.SEC_USER_AGENT ?? "SYNTRAKE N0 T27 CI/1.0 security@syntrake.com";
const n1 = new URL("../../supabase/migrations/20261111150000_news_core_postgres_n1.sql", import.meta.url);
const n2a = new URL("../../supabase/migrations/20261111170000_news_core_n2a_revisions.sql", import.meta.url);

type SecPayload = { cik: string; filings: { recent: Record<string, unknown> } };

async function waitUntilDue(admin: Client, scope: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await admin.query<{ due: boolean }>(
      "select next_run_at <= clock_timestamp() and (lease_until is null or lease_until < clock_timestamp()) as due from news_core.collection_targets where collection_scope_key=$1",
      [scope],
    );
    if (result.rows[0]?.due) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`N0_T27_TARGET_DID_NOT_BECOME_DUE scope=${scope}`);
}

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

function oldestFilingReplay(payload: SecPayload): SecPayload {
  const recent = payload.filings.recent;
  const accessionNumbers = recent.accessionNumber;
  if (!Array.isArray(accessionNumbers) || accessionNumbers.length < 2) throw new Error("N0_T27_NEEDS_MULTIPLE_OFFICIAL_FILINGS");
  const index = accessionNumbers.length - 1;
  const required = ["form", "accessionNumber", "filingDate", "primaryDocument", "primaryDocDescription"];
  const filtered = Object.fromEntries(required.map(key => {
    const values = recent[key];
    if (!Array.isArray(values) || values.length !== accessionNumbers.length) throw new Error(`N0_T27_INVALID_OFFICIAL_ARRAY:${key}`);
    return [key, [values[index]]];
  }));
  return { cik: payload.cik, filings: { recent: filtered } };
}

test("N0-T27: official SEC gap recovers through natural backoff and backfills without checkpoint reset", { skip: !DB_URL && "NEWS_DATABASE_URL or TEST_DATABASE_URL required: real PG17 only" }, async () => {
  assert.ok(DB_URL);
  const isolatedName = `news_t27_${randomUUID().replaceAll("-", "")}`;
  const provisioner = new Client({ connectionString: DB_URL });
  await provisioner.connect();
  await provisioner.query(`create database "${isolatedName}"`);
  const url = new URL(DB_URL); url.pathname = `/${isolatedName}`;
  const admin = new Client({ connectionString: url.toString() });
  const store = new PostgresNewsStore(new Pool({ connectionString: url.toString(), max: 4 }));
  const scope = `n0-t27-${randomUUID()}`;
  try {
    await admin.connect();
    assert.match((await admin.query<{ v: string }>("select current_setting('server_version') v")).rows[0].v, /^17\./);
    await admin.query(await readFile(n1, "utf8"));
    await admin.query(await readFile(n2a, "utf8"));
    const live = await fetchSafeExternal(`https://data.sec.gov/submissions/CIK${CIK}.json`, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    assert.equal(live.ok, true, `SEC source must be available: ${live.status}`);
    const payload = await live.json() as SecPayload;
    assert.equal(payload.cik, CIK);
    const payloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const partialPayload = oldestFilingReplay(payload);
    let cycle = 0;
    const fetchImpl: typeof fetch = async () => {
      cycle += 1;
      if (cycle === 1) return response(partialPayload);
      if (cycle === 2) throw new Error("SOURCE_TEMPORARILY_UNAVAILABLE_T27");
      return response(payload);
    };
    await store.ensureSource("sec-edgar", "sec");
    await store.upsertTarget({ collectionScopeKey: scope, sourceId: "sec-edgar", providerKey: "sec", entityKey: CIK, parameters: { forms: ["10-K", "10-Q", "8-K", "20-F", "6-K"], overlapDays: 7 }, nextRunAt: new Date().toISOString() });

    const first = await runNewsExecutorOnce({ store, workerId: `n0-t27-first-${process.pid}`, collectionScopeKey: scope, secUserAgent: USER_AGENT, fetchImpl });
    assert.equal(first.claimed, true);
    const firstCount = Number((await admin.query("select count(*)::int n from news_core.publications where source_id='sec-edgar'")).rows[0].n);
    assert.equal(firstCount, 1, "the first official snapshot must ingest only the pre-gap filing");
    const firstExternalId = (await admin.query<{ external_id: string }>("select external_id from news_core.publications where source_id='sec-edgar'")).rows[0].external_id;
    const beforeOutage = await store.getCheckpoint(scope);
    assert.ok(beforeOutage?.cursor);

    await waitUntilDue(admin, scope, 70_000);
    await assert.rejects(
      runNewsExecutorOnce({ store, workerId: `n0-t27-outage-${process.pid}`, collectionScopeKey: scope, secUserAgent: USER_AGENT, fetchImpl }),
      /SOURCE_TEMPORARILY_UNAVAILABLE_T27/,
    );
    assert.deepEqual(await store.getCheckpoint(scope), beforeOutage, "source outage must not move the checkpoint");

    await waitUntilDue(admin, scope, 15_000);
    const recovered = await runNewsExecutorOnce({ store, workerId: `n0-t27-recovery-${process.pid}`, collectionScopeKey: scope, secUserAgent: USER_AGENT, fetchImpl });
    assert.equal(recovered.claimed, true);
    const expected = await fetchSecFilings({ cik: CIK, userAgent: USER_AGENT, cursor: beforeOutage.cursor, fetchImpl: async () => response(payload), now: new Date("2026-11-15T07:00:00.000Z") });
    assert.ok(expected.publications.length > 0, "official full snapshot must contain the post-gap backfill");
    const rows = await admin.query<{ n: number; distinct_n: number }>("select count(*)::int n, count(distinct external_id)::int distinct_n from news_core.publications where source_id='sec-edgar'");
    assert.equal(rows.rows[0].n, rows.rows[0].distinct_n, "backfill must remain idempotent by accession");
    assert.equal(rows.rows[0].n, new Set([firstExternalId, ...expected.publications.map(item => item.externalId)]).size, "all official accessions after the gap must be present");
    assert.ok((await store.getCheckpoint(scope))?.cursor);
    console.log(`N0_T27_PROOF cik=${CIK} officialPayloadSha256=${payloadHash} firstCount=${firstCount} outageCheckpointStable=true recoveredCount=${rows.rows[0].n} expectedBackfill=${expected.publications.length} naturalBackoff=true administrativeScheduleReset=false`);
  } finally {
    await store.close();
    await admin.end();
    await provisioner.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()", [isolatedName]).catch(() => undefined);
    await provisioner.query(`drop database if exists "${isolatedName}"`);
    await provisioner.end();
  }
});
