import assert from "node:assert/strict";
import test from "node:test";
import { assertBalanced, netByLedgerAccount } from "../domain/ledger";
import { addMoney, currencyMinorDigits, money, subtractMoney } from "../domain/money";
import { parseUserReportedContributionJson } from "../server/contributionJsonContract";

const account = "00000000-0000-4000-8000-000000000011";
const cash = "00000000-0000-4000-8000-000000000021";
const clearing = "00000000-0000-4000-8000-000000000022";

test("exact minor-unit arithmetic and supported ISO 4217 currency exponents", () => {
  assert.equal(addMoney(money("EUR", 1n), money("EUR", 2n)).minor, 3n);
  assert.equal(currencyMinorDigits.JPY, 0);
  assert.equal(currencyMinorDigits.KWD, 3);
  assert.throws(() => money("ZZZ", 1n));
  assert.throws(() => money("EUR", -1n));
  assert.throws(() => addMoney(money("EUR", 1n), money("USD", 1n)), /currency mismatch/);
  assert.throws(() => subtractMoney(money("EUR", 1n), money("EUR", 2n)), /insufficient balance/);
});

test("double-entry requires distinct internal accounts, one investing account and exact per-currency balance", () => {
  const entries = [
    { investmentAccountId: account, ledgerAccountId: cash, direction: "debit" as const, currency: "EUR" as const, minor: 100n },
    { investmentAccountId: account, ledgerAccountId: clearing, direction: "credit" as const, currency: "EUR" as const, minor: 100n },
  ];
  assert.doesNotThrow(() => assertBalanced(entries));
  assert.throws(() => assertBalanced([{ ...entries[0], minor: 99n }, entries[1]]), /unbalanced/);
  assert.throws(() => assertBalanced([{ ...entries[0], ledgerAccountId: cash }, { ...entries[1], ledgerAccountId: cash }]), /distinct/);
  assert.throws(() => assertBalanced([{ ...entries[0], investmentAccountId: account }, { ...entries[1], investmentAccountId: "00000000-0000-4000-8000-000000000099" }]), /cross-investment-account/);
  assert.equal(netByLedgerAccount(entries).get(cash)?.minor, -100n);
  assert.equal(netByLedgerAccount(entries).get(clearing)?.minor, 100n);
});

test("future HTTP JSON contribution contract preserves minor units and rejects client authority", () => {
  const body={
    accountId:account,
    idempotencyKey:"canonical-json-00000001",
    currency:"EUR",
    amountMinor:"9007199254740993",
    externalReference:"bank-note-00001",
  };
  const decoded=parseUserReportedContributionJson(body);
  assert.equal(decoded.amountMinor,9007199254740993n);
  assert.equal(typeof decoded.amountMinor,"bigint");
  assert.equal(decoded.accountId,account);
  // JavaScript number parsing would lose precision: it must NOT be accepted.
  assert.throws(()=>parseUserReportedContributionJson({...body,amountMinor:9007199254740993}));
  assert.throws(()=>parseUserReportedContributionJson({...body,amountMinor:1.5}));
  assert.throws(()=>parseUserReportedContributionJson({...body,amountMinor:"0"}));
  assert.throws(()=>parseUserReportedContributionJson({...body,amountMinor:"01"}));
  assert.throws(()=>parseUserReportedContributionJson({...body,amountMinor:"1e3"}));
  assert.throws(()=>parseUserReportedContributionJson({...body,amountMinor:"-1"}));
  assert.throws(()=>parseUserReportedContributionJson({...body,amountMinor:"1".repeat(39)}));
  assert.equal(
    parseUserReportedContributionJson({...body,amountMinor:"9".repeat(38)}).amountMinor,
    BigInt("9".repeat(38)),
  );
  for(const forged of [
    {userId:"clerk_user_a"},
    {sessionId:"unverified_session"},
    {actor:{userId:"clerk_user_a",sessionId:"fabricated"}},
    {role:"investing_contribution_writer"},
    {accessToken:"fabricated_token"},
  ]) {
    assert.throws(()=>parseUserReportedContributionJson({...body,...forged}));
  }
});
