import { MarketDataError, validMarketDate } from "./identity";
import { historicalRowsToResult, type HistoricalMarketDataPoint } from "./contracts";

/**
 * G2-B: directed, provider-neutral daily FX series and exact conversion.
 * The private SQL registry binds base/quote to a canonical FX listing. No
 * ticker guessing, synthetic rates, inverse quote or triangulation.
 */
export type FxHistoryRequest = Readonly<{
  baseCurrency: string;
  quoteCurrency: string;
  startDate: string;
  endDate: string;
  asOf: string;
  ratePolicy: "DIRECT_DAILY_CLOSE";
}>;
export type FxHistoryResult = Readonly<{
  request: FxHistoryRequest;
  status: "AVAILABLE" | "PARTIAL" | "LICENSE_BLOCKED" | "UNAVAILABLE";
  listingId: string | null;
  instrumentId: string | null;
  providerId: string | null;
  rightsPolicyId: string | null;
  points: readonly HistoricalMarketDataPoint[];
}>;
export type FxConversionResult = Readonly<{
  status: "AVAILABLE" | "UNAVAILABLE" | "LICENSE_BLOCKED";
  fromCurrency: string;
  toCurrency: string;
  inputAmount: string;
  convertedAmount: string | null;
  marketDate: string;
  rate: string | null;
  method: "DIRECT_DAILY_CLOSE";
  providerId: string | null;
  rightsPolicyId: string | null;
  revisionId: string | null;
  asKnownAt: string | null;
}>;

