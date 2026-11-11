import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileNewsStore } from "../fileStore";
import { fetchSecFilings } from "../secAdapter";
import { runSecPoll } from "../worker";

const payload = { filings: { recent: {
  form: ["10-Q", "8-K", "10-Q"], accessionNumber: ["0000320193-26-000001", "0000320193-26-000002", "0000320193-25-000999"], filingDate: ["2026-11-10", "2026-11-09", "2025-01-01"], primaryDocument: ["q.htm", "k.htm", "old.htm"], primaryDocDescription: ["Quarterly Report", "Current Report", "Old Report"],
} } };
function response(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }

test("validates SEC payload and maps official financial filings", async () => {
  const result = await fetchSecFilings({ cik: "0000320193", userAgent: "SYNTRAKE test test@example.com", now: new Date("2026-11-11T00:00:00.000Z"), fetchImpl: async () => response(payload) });
  assert.equal(result.publications.length, 3);
  assert.match(result.publications[0].originalUrl, /sec\.gov\/Archives/);
  assert.equal(result.observations[0].providerKey, "sec");
});

test("rejects malformed external response and surfaces source outage", async () => {
  await assert.rejects(() => fetchSecFilings({ cik: "0000320193", userAgent: "test", fetchImpl: async () => response({ filings: {} }) }), /INVALID_SEC_RESPONSE/);
  await assert.rejects(() => fetchSecFilings({ cik: "0000320193", userAgent: "test", fetchImpl: async () => response({}, 503) }), /SEC_UNAVAILABLE:503/);
});

test("repetition is idempotent and checkpoint advances only after commit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntrake-news-"));
  const path = join(directory, "store.json");
  const store = new FileNewsStore(path);
  const fetchImpl = async () => response(payload);
  const first = await runSecPoll({ store, cik: "0000320193", userAgent: "test", now: new Date("2026-11-11T00:00:00.000Z"), fetchImpl });
  const second = await runSecPoll({ store, cik: "0000320193", userAgent: "test", now: new Date("2026-11-11T00:01:00.000Z"), fetchImpl });
  const saved = JSON.parse(await readFile(path, "utf8"));
  assert.equal(first.ingested, 3); assert.equal(second.ingested, 0); assert.equal(saved.publications.length, 3); assert.equal(saved.observations.length, 3);
  await rm(directory, { recursive: true, force: true });
});

test("pre-commit interruption leaves prior durable state and checkpoint", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntrake-news-crash-"));
  const path = join(directory, "store.json");
  const store = new FileNewsStore(path);
  await assert.rejects(() => runSecPoll({ store: new FileNewsStore(path, true), cik: "0000320193", userAgent: "test", fetchImpl: async () => response(payload) }), /INJECTED_PRE_COMMIT_FAILURE/);
  assert.equal(await store.checkpoint("sec-edgar"), null);
  await rm(directory, { recursive: true, force: true });
});
