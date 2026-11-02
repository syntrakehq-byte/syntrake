import { MarketDataError } from "./identity";

export type CorporateActionType = "SPLIT" | "DIVIDEND";
export type CorporateActionAdjustment = "none" | "splits" | "dividends" | "all";
export type CorporateActionRevision = Readonly<{
  actionId: string; revisionId: string; listingId: string; providerId: string; rightsPolicyId: string;
  type: CorporateActionType; exDate: string; recordDate: string | null; paymentDate: string | null;
  ratioFrom: string | null; ratioTo: string | null; amount: string | null; currency: string | null;
  sourceRevision: string; firstSeenAt: string; ingestedAt: string; asKnownAt: string; qualityFlags: readonly string[];
}>;
export type CorporateActionRow = Readonly<Record<string, unknown>>;
export type AdjustedCandle = Readonly<{ marketDate: string; open: string; high: string; low: string; close: string; volume: string | null }>;
export type CorporateActionAdjustmentResult = Readonly<{ status: "AVAILABLE" | "UNAVAILABLE"; candles: readonly AdjustedCandle[]; appliedRevisionIds: readonly string[]; reason: string | null }>;

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/;
const SCALE = 1_000_000_000_000n;
function bad(): never { throw new MarketDataError("INVALID_PROVIDER_RESPONSE"); }
function decimal(value: unknown, positive = true): string { if (typeof value !== "string" || !DECIMAL.test(value) || (positive && !/[1-9]/.test(value))) return bad(); return value; }
function date(value: unknown): string { if (value instanceof Date) { if (Number.isNaN(value.getTime())) return bad(); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; } if (typeof value !== "string" || !DATE.test(value)) return bad(); return value; }
function utc(value: unknown): string { if (value instanceof Date) { if (Number.isNaN(value.getTime())) return bad(); return value.toISOString(); } if (typeof value !== "string" || !UTC.test(value) || Number.isNaN(Date.parse(value))) return bad(); return value; }
function uuid(value: unknown): string { if (typeof value !== "string" || !UUID.test(value)) return bad(); return value; }
function fixed(value: string): bigint { const [whole, fraction = ""] = value.split("."); return BigInt(whole) * SCALE + BigInt(fraction.padEnd(12, "0")); }
function format(value: bigint): string { const sign = value < 0n ? "-" : ""; const abs = value < 0n ? -value : value; const whole = abs / SCALE; const fraction = (abs % SCALE).toString().padStart(12, "0").replace(/0+$/, ""); return `${sign}${whole}${fraction ? `.${fraction}` : ""}`; }
function multiplyRatio(value: string, numerator: bigint, denominator: bigint): string { if (denominator <= 0n || numerator <= 0n) return bad(); return format((fixed(value) * numerator) / denominator); }
function validCandle(candle: AdjustedCandle): void { date(candle.marketDate); decimal(candle.open); decimal(candle.high); decimal(candle.low); decimal(candle.close); if (candle.volume !== null) decimal(candle.volume, false); }

export function corporateActionFromRow(row: CorporateActionRow): CorporateActionRevision {
  const type = row.event_type; if (type !== "SPLIT" && type !== "DIVIDEND") return bad();
  const result: CorporateActionRevision = { actionId: uuid(row.action_id), revisionId: uuid(row.revision_id), listingId: uuid(row.listing_id), providerId: uuid(row.provider_id), rightsPolicyId: uuid(row.rights_policy_id), type, exDate: date(row.ex_date), recordDate: row.record_date === null ? null : date(row.record_date), paymentDate: row.payment_date === null ? null : date(row.payment_date), ratioFrom: row.ratio_from === null ? null : decimal(row.ratio_from), ratioTo: row.ratio_to === null ? null : decimal(row.ratio_to), amount: row.dividend_amount === null ? null : decimal(row.dividend_amount, false), currency: row.dividend_currency === null ? null : String(row.dividend_currency), sourceRevision: decimalHex(row.source_revision), firstSeenAt: utc(row.first_seen_at), ingestedAt: utc(row.ingested_at), asKnownAt: utc(row.as_known_at), qualityFlags: Array.isArray(row.quality_flags) && row.quality_flags.every(x => typeof x === "string") ? row.quality_flags : bad() };
  if (result.type === "SPLIT" && (result.ratioFrom === null || result.ratioTo === null || result.amount !== null || result.currency !== null)) return bad();
  if (result.type === "DIVIDEND" && (result.amount === null || result.currency === null || result.ratioFrom !== null || result.ratioTo !== null || !/^[A-Z]{3}$/.test(result.currency))) return bad();
  if (Date.parse(result.asKnownAt) < Date.parse(result.firstSeenAt) || Date.parse(result.asKnownAt) > Date.parse(result.ingestedAt)) return bad();
  return Object.freeze(result);
}
function decimalHex(value: unknown): string { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) return bad(); return value; }

