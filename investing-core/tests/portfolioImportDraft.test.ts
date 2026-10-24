import assert from "node:assert/strict";
import test from "node:test";
import {
  parsePortfolioImportDraft,
  quantityToAtoms,
  QUANTITY_UNIT,
  validIsin,
} from "../portfolio/portfolioImportDraft";

const apple = { isin: "US0378331005", mic: "XNAS", quoteCurrency: "USD" };
const microsoft = { isin: "US5949181045", mic: "XNAS", quoteCurrency: "USD" };
const etf = { isin: "IE00B4L5Y983", mic: "XAMS", quoteCurrency: "EUR" };

function sample(): Record<string, unknown> {
  return {
    schemaVersion: "R2_IMPORT_DRAFT_V1",
    source: "MANUAL_ENTRY",
    sourceReference: "statement-20261022-0001",
    asOf: "2026-10-22T10:00:00.000Z",
    portfolioName: " Long term investments ",
    baseCurrency: "EUR",
    cashBalances: [
      { currency: "USD", amountMinor: "9007199254740993" },
      { currency: "EUR", amountMinor: "12550" },
    ],
    positions: [
      { instrument: apple, quantity: "1.000000000001", reportedCostBasis: null },
      { instrument: etf, quantity: "12.5", reportedCostBasis: { currency: "EUR", amountMinor: "145000" } },
    ],
    plannedContributions: [
      { currency: "EUR", amountMinor: "10000", dueDate: "2026-11-01" },
    ],
  };
}

test("R2-A exact units, no FX conversion, unknown cost basis, no invented valuation", () => {
  const parsed = parsePortfolioImportDraft(sample());
  assert.equal(parsed.state, "UNVERIFIED_IMPORT_DRAFT");
  assert.equal(parsed.persistence, "NOT_PERFORMED");
  assert.equal(parsed.provenance.kind, "USER_REPORTED");
  assert.equal(parsed.portfolioName, "Long term investments");
  assert.equal(parsed.cashBalances[0]?.currency, "EUR");
  assert.equal(parsed.cashBalances[0]?.minor, 12550n);
  assert.equal(parsed.cashBalances[1]?.minor, 9007199254740993n);
  assert.equal(parsed.positions[0]?.isin, etf.isin); // canonical ASCII ordering
  assert.equal(parsed.positions[0]?.quantityAtoms, 12500000000000n);
  assert.equal(parsed.positions[0]?.reportedCostBasis?.minor, 145000n);
  assert.equal(parsed.positions[1]?.isin, apple.isin);
  assert.equal(parsed.positions[1]?.quantityAtoms, 1000000000001n);
  assert.equal(parsed.positions[1]?.reportedCostBasis, null);
  assert.equal(parsed.valuation, "UNAVAILABLE");
  assert.equal(parsed.performance, "UNAVAILABLE");
  assert.equal(parsed.verifiedCash, "UNAVAILABLE");
  assert.equal(parsed.mixedCurrencyTotal, "UNAVAILABLE");
  assert.equal(parsed.realizedContributions, "UNAVAILABLE");
});

test("planned contributions never become cash, realized deposits or performance", () => {
  const actual = parsePortfolioImportDraft(sample());
  const planned = actual.plannedContributions[0];
  assert.equal(planned?.realized, false);
  assert.equal(planned?.minor, 10000n);
  assert.equal(actual.cashBalances.find((item) => item.currency === "EUR")?.minor, 12550n);
  assert.equal(actual.realizedContributions, "UNAVAILABLE");
});

test("deterministic result independent of input ordering", () => {
  const a = sample();
  const b = sample();
  (b.cashBalances as unknown[]).reverse();
  (b.positions as unknown[]).reverse();
  assert.deepEqual(parsePortfolioImportDraft(a), parsePortfolioImportDraft(b));
  assert.equal(Object.isFrozen(parsePortfolioImportDraft(a)), true);
});

test("quantities are exactly scaled, not binary floats", () => {
  assert.equal(QUANTITY_UNIT, 1000000000000n);
  assert.equal(quantityToAtoms("0.000000000001"), 1n);
  assert.equal(quantityToAtoms("2.5"), 2500000000000n);
  assert.equal(quantityToAtoms("9999.999999999999"), 9999999999999999n);
  for (const invalid of ["0", "0.000000000000", "-1", "1e3", "1.0000000000001", ".5", "01", "1.", "999999999999999999999999999"]) {
    assert.throws(() => quantityToAtoms(invalid), invalid);
  }
});

