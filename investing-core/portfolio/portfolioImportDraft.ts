import { z } from "zod";
import { currencyCode, type CurrencyCode } from "../domain/money";

/**
 * R2-A is a deterministic, read-only normalizer for UNVERIFIED portfolio
 * import drafts. It never reads a database or asserts broker/account ownership.
 */
export const QUANTITY_SCALE = 12n;
export const QUANTITY_UNIT = 10n ** QUANTITY_SCALE;
const MAX_NUMERIC_ATOMS = 10n ** 38n;

const minorUnitString = z.string().regex(/^(?:0|[1-9][0-9]{0,37})$/);
const quantityString = z.string().regex(
  /^(?:[1-9][0-9]{0,25}(?:\.[0-9]{1,12})?|0\.[0-9]{1,12})$/,
);

const utcTimestamp = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
).refine((s) => {
  const ms = Date.parse(s);
  return Number.isFinite(ms) && new Date(ms).toISOString() === s;
}, "invalid UTC as-of timestamp");

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const ms = Date.parse(s + "T00:00:00.000Z");
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s;
}, "invalid contribution date");

/** ISO 6166 modulus-10 check digit, expanded letters A=10 through Z=35. */
export function validIsin(value: string): boolean {
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(value)) return false;
  let expanded = "";
  for (const char of value) {
    const n = char.charCodeAt(0);
    expanded += n >= 65 && n <= 90 ? String(n - 55) : char;
  }
  let sum = 0;
  let doubleDigit = false;
  for (let i = expanded.length - 1; i >= 0; i -= 1) {
    let digit = expanded.charCodeAt(i) - 48;
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

const instrument = z.object({
  isin: z.string().refine(validIsin, "invalid ISIN or check digit"),
  mic: z.string().regex(/^[A-Z0-9]{4}$/),
  quoteCurrency: currencyCode,
}).strict();

const reportedCostBasis = z.object({
  currency: currencyCode,
  amountMinor: minorUnitString,
}).strict();

const snapshotSchema = z.object({
  schemaVersion: z.literal("R2_IMPORT_DRAFT_V1"),
  source: z.enum(["MANUAL_ENTRY", "DOCUMENT_EXTRACTED"]),
  sourceReference: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/),
  asOf: utcTimestamp,
  portfolioName: z.string().trim().min(1).max(120),
  baseCurrency: currencyCode,
  /** Completeness is an explicit user assertion, never inferred from missing rows. */
  reportedCoverage: z.object({
    cash: z.enum(["NOT_REPORTED", "PARTIAL", "ASSERTED_COMPLETE"]),
    positions: z.enum(["NOT_REPORTED", "PARTIAL", "ASSERTED_COMPLETE"]),
  }).strict(),
  cashBalances: z.array(z.object({
    currency: currencyCode,
    amountMinor: minorUnitString,
  }).strict()).max(100),
  positions: z.array(z.object({
    instrument,
    quantity: quantityString,
    reportedCostBasis: reportedCostBasis.nullable(),
  }).strict()).max(5000),
  plannedContributions: z.array(z.object({
    currency: currencyCode,
    amountMinor: minorUnitString.refine((s) => s !== "0"),
    dueDate: dateOnly,
  }).strict()).max(500),
}).strict();

