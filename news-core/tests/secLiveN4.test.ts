import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { fetchSecFilings } from "../secAdapter";
import { fetchSafeExternal } from "../sourceSecurity";

test("N4 live SEC acquisition records a genuine official publication", async () => {
  if (process.env.N4_REAL_SOURCE !== "1") { assert.fail("N4_REAL_SOURCE=1 is required; live-source proof must never silently skip"); }
  const url = "https://data.sec.gov/submissions/CIK0000320193.json";
  const userAgent = process.env.SEC_USER_AGENT ?? "SYNTRAKE N4 audit/1.0 security@syntrake.com";
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 20_000);
  const response = await fetchSafeExternal(url, { headers: { "User-Agent": userAgent, Accept: "application/json" }, signal: timeout.signal });
  assert.equal(response.ok, true);
  const body = await response.text();
  const bodyHash = createHash("sha256").update(body, "utf8").digest("hex");
  const parsed = JSON.parse(body) as { cik?: string };
  assert.equal(parsed.cik, "0000320193");
  clearTimeout(timer);
  const result = await fetchSecFilings({ cik: "0000320193", userAgent, now: new Date(), signal: AbortSignal.timeout(20_000) });
  assert.ok(result.publications.length > 0);
  assert.ok(result.publications.every(item => item.originalUrl.startsWith("https://www.sec.gov/Archives/edgar/data/")));
  assert.ok(result.publications.every(item => item.externalId && item.originFingerprint && item.firstSeenAt));
  console.log(`N4_REAL_SEC source=data.sec.gov cik=0000320193 bodySha256=${bodyHash} publications=${result.publications.length}`);
});
