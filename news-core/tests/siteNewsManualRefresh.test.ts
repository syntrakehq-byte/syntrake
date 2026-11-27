import assert from "node:assert/strict";
import test from "node:test";
import { assertManualWriterIdentity, collectThenProcessFacts, manualNewsRefreshAllowed, runManualSourceBatch } from "../siteNewsManualRefresh";
import { NEWS_OFFICIAL_PLUS_DAILY_NEWS_V1 as sources } from "../globalNewsOfficialSources";

test("manual refresh is disabled unless N5, feature flag and explicit operator match", () => {
  const env = { NEWS_SITE_READ_MODE: "N5", NEWS_MANUAL_REFRESH_ENABLED: "1", NEWS_MANUAL_REFRESH_USER_IDS: "user_a, user_b" };
  assert.equal(manualNewsRefreshAllowed("user_a", {}), false);
  assert.equal(manualNewsRefreshAllowed("user_a", env), true);
  assert.equal(manualNewsRefreshAllowed("user_ab", env), false);
  assert.equal(manualNewsRefreshAllowed(null, env), false);
  assert.equal(manualNewsRefreshAllowed("user_b", { ...env, NEWS_SITE_READ_MODE: "RSS" }), false);
});
test("writer cannot be admin, reader or factual role", () => {
  const identity = { role_name: "news_service", login_name: "manual_login", rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, has_other_news_membership: false };
  assert.doesNotThrow(() => assertManualWriterIdentity(identity));
  for (const change of [{ rolsuper: true }, { rolbypassrls: true }, { rolcreatedb: true }, { rolcreaterole: true }, { has_other_news_membership: true }, { role_name: "news_reader" }, { login_name: "news_service" }]) {
    assert.throws(() => assertManualWriterIdentity({ ...identity, ...change }), /NEWS_MANUAL_WRITER_ROLE_REQUIRED/);
  }
});
test("ten registered sources, bounded concurrency, no false successes, isolated errors", async () => {
  assert.equal(sources.length, 10);
  let active = 0, peak = 0;
  const result = await runManualSourceBatch(sources, async source => {
    active++; peak = Math.max(peak, active);
    try {
      await new Promise(resolve => setTimeout(resolve, 5));
      if (source === sources[1]) throw new Error("unavailable");
      if (source === sources[2]) return { claimed: false, ingested: 0 };
      return { claimed: true, ingested: 2 };
    } finally { active--; }
  }, new AbortController().signal);
  assert.equal(result.status, "PARTIAL");
  assert.equal(peak, 3);
  assert.equal(result.sources.length, 10);
  assert.equal(result.sources[1].status, "ERROR");
  assert.equal(result.sources[2].status, "NOT_DUE_OR_BUSY");
  assert.equal(result.sources.reduce((sum, row) => sum + row.inserted, 0), 16);
});
test("expired request does not begin any new collection", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await runManualSourceBatch(sources, async () => { throw new Error("must not run"); }, controller.signal);
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.sources.length, 10);
  assert.ok(result.sources.every(row => row.status === "DEADLINE"));
});

test("factual backlog cannot preempt collection or invalidate a completed receipt", async () => {
  const order: string[] = [];
  const result = await collectThenProcessFacts(async () => { order.push("collection"); return { status: "COMPLETED" }; }, async () => {
    order.push("facts"); throw new Error("retryable factual failure");
  });
  assert.deepEqual(order, ["collection", "facts"]);
  assert.deepEqual(result, { status: "COMPLETED" });
});