function lex(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Convert an exact user-declared decimal quantity to integer 10^12 atoms. */
export function quantityToAtoms(value: string): bigint {
  const parsed = quantityString.parse(value);
  const [whole, fraction = ""] = parsed.split(".");
  const atoms = BigInt(whole) * QUANTITY_UNIT + BigInt(fraction.padEnd(12, "0") || "0");
  if (atoms <= 0n || atoms >= MAX_NUMERIC_ATOMS) {
    throw new Error("quantity outside exact supported range");
  }
  return atoms;
}

function toMinor(value: string): bigint {
  return BigInt(minorUnitString.parse(value));
}

export type ReportedMoney = Readonly<{ currency: CurrencyCode; minor: bigint }>;

export type UnverifiedImportDraft = Readonly<{
  state: "UNVERIFIED_IMPORT_DRAFT";
  schemaVersion: "R2_IMPORT_DRAFT_V1";
  provenance: Readonly<{ kind: "USER_REPORTED"; source: "MANUAL_ENTRY" | "DOCUMENT_EXTRACTED"; sourceReference: string; asOf: string }>;
  portfolioName: string;
  baseCurrency: CurrencyCode;
  reportedCoverage: Readonly<{
    cash: "NOT_REPORTED" | "PARTIAL" | "ASSERTED_COMPLETE";
    positions: "NOT_REPORTED" | "PARTIAL" | "ASSERTED_COMPLETE";
  }>;
  cashBalances: readonly Readonly<{ currency: CurrencyCode; minor: bigint; verification: "UNVERIFIED" }>[];
  positions: readonly Readonly<{
    isin: string;
    mic: string;
    quoteCurrency: CurrencyCode;
    quantityAtoms: bigint;
    reportedCostBasis: ReportedMoney | null;
    verification: "UNVERIFIED";
  }>[];
  plannedContributions: readonly Readonly<{ currency: CurrencyCode; minor: bigint; dueDate: string; realized: false }>[];
  valuation: "UNAVAILABLE";
  performance: "UNAVAILABLE";
  verifiedCash: "UNAVAILABLE";
  realizedContributions: "UNAVAILABLE";
  mixedCurrencyTotal: "UNAVAILABLE";
  persistence: "NOT_PERFORMED";
}>;

/**
 * No caller-supplied actor/user/account/tenant ID can pass the strict schema.
 * No market value, P&L, FX conversion, transaction or cash transfer is inferred.
 * The source reference does NOT reserve a persisted idempotency key.
 */
export function parsePortfolioImportDraft(input: unknown): UnverifiedImportDraft {
  const snapshot = snapshotSchema.parse(input);
  if (snapshot.positions.length === 0 && snapshot.cashBalances.length === 0) {
    throw new Error("an import needs at least one reported cash balance or position");
  }

  // Missing rows never imply zero holdings/cash. A user may explicitly claim
  // completeness; this is still an unverified *declaration*, not reconciliation.
  const coveragePairs = [
    [snapshot.reportedCoverage.cash, snapshot.cashBalances.length, "cash"],
    [snapshot.reportedCoverage.positions, snapshot.positions.length, "positions"],
  ] as const;
  for (const [coverage, count, domain] of coveragePairs) {
    if (coverage === "NOT_REPORTED" && count !== 0) {
      throw new Error(domain + " rows contradict NOT_REPORTED coverage");
    }
    if (coverage === "PARTIAL" && count === 0) {
      throw new Error(domain + " PARTIAL coverage requires at least one reported row");
    }
  }

  const seenCash = new Set<string>();
  const cashBalances = snapshot.cashBalances.map((entry) => {
    if (seenCash.has(entry.currency)) throw new Error("duplicate cash currency");
    seenCash.add(entry.currency);
    return Object.freeze({ currency: entry.currency, minor: toMinor(entry.amountMinor), verification: "UNVERIFIED" as const });
  }).sort((a, b) => lex(a.currency, b.currency));

  const seenInstruments = new Set<string>();
  const positions = snapshot.positions.map((position) => {
    const id = JSON.stringify([position.instrument.isin, position.instrument.mic, position.instrument.quoteCurrency]);
    if (seenInstruments.has(id)) throw new Error("duplicate instrument identity");
    seenInstruments.add(id);
    return Object.freeze({
      isin: position.instrument.isin,
      mic: position.instrument.mic,
      quoteCurrency: position.instrument.quoteCurrency,
      quantityAtoms: quantityToAtoms(position.quantity),
      reportedCostBasis: position.reportedCostBasis === null ? null : Object.freeze({
        currency: position.reportedCostBasis.currency,
        minor: toMinor(position.reportedCostBasis.amountMinor),
      }),
      verification: "UNVERIFIED" as const,
    });
  }).sort((a, b) => lex(
    JSON.stringify([a.isin, a.mic, a.quoteCurrency]),
    JSON.stringify([b.isin, b.mic, b.quoteCurrency]),
  ));

  const plannedContributions = snapshot.plannedContributions.map((item) => Object.freeze({
    currency: item.currency,
    minor: toMinor(item.amountMinor),
    dueDate: item.dueDate,
    realized: false as const,
  })).sort((a, b) => lex(
    JSON.stringify([a.dueDate, a.currency, a.minor.toString()]),
    JSON.stringify([b.dueDate, b.currency, b.minor.toString()]),
  ));

  return Object.freeze({
    state: "UNVERIFIED_IMPORT_DRAFT",
    schemaVersion: snapshot.schemaVersion,
    provenance: Object.freeze({
      kind: "USER_REPORTED",
      source: snapshot.source,
      sourceReference: snapshot.sourceReference,
      asOf: snapshot.asOf,
    }),
    portfolioName: snapshot.portfolioName,
    baseCurrency: snapshot.baseCurrency,
    reportedCoverage: Object.freeze({ ...snapshot.reportedCoverage }),
    cashBalances: Object.freeze(cashBalances),
    positions: Object.freeze(positions),
    plannedContributions: Object.freeze(plannedContributions),
    valuation: "UNAVAILABLE",
    performance: "UNAVAILABLE",
    verifiedCash: "UNAVAILABLE",
    realizedContributions: "UNAVAILABLE",
    mixedCurrencyTotal: "UNAVAILABLE",
    persistence: "NOT_PERFORMED",
  });
}
