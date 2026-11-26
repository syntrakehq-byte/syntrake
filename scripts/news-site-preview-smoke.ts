import assert from "node:assert/strict";
import { readNewsN5ForSite } from "../news-core/siteNewsN5";
import { NEWS_OFFICIAL_PLUS_DAILY_NEWS_V1 } from "../news-core/globalNewsOfficialSources";
import { readInvestingNewsV1, readTradingNewsV1, readEngineNewsEvidenceV1, readEngineNewsHealthV1 } from "../news-core/engineNewsReader";
import { refreshPersistedSiteNews } from "../news-core/siteNewsManualRefresh";

// Read-only deployment gate on configured Preview builds. The optional
// operator acceptance run is pinned to one commit and is never enabled in
// production. It directly invokes the server collection service, not Clerk.
async function main(): Promise<void> {
  if (process.env.VERCEL_ENV !== "preview" || process.env.NEWS_SITE_READ_MODE !== "N5") return;
  const sourceIds = NEWS_OFFICIAL_PLUS_DAILY_NEWS_V1.map(source => source.sourceId);
  const rows = await readNewsN5ForSite({
    connectionString: process.env.NEWS_READER_DATABASE_URL ?? "",
    tlsCaPem: process.env.NEWS_READER_CA_PEM ?? "",
    sourceIds,
  });
  assert.ok(rows.length, "NEWS_PREVIEW_N5_EMPTY");
  console.log("NEWS_PREVIEW_N5_READ_PASS", { publications: rows.length, sourcesWithResults: new Set(rows.map(row => row.sourceId)).size });

  const pin = process.env.NEWS_PREVIEW_ACCEPTANCE_REFRESH_SHA;
  if (pin && /^[a-f0-9]{40}$/.test(pin) && pin === process.env.VERCEL_GIT_COMMIT_SHA) {
    const ids = (process.env.NEWS_MANUAL_REFRESH_USER_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean);
    assert.equal(ids.length, 1, "NEWS_PREVIEW_OPERATOR_ALLOWLIST_REQUIRED");
    const result = await refreshPersistedSiteNews(ids[0], "PREVIEW_FACTUAL_ACCEPTANCE");
    console.log("NEWS_PREVIEW_FACTUAL_ACCEPTANCE_RESULT", { status: result.status });
    assert.notEqual(result.status, "UNAVAILABLE", "NEWS_PREVIEW_FACTUAL_ACCEPTANCE_UNAVAILABLE");
  }
  const asOf = new Date().toISOString();
  const input = { asOf, publications: { sort: "RECENT" as const, limit: 100, filters: { sourceIds } }, events: { limit: 100 } };
  const investing = await readInvestingNewsV1(input);
  const trading = await readTradingNewsV1(input);
  for (const [consumer, result] of [["INVESTING", investing], ["TRADING", trading]] as const) {
    assert.equal(result.status, "AVAILABLE", "NEWS_PREVIEW_CONSUMER_UNAVAILABLE");
    assert.ok(result.publications.news.data.length, "NEWS_PREVIEW_CONSUMER_PUBLICATIONS_EMPTY");
    assert.ok(result.events.news.data.length, "NEWS_PREVIEW_CONSUMER_FACTS_EMPTY");
    const event = result.events.news.data[0] as Record<string, unknown>;
    assert.equal(typeof event.factEventId, "string", "NEWS_PREVIEW_FACT_ID_MISSING");
    const evidence = await readEngineNewsEvidenceV1(consumer, { asOf, eventId: String(event.factEventId) });
    assert.equal(evidence.status, "AVAILABLE", "NEWS_PREVIEW_EVIDENCE_UNAVAILABLE");
    assert.ok(evidence.data.length, "NEWS_PREVIEW_EVIDENCE_EMPTY");
    const health = await readEngineNewsHealthV1(consumer);
    assert.ok(sourceIds.every(id => health.sources.some(source => source.source_id === id)), "NEWS_PREVIEW_SOURCE_HEALTH_MISSING");
    console.log("NEWS_PREVIEW_CONSUMER_PASS", { consumer, publications: result.publications.news.data.length, facts: result.events.news.data.length, evidence: evidence.data.length, sources: health.sources.length });
  }
  assert.deepEqual(investing.publications.news.data, trading.publications.news.data, "NEWS_PREVIEW_CONSUMER_PUBLICATION_DIVERGENCE");
  assert.deepEqual(investing.events.news.data, trading.events.news.data, "NEWS_PREVIEW_CONSUMER_FACT_DIVERGENCE");
  console.log("NEWS_PREVIEW_CONSUMER_PARITY_PASS");
}
main().catch((error: unknown) => {
  // Log only a controlled error code, not a stack, connection URL or raw payload.
  const message = error instanceof Error ? error.message : "";
  const code = /^NEWS_[A-Z0-9_]+$/.test(message) ? message : "NEWS_PREVIEW_READ_FAILED";
  console.error(code);
  process.exitCode = 1;
});