function fail(): never { throw new MarketDataError("INVALID_PROVIDER_RESPONSE"); }
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function currency(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}
function utc(value: unknown): value is string {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 19) === value.slice(0, 19);
}
function validRequest(v: unknown): v is FxHistoryRequest {
  return object(v) && currency(v.baseCurrency) && currency(v.quoteCurrency) &&
    v.baseCurrency !== v.quoteCurrency && validMarketDate(v.startDate) &&
    validMarketDate(v.endDate) && v.startDate <= v.endDate && utc(v.asOf) &&
    v.ratePolicy === "DIRECT_DAILY_CLOSE";
}
function amountParts(value: unknown, positiveOnly: boolean): { digits: bigint; scale: number } {
  if (typeof value !== "string" || value.length > 96 ||
      !/^-?(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) fail();
  const neg = value.startsWith("-");
  const abs = neg ? value.slice(1) : value;
  const [whole, fraction = ""] = abs.split(".");
  const digits = BigInt(whole + fraction) * (neg ? -1n : 1n);
  if (positiveOnly && digits <= 0n) fail();
  return { digits, scale: fraction.length };
}
function multiplyExactly(amount: string, rate: string): string {
  const a = amountParts(amount, false);
  const r = amountParts(rate, true);
  const product = a.digits * r.digits;
  const negative = product < 0n;
  const absolute = (negative ? -product : product).toString();
  const scale = a.scale + r.scale;
  if (scale === 0) return product.toString();
  const padded = absolute.padStart(scale + 1, "0");
  const fractional = padded.slice(-scale).replace(/0+$/, "");
  const whole = padded.slice(0, -scale);
  return (negative ? "-" : "") + whole + (fractional ? "." + fractional : "");
}

/** Only rows returned by market_core.read_fx_history are permitted at this boundary. */
export function fxHistoryFromRows(request: FxHistoryRequest, rows: readonly unknown[]): FxHistoryResult {
  if (!validRequest(request) || !Array.isArray(rows) || !rows.every(object)) fail();
  if (rows.length === 0) return Object.freeze({
    request, status: "UNAVAILABLE" as const, listingId: null, instrumentId: null,
    providerId: null, rightsPolicyId: null, points: Object.freeze([]),
  });
  const first = rows[0];
  if (first.fx_base_currency !== request.baseCurrency ||
      first.fx_quote_currency !== request.quoteCurrency ||
      first.currency !== request.quoteCurrency ||
      typeof first.listing_id !== "string") fail();
  if (rows.some(row => row.fx_base_currency !== request.baseCurrency ||
      row.fx_quote_currency !== request.quoteCurrency || row.currency !== request.quoteCurrency)) fail();
  const history = historicalRowsToResult({
    listingId: first.listing_id, startDate: request.startDate, endDate: request.endDate,
    asOf: request.asOf, interval: "1day", adjustment: "none",
  }, rows);
  if (history.status === "UNAVAILABLE") fail();
  return Object.freeze({
    request, status: history.status, listingId: history.listingId,
    instrumentId: history.instrumentId, providerId: history.providerId,
    rightsPolicyId: history.rightsPolicyId, points: history.points,
  });
}

/**
 * Requires an exact session date. A Friday FX close is not silently used
 * for Monday; consumer policy for holiday gaps is a later separate decision.
 * No rates obtained => never invent zero/one or use a previous revision.
 */
export function convertWithFx(input: Readonly<{
  history: FxHistoryResult;
  amount: string;
  fromCurrency: string;
  toCurrency: string;
  marketDate: string;
  asOf: string;
  /** Policy authorized by the internal consuming service; mismatches must not receive FX. */
  requiredRightsPolicyId: string;
}>): FxConversionResult {
  if (!object(input) || !validRequest(input.history?.request) ||
      input.fromCurrency !== input.history.request.baseCurrency ||
      input.toCurrency !== input.history.request.quoteCurrency ||
      input.marketDate < input.history.request.startDate ||
      input.marketDate > input.history.request.endDate ||
      !validMarketDate(input.marketDate) || !utc(input.asOf) ||
      typeof input.requiredRightsPolicyId !== "string" ||
      input.requiredRightsPolicyId.length === 0 ||
      input.asOf !== input.history.request.asOf ||
      !Array.isArray(input.history.points) ||
      !["AVAILABLE", "PARTIAL", "LICENSE_BLOCKED", "UNAVAILABLE"].includes(input.history.status)) fail();
  amountParts(input.amount, false);
  const selected = input.history.points.filter(p => p.marketDate === input.marketDate);
  if (selected.length > 1) fail();
  const point = selected[0];
  const status: FxConversionResult["status"] =
    !point ? "UNAVAILABLE" :
    point.close === null || input.history.rightsPolicyId !== input.requiredRightsPolicyId
      ? "LICENSE_BLOCKED" : "AVAILABLE";
  if (status === "AVAILABLE") {
    if (!input.history.providerId || !input.history.rightsPolicyId || !point.revisionId ||
        !point.asKnownAt || !utc(point.asKnownAt) ||
        Date.parse(point.asKnownAt) > Date.parse(input.asOf) ||
        point.marketDate > input.asOf.slice(0, 10)) fail();
    amountParts(point.close, true);
  }
  // Reject impossible or fabricated history states. A caller's differing rights
  // policy is a normal LICENSE_BLOCKED outcome, not tampering of the SQL row.
  const countVisible = input.history.points.filter(p => p.close !== null).length;
  const countMasked = input.history.points.length - countVisible;
  if ((input.history.status === "UNAVAILABLE" && input.history.points.length !== 0) ||
      (input.history.status === "LICENSE_BLOCKED" && (countVisible !== 0 || countMasked === 0)) ||
      (input.history.status === "AVAILABLE" && (countVisible === 0 || countMasked !== 0)) ||
      (input.history.status === "PARTIAL" && (countVisible === 0 || countMasked === 0)) ||
      (point?.close === null && (point.revisionId !== null || point.asKnownAt !== null ||
         point.sourceRevision !== null || point.qualityFlags.length !== 0))) fail();
  return Object.freeze({
    status, fromCurrency: input.fromCurrency, toCurrency: input.toCurrency,
    inputAmount: input.amount,
    convertedAmount: status === "AVAILABLE" ? multiplyExactly(input.amount, point!.close!) : null,
    marketDate: input.marketDate, rate: status === "AVAILABLE" ? point!.close : null,
    method: "DIRECT_DAILY_CLOSE",
    providerId: status === "AVAILABLE" ? input.history.providerId : null,
    rightsPolicyId: status === "AVAILABLE" ? input.history.rightsPolicyId : null,
    revisionId: status === "AVAILABLE" ? point!.revisionId : null,
    asKnownAt: status === "AVAILABLE" ? point!.asKnownAt : null,
  });
}
