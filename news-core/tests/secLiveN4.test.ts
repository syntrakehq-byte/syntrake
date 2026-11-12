import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { fetchSecFilings } from "../secAdapter";

test("N4 live SEC acquisition records a genuine official publication", async () => {
  if (process.env.N4_REAL_SOURCE !== "1") { assert.fail("N4_REAL_SOURCE=1 is required; live-source proof must never silently skip"); }
  const url = "https://data.sec.gov/submissions/CIK0000320193.json";
  const response = await fetch(url, { headers: { "User-Agent": process.env.SEC_USER_AGENT ?? "syntrake-n4-audit/1.0 security@example.invalid", Accept: "application/json" } });
  assert.equal(response.ok, true);
  const body = await response.text();
  const bodyHash = createHash("sha256").update(body, "utf8").digest("hex");
  const parsed = JSON.parse(body) as { cik?: string };
  assert.equal(parsed.cik, "0000320193");
  const result = await fetchSecFilings({ cik: "0000320193", userAgent: process.env.SEC_USER_AGENT ?? "syntrake-n4-audit/1.0 security@example.invalid", now: new Date(), fetchImpl: async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } }) });
  assert.ok(result.publications.length > 0);
  assert.ok(result.publications.every(item => item.originalUrl.startsWith("https://www.sec.gov/Archives/edgar/data/")));
  assert.ok(result.publications.every(item => item.externalId && item.originFingerprint && item.firstSeenAt));
  console.log(`N4_REAL_SEC source=data.sec.gov cik=0000320193 bodySha256=${bodyHash} publications=${result.publications.length}`);
});
