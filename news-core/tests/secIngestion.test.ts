import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileNewsStore } from "../fileStore";
import { fetchSecFilings } from "../secAdapter";
import { runSecPoll } from "../worker";

const A = "0000320193", B = "0000789019";
function payload(cik: string, rows = [{ accession: "0000320193-26-000001", date: "2026-11-10", document: "q.htm", form: "10-Q" }]) {
  return { cik, filings: { recent: { form: rows.map(row => row.form), accessionNumber: rows.map(row => row.accession), filingDate: rows.map(row => row.date), primaryDocument: rows.map(row => row.document), primaryDocDescription: rows.map(() => "Quarterly Report") } } };
}
function response(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }

test("validates SEC identity and maps a filing without inventing publication time", async () => {
  const result = await fetchSecFilings({ cik: A, userAgent: "SYNTRAKE test test@example.com", now: new Date("2026-11-11T00:00:00.000Z"), fetchImpl: async () => response(payload(A)) });
  assert.equal(result.publications.length, 1); assert.equal(result.publications[0].publishedAt, null); assert.match(result.publications[0].originalUrl, /sec\.gov\/Archives/); assert.equal(result.observations[0].providerObservationKey, `${A}:0000320193-26-000001`);
});

test("rejects CIK mismatch, arrays, impossible dates, accession and document traversal", async () => {
  await assert.rejects(() => fetchSecFilings({ cik: A, userAgent: "test", fetchImpl: async () => response(payload(B)) }), /:cik/);
  await assert.rejects(() => fetchSecFilings({ cik: A, userAgent: "test", fetchImpl: async () => response({ cik: A, filings: { recent: { form: ["10-Q"], accessionNumber: [], filingDate: ["2026-11-10"], primaryDocument: ["q.htm"], primaryDocDescription: ["Q"] } } }) }), /:arrays/);
  await assert.rejects(() => fetchSecFilings({ cik: A, userAgent: "test", fetchImpl: async () => response(payload(A, [{ accession: "0000320193-26-000001", date: "2026-02-30", document: "q.htm", form: "10-Q" }])) }), /:date/);
  await assert.rejects(() => fetchSecFilings({ cik: A, userAgent: "test", fetchImpl: async () => response(payload(A, [{ accession: "bad", date: "2026-11-10", document: "q.htm", form: "10-Q" }])) }), /:filing/);
  await assert.rejects(() => fetchSecFilings({ cik: A, userAgent: "test", fetchImpl: async () => response(payload(A, [{ accession: "0000320193-26-000001", date: "2026-11-10", document: "../q.htm", form: "10-Q" }])) }), /:filing/);
});

test("partitions checkpoints by CIK and captures out-of-order filings with overlap", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntrake-news-partitions-")), path = join(directory, "store.json"), store = new FileNewsStore(path);
  const late = { accession: "0000320193-26-000000", date: "2026-11-09", document: "late.htm", form: "10-Q" };
  let aPolls = 0;
  const fetchImpl = async (url: string) => url.includes(A) ? response(payload(A, aPolls++ === 0 ? undefined : [late, { accession: "0000320193-26-000001", date: "2026-11-10", document: "q.htm", form: "10-Q" }])) : response(payload(B, [{ accession: "0000789019-26-000001", date: "2026-11-09", document: "k.htm", form: "8-K" }]));
  assert.equal((await runSecPoll({ store, cik: A, userAgent: "test", fetchImpl })).ingested, 1); assert.equal((await runSecPoll({ store, cik: B, userAgent: "test", fetchImpl })).ingested, 1); assert.equal((await runSecPoll({ store, cik: A, userAgent: "test", fetchImpl })).ingested, 1);
  const saved = JSON.parse(await readFile(path, "utf8")); assert.equal(saved.publications.length, 3); assert.equal(saved.checkpoints.length, 2); assert.equal(saved.observations.length, 3);
  await rm(directory, { recursive: true, force: true });
});

