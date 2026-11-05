import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketDataUrl, canPresentMarketData, LatestMarketRequest } from "./marketDataWorkspaceLogic";

test("G3-D sends the exact UTC cutoff without appending or shifting timezone", () => {
  const url = buildMarketDataUrl("/api/investing/market-data", { listingId: "listing-b", startDate: "2026-01-01", endDate: "2026-01-31", asOf: "2026-01-15T18:45:30Z" });
  assert.equal(new URL(url, "https://syntrake.test").searchParams.get("asOf"), "2026-01-15T18:45:30Z");
  assert.equal(new URL(url, "https://syntrake.test").searchParams.get("interval"), "1day");
  assert.equal(new URL(url, "https://syntrake.test").searchParams.get("adjustment"), "none");
});

test("G3-D presents only AVAILABLE data", () => {
  assert.equal(canPresentMarketData("AVAILABLE"), true);
  for (const status of ["LICENSE_BLOCKED", "PARTIAL", "STALE", "UNAVAILABLE", "AMBIGUOUS", "REFRESH_REQUIRED"]) assert.equal(canPresentMarketData(status), false, status);
});

test("G3-D invalidates an older in-flight response when a new query begins", () => {
  const gate = new LatestMarketRequest();
  const oldRequest = gate.begin();
  const newRequest = gate.begin();
  assert.equal(oldRequest.signal.aborted, true);
  assert.equal(gate.accepts(oldRequest.generation), false);
  assert.equal(gate.accepts(newRequest.generation), true);
  gate.invalidate();
  assert.equal(newRequest.signal.aborted, true);
  assert.equal(gate.accepts(newRequest.generation), false);
});
