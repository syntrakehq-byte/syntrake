import assert from "node:assert/strict";
import test from "node:test";
import { assertBalanced, netByAccount } from "../domain/ledger";
import { addMoney, money, subtractMoney } from "../domain/money";

test("exact minor-unit arithmetic", () => {
  assert.equal(addMoney(money("EUR", 1n), money("EUR", 2n)).minor, 3n);
  assert.throws(() => addMoney(money("EUR", 1n), money("USD", 1n)), /currency mismatch/);
  assert.throws(() => subtractMoney(money("EUR", 1n), money("EUR", 2n)), /insufficient balance/);
});

test("double-entry balance is required", () => {
  const entries = [
    { accountId: "00000000-0000-4000-8000-000000000001", direction: "debit" as const, currency: "EUR", minor: 100n },
    { accountId: "00000000-0000-4000-8000-000000000002", direction: "credit" as const, currency: "EUR", minor: 100n },
  ];
  assert.doesNotThrow(() => assertBalanced(entries));
  assert.throws(() => assertBalanced([{ ...entries[0], minor: 99n }, entries[1]]), /unbalanced/);
  assert.equal(netByAccount(entries).get(entries[0].accountId)?.minor, -100n);
});