test("serializes concurrent writers and preserves both partitions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntrake-news-concurrent-")), path = join(directory, "store.json"), store = new FileNewsStore(path);
  const fetchA = async () => response(payload(A)), fetchB = async () => response(payload(B, [{ accession: "0000789019-26-000001", date: "2026-11-10", document: "k.htm", form: "8-K" }]));
  await Promise.all([runSecPoll({ store, cik: A, userAgent: "test", fetchImpl: fetchA }), runSecPoll({ store, cik: B, userAgent: "test", fetchImpl: fetchB })]);
  const saved = JSON.parse(await readFile(path, "utf8")); assert.equal(saved.publications.length, 2); assert.equal(saved.checkpoints.length, 2);
  await rm(directory, { recursive: true, force: true });
});

test("source outage, replay idempotency and pre-commit failure are fail-closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntrake-news-recovery-")), path = join(directory, "store.json");
  await assert.rejects(() => fetchSecFilings({ cik: A, userAgent: "test", fetchImpl: async () => response({}, 503) }), /SEC_UNAVAILABLE:503/);
  const store = new FileNewsStore(path); const fetchImpl = async () => response(payload(A)); await runSecPoll({ store, cik: A, userAgent: "test", fetchImpl }); await runSecPoll({ store, cik: A, userAgent: "test", fetchImpl });
  const saved = JSON.parse(await readFile(path, "utf8")); assert.equal(saved.publications.length, 1); assert.equal(saved.observations.length, 1);
  await assert.rejects(() => runSecPoll({ store: new FileNewsStore(path, "before-staging"), cik: B, userAgent: "test", fetchImpl: async () => response(payload(B, [{ accession: "0000789019-26-000001", date: "2026-11-10", document: "b.htm", form: "8-K" }])) }), /INJECTED_PRE_COMMIT_FAILURE/); assert.equal((await new FileNewsStore(path).checkpoint(`sec-edgar|sec|cik=${B}|forms=10-K,10-Q,8-K,20-F,6-K|overlap=7|v=2`)), null);
  await rm(directory, { recursive: true, force: true });
});

test("staging is private: read during incomplete persistence exposes no provisional PIT state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntrake-news-pit-")), path = join(directory, "store.json"), failing = new FileNewsStore(path, "after-staging");
  await assert.rejects(() => runSecPoll({ store: failing, cik: A, userAgent: "test", fetchImpl: async () => response(payload(A)) }), /INJECTED_POST_STAGING_FAILURE/);
  const during = await new FileNewsStore(path).read(); assert.equal(during.publications.length, 0); assert.equal(during.observations.length, 0); assert.equal(during.checkpoints.length, 0);
  await rm(directory, { recursive: true, force: true });
});

test("recovery after staging crash commits timestamps and checkpoint exactly once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntrake-news-recovery-pit-")), path = join(directory, "store.json"), failing = new FileNewsStore(path, "after-staging");
  await assert.rejects(() => runSecPoll({ store: failing, cik: A, userAgent: "test", fetchImpl: async () => response(payload(A)) }), /INJECTED_POST_STAGING_FAILURE/);
  const recovered = await runSecPoll({ store: new FileNewsStore(path), cik: A, userAgent: "test", fetchImpl: async () => response(payload(A)) }); assert.equal(recovered.ingested, 0);
  const final = await new FileNewsStore(path).read(); assert.equal(final.checkpoints.length, 1); assert.equal(final.publications.length, 1); assert.equal(final.observations.length, 1); assert.ok(final.publications[0].ingestedAt); assert.ok(final.publications[0].asKnownAt); assert.ok(Date.parse(final.publications[0].asKnownAt!) >= Date.parse(final.publications[0].firstSeenAt));
  const replay = await runSecPoll({ store: new FileNewsStore(path), cik: A, userAgent: "test", fetchImpl: async () => response(payload(A)) }); assert.equal(replay.ingested, 0); const afterReplay = await new FileNewsStore(path).read(); assert.equal(afterReplay.publications.length, 1); assert.equal(afterReplay.checkpoints.length, 1);
  await rm(directory, { recursive: true, force: true });
});