export function selectCorporateActionsPIT(rows: readonly CorporateActionRow[], listingId: string, cutoff: string): readonly CorporateActionRevision[] {
  uuid(listingId); utc(cutoff); const selected = new Map<string, CorporateActionRevision>();
  for (const row of rows) { const action = corporateActionFromRow(row); if (action.listingId !== listingId || Date.parse(action.asKnownAt) > Date.parse(cutoff)) return bad(); const previous = selected.get(action.actionId); if (!previous || Date.parse(action.asKnownAt) > Date.parse(previous.asKnownAt)) selected.set(action.actionId, action); }
  return Object.freeze([...selected.values()].sort((a, b) => a.exDate.localeCompare(b.exDate) || a.revisionId.localeCompare(b.revisionId)));
}

export function adjustHistoricalSeries(input: Readonly<{ candles: readonly AdjustedCandle[]; actions: readonly CorporateActionRevision[]; adjustment: CorporateActionAdjustment; quoteCurrency: string; sourceAdjustment?: "none" | "splits" | "dividends" | "all" }>): CorporateActionAdjustmentResult {
  if (!Array.isArray(input.candles) || !["none", "splits", "dividends", "all"].includes(input.adjustment) || !/^[A-Z]{3}$/.test(input.quoteCurrency) || input.sourceAdjustment !== undefined && input.sourceAdjustment !== "none") return { status: "UNAVAILABLE", candles: [], appliedRevisionIds: [], reason: "INSUFFICIENT_ADJUSTMENT_PROVENANCE" };
  const candles = [...input.candles].sort((a, b) => a.marketDate.localeCompare(b.marketDate)); candles.forEach(validCandle); if (input.adjustment === "none") return { status: "AVAILABLE", candles, appliedRevisionIds: [], reason: null };
  const actions = [...input.actions]; const seen = new Set<string>(); for (const action of actions) { if (seen.has(action.revisionId)) return { status: "UNAVAILABLE", candles: [], appliedRevisionIds: [], reason: "DUPLICATE_ACTION_REVISION" }; seen.add(action.revisionId); }
  let result = candles.map(c => ({ ...c })); const applied: string[] = [];
  for (const action of actions) {
    const applySplit = action.type === "SPLIT" && (input.adjustment === "splits" || input.adjustment === "all"); const applyDividend = action.type === "DIVIDEND" && (input.adjustment === "dividends" || input.adjustment === "all"); if (!applySplit && !applyDividend) continue;
    if (applySplit) { const from = fixed(action.ratioFrom!); const to = fixed(action.ratioTo!); if (from <= 0n || to <= 0n) return { status: "UNAVAILABLE", candles: [], appliedRevisionIds: [], reason: "INVALID_SPLIT_RATIO" }; result = result.map(c => c.marketDate < action.exDate ? { ...c, open: multiplyRatio(c.open, from, to), high: multiplyRatio(c.high, from, to), low: multiplyRatio(c.low, from, to), close: multiplyRatio(c.close, from, to), volume: c.volume === null ? null : multiplyRatio(c.volume, to, from) } : c); applied.push(action.revisionId); }
    if (applyDividend) { if (action.currency !== input.quoteCurrency) return { status: "UNAVAILABLE", candles: [], appliedRevisionIds: [], reason: "DIVIDEND_CURRENCY_MISMATCH" }; const index = result.findIndex(c => c.marketDate >= action.exDate); const prior = index > 0 ? result[index - 1] : null; if (!prior || action.amount === null || fixed(prior.close) <= fixed(action.amount)) return { status: "UNAVAILABLE", candles: [], appliedRevisionIds: [], reason: "INSUFFICIENT_DIVIDEND_BASIS" }; const numerator = fixed(prior.close) - fixed(action.amount); const denominator = fixed(prior.close); result = result.map(c => c.marketDate < action.exDate ? { ...c, open: multiplyRatio(c.open, numerator, denominator), high: multiplyRatio(c.high, numerator, denominator), low: multiplyRatio(c.low, numerator, denominator), close: multiplyRatio(c.close, numerator, denominator) } : c); applied.push(action.revisionId); }
  }
  return { status: "AVAILABLE", candles: result, appliedRevisionIds: applied, reason: null };
}
