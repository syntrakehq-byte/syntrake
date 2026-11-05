import assert from "node:assert/strict";
import test from "node:test";
import type { Actor } from "../../investing-core/contracts";
import { handleInvestingMarketDataRead, type InvestingMarketDataHttpRequest } from "../investingMarketDataHttp";
import type { InvestingMarketDataResponse } from "../investingOperationalService";

const route = "https://www.syntrake.com/api/investing/market-data";
const listingId = "00000000-0000-4000-8000-000000000011";
const actor: Actor = { userId: "user_1", sessionId: "sess_1" };
const env = { VERCEL_ENV: "preview", MARKET_DATA_G3C_MODE: "enabled", MARKET_DATA_G3C_APPROVED_SHA: "a".repeat(40), VERCEL_GIT_COMMIT_SHA: "a".repeat(40) };
const request: InvestingMarketDataHttpRequest = { listingId, startDate: "2026-01-01", endDate: "2026-01-02", asOf: "2026-02-01T00:00:00Z", interval: "1day", adjustment: "none" };
const available: InvestingMarketDataResponse = { status: "AVAILABLE", discovery: { status: "READY", candidates: [], resolutions: [], routing: null, providerKey: "G3B_PROVIDER", listingRef: listingId, close: "105", marketData: null, identityVerified: true, reason: "test" }, current: null, history: null, refreshed: false, source: "CACHE", reason: "test" };
const url = (extra = "") => `${route}?listingId=${listingId}&startDate=${request.startDate}&endDate=${request.endDate}&asOf=${encodeURIComponent(request.asOf)}&interval=1day&adjustment=none${extra}`;

test("G3-C is disabled by default and does not authenticate or load data", async () => {
  let called = false;
  const response = await handleInvestingMarketDataRead(url(), {}, async () => { called = true; return actor; }, async () => available);
  assert.equal(response.status, 404); assert.equal(called, false); assert.deepEqual(await response.json(), { error: "NOT_FOUND" });
});

test("G3-C maps missing Clerk session to 401", async () => {
  const response = await handleInvestingMarketDataRead(url(), env, async () => { throw new Error("UNAUTHENTICATED"); }, async () => available);
  assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: "UNAUTHENTICATED" });
});

test("G3-C rejects unknown, repeated and invalid query parameters before loading", async () => {
  let called = 0;
  for (const value of [url("&userId=other"), url("&listingId=other"), url("&interval=1hour"), url("&startDate=2026-02-01&startDate=2026-02-02")]) {
    const response = await handleInvestingMarketDataRead(value, env, async () => actor, async () => { called++; return available; });
    assert.equal(response.status, 400, value);
  }
  assert.equal(called, 0);
});

test("G3-C serializes an authorized result without accepting browser identity", async () => {
  let received: Actor | null = null;
  const response = await handleInvestingMarketDataRead(url(), env, async () => actor, async (_request, receivedActor) => { received = receivedActor; return available; });
  assert.equal(response.status, 200); assert.deepEqual(received, actor);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.listingId, listingId); assert.equal(body.status, "AVAILABLE");
  assert.equal(JSON.stringify(body).includes("user_1"), false);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
});

test("G3-C hides all protected data for LICENSE_BLOCKED", async () => {
  const protectedResult = { ...available, status: "LICENSE_BLOCKED" as const, current: null, history: null, discovery: { ...available.discovery, close: "999", marketData: null } };
  const response = await handleInvestingMarketDataRead(url(), env, async () => actor, async () => protectedResult);
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.deepEqual(body, { status: "LICENSE_BLOCKED", listingId });
  assert.equal(JSON.stringify(body).includes("999"), false);
});

test("G3-C maps PostgreSQL failures to unavailable without fabricating prices", async () => {
  const response = await handleInvestingMarketDataRead(url(), env, async () => actor, async () => { throw new Error("PRIVATE DSN"); });
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "READ_UNAVAILABLE" });
});
