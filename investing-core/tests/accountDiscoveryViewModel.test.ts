import assert from "node:assert/strict";
import test from "node:test";
import { classifyAccountDiscoveryResponse } from "../ui/accountDiscoveryViewModel";

const A = { id: "f886c954-0a0f-419c-890a-b77ecb0c36cf", name: "R0-A Clerk A", baseCurrency: "EUR" };
const C = { id: "676ae244-9ead-449c-861d-2f34a81285e3", name: "R0-A Clerk C", baseCurrency: "EUR" };
const data = (accounts: unknown[], state = "AVAILABLE") => ({
  state, accounts, source: "SUPABASE_RLS_READ", financialState: "NOT_INCLUDED",
});

test("R1-B accepts only exact R1-A read-only success contract", () => {
  assert.deepEqual(classifyAccountDiscoveryResponse(200, data([A])), { kind: "AVAILABLE", accounts: [A] });
  assert.deepEqual(classifyAccountDiscoveryResponse(200, data([C])), { kind: "AVAILABLE", accounts: [C] });
  assert.deepEqual(classifyAccountDiscoveryResponse(200, data([], "EMPTY_OR_UNPROVISIONED")), { kind: "EMPTY_OR_UNPROVISIONED" });
});

test("R1-B never turns unknown upstream, missing schema or bad auth into zero capital", () => {
  for (const [code,kind] of [
    [401,"UNAUTHENTICATED"], [403,"BLOCKED"], [404,"NOT_ENABLED"],
    [400,"UNAVAILABLE"], [429,"UNAVAILABLE"], [500,"UNAVAILABLE"], [503,"UNAVAILABLE"],
  ] as const) {
    assert.deepEqual(classifyAccountDiscoveryResponse(code, data([A])), { kind });
  }
  assert.deepEqual(classifyAccountDiscoveryResponse(200, null), { kind: "UNAVAILABLE" });
  assert.deepEqual(classifyAccountDiscoveryResponse(200, []), { kind: "UNAVAILABLE" });
  assert.deepEqual(classifyAccountDiscoveryResponse(200, { error: "READ_UNAVAILABLE" }), { kind: "UNAVAILABLE" });
});

test("R1-B denies inconsistent empty/available states and duplicate account identity", () => {
  const invalid = [
    data([], "AVAILABLE"),
    data([A], "EMPTY_OR_UNPROVISIONED"),
    data([A, A]),
    data([A], "PENDING"),
    data([A], "AVAILABLE_OR_UNKNOWN"),
  ];
  for (const value of invalid) {
    assert.deepEqual(classifyAccountDiscoveryResponse(200, value), { kind: "UNAVAILABLE" });
  }
});

test("R1-B denies substituted, simulated, financial or tenant-leaking fields", () => {
  const invalid = [
    { ...data([A]), source: "DEMO" },
    { ...data([A]), source: "UNVERIFIED" },
    { ...data([A]), financialState: "ESTIMATED" },
    { ...data([A]), actorId: "user-other" },
    { ...data([A]), balance: 0 },
    { ...data([A]), cash: 0 },
    data([{ ...A, balance: 0 }]),
    data([{ ...A, ownerUserId: "user-other" }]),
    data([{ ...A, baseCurrency: "eur" }]),
    data([{ ...A, baseCurrency: "EURO" }]),
    data([{ ...A, id: "not-a-uuid" }]),
    data([{ ...A, name: "" }]),
    data(Array.from({ length: 51 }, (_, i) => ({ ...A, id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` }))),
  ];
  for (const value of invalid) {
    assert.deepEqual(classifyAccountDiscoveryResponse(200, value), { kind: "UNAVAILABLE" });
  }
});

test("R1-B tolerates only sanitized real account names; no financial values inferred", () => {
  const output = classifyAccountDiscoveryResponse(200, data([A]));
  assert.equal(output.kind, "AVAILABLE");
  assert.ok(!("cash" in output));
  assert.ok(!("balance" in output));
  assert.ok(!("performance" in output));
});
