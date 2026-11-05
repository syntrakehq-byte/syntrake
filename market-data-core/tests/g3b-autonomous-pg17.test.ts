import test from "node:test";
import assert from "node:assert/strict";
import { planDemand } from "../coordinator";

/**
 * G3-B gate: the PostgreSQL suites imported by the workflow below are the
 * authoritative operational demonstrations. This file only covers the
 * consumer-independent demand boundary; it does not create another runner.
 */
test("G3-B demand remains executable without a browser session", () => {
  const demand = planDemand({
    listingId: "80000000-0000-0000-0000-000000000005",
    providerId: "80000000-0000-0000-0000-000000000001",
    rightsPolicyId: "80000000-0000-0000-0000-000000000002",
    interval: "1day", adjustment: "none", from: "2026-01-05", to: "2026-01-05",
    freshness: "AVAILABLE", costClass: "KNOWN",
  });
  assert.equal(demand.state, "READY");
  assert.ok(demand.demandKey.length === 64);
});