test("ISIN must include valid ISO 6166 check digit, not just look like a ticker", () => {
  assert.equal(validIsin(apple.isin), true);
  assert.equal(validIsin(microsoft.isin), true);
  assert.equal(validIsin(etf.isin), true);
  for (const invalid of ["AAPL", "US0378331004", "US037833100X", "us0378331005", "US03783310050"]) {
    assert.equal(validIsin(invalid), false);
  }
});

test("strict import rejects forged user/tenant/account/broker authority", () => {
  for (const forbidden of [
    { userId: "user_victim" },
    { tenantId: "tenant_b" },
    { accountId: "00000000-0000-4000-8000-000000000000" },
    { investmentAccountId: "account_b" },
    { verifiedByBroker: true },
    { confirmedCashMinor: "250000" },
    { marketValueMinor: "9999999" },
  ]) {
    assert.throws(() => parsePortfolioImportDraft({ ...sample(), ...forbidden }));
  }
  assert.throws(() => parsePortfolioImportDraft({ ...sample(), source: "BROKER_CONFIRMED" }));
});

test("duplicate cash currencies and same ISIN-MIC-quote position are refused", () => {
  assert.throws(() => parsePortfolioImportDraft({
    ...sample(),
    cashBalances: [{ currency: "EUR", amountMinor: "1" }, { currency: "EUR", amountMinor: "2" }],
  }), /duplicate cash/);
  assert.throws(() => parsePortfolioImportDraft({
    ...sample(),
    positions: [
      { instrument: apple, quantity: "1", reportedCostBasis: null },
      { instrument: apple, quantity: "2", reportedCostBasis: null },
    ],
  }), /duplicate instrument/);
});

test("distinct exchange/currency instrument identities do not get silently merged", () => {
  const imported = parsePortfolioImportDraft({
    ...sample(),
    positions: [
      { instrument: apple, quantity: "1", reportedCostBasis: null },
      { instrument: { ...apple, mic: "XETR", quoteCurrency: "EUR" }, quantity: "1", reportedCostBasis: null },
    ],
  });
  assert.equal(imported.positions.length, 2);
});

test("amounts must be exact canonical minor-unit strings, never floating numbers", () => {
  for (const invalid of ["-1", "1.5", "1e3", "01", "", "9".repeat(39), 9007199254740993]) {
    assert.throws(() => parsePortfolioImportDraft({
      ...sample(),
      cashBalances: [{ currency: "EUR", amountMinor: invalid }],
    }));
  }
  assert.throws(() => parsePortfolioImportDraft({
    ...sample(),
    positions: [{ instrument: apple, quantity: 1.5, reportedCostBasis: null }],
  }));
});

test("unknown currency, invalid MIC/ISIN, extra position fields all fail closed", () => {
  assert.throws(() => parsePortfolioImportDraft({
    ...sample(),
    baseCurrency: "ZZZ",
  }));
  assert.throws(() => parsePortfolioImportDraft({
    ...sample(),
    positions: [{ instrument: { ...apple, mic: "NASDAQ" }, quantity: "1", reportedCostBasis: null }],
  }));
  assert.throws(() => parsePortfolioImportDraft({
    ...sample(),
    positions: [{ instrument: { ...apple, isin: "US0378331004" }, quantity: "1", reportedCostBasis: null }],
  }));
  assert.throws(() => parsePortfolioImportDraft({
    ...sample(),
    positions: [{ instrument: apple, quantity: "1", reportedCostBasis: null, ownerUserId: "forged" }],
  }));
});

test("invalid point-in-time and planned dates fail closed, planned-only is not a portfolio snapshot", () => {
  for (const invalid of ["2026-02-30T12:00:00.000Z", "2026-10-22", "2026-10-22T12:00:00+00:00"]) {
    assert.throws(() => parsePortfolioImportDraft({ ...sample(), asOf: invalid }));
  }
  assert.throws(() => parsePortfolioImportDraft({
    ...sample(),
    plannedContributions: [{ currency: "EUR", amountMinor: "1", dueDate: "2026-02-30" }],
  }));
  assert.throws(() => parsePortfolioImportDraft({
    ...sample(),
    cashBalances: [],
    positions: [],
    plannedContributions: [{ currency: "EUR", amountMinor: "1", dueDate: "2026-11-01" }],
  }));
});

test("explicit zero reported cost remains different from missing cost", () => {
  const draft = parsePortfolioImportDraft({
    ...sample(),
    positions: [
      { instrument: apple, quantity: "1", reportedCostBasis: { currency: "USD", amountMinor: "0" } },
      { instrument: microsoft, quantity: "1", reportedCostBasis: null },
    ],
  });
  assert.equal(draft.positions.find((p) => p.isin === apple.isin)?.reportedCostBasis?.minor, 0n);
  assert.equal(draft.positions.find((p) => p.isin === microsoft.isin)?.reportedCostBasis, null);
});
