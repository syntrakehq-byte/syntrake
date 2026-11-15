import type { NewsEnvelope } from "./n5Api";

/**
 * Structural copy of the public Market Core DataEnvelope boundary from
 * feat/r3-g1-universal-market-contract-20261102.  The Market engine is not
 * imported or merged into News; this is the explicit cross-engine boundary.
 */
export const MARKET_DATA_ENVELOPE_CONTRACT_VERSION = "market-data-envelope-v1" as const;
export type MarketDataEnvelopeV1 = Readonly<{
  status: "AVAILABLE" | "STALE" | "PARTIAL" | "UNAVAILABLE" | "LICENSE_BLOCKED" | "AMBIGUOUS";
  sourceRefs: readonly Readonly<{ provider: string; originalSourceId: string; requestId: string | null; sourceDocumentUri: string | null }>[];
  firstSeenAt: string;
  ingestedAt: string;
  asKnownAt: string;
  revisionId: string;
  schemaVersion: string;
  quality: Readonly<{ flags: readonly string[]; coverage: "FULL" | "PARTIAL" | "NONE" }>;
  rights: Readonly<{ policyId: string; display: boolean; retentionUntil: string | null }>;
  value?: unknown;
}>;

export const NEWS_CONSUMER_CONTRACT_VERSION = "news-consumer-v1" as const;
export type NewsConsumerKindV1 = "INVESTING" | "TRADING";
export type NewsConsumerFactV1 = Readonly<{
  eventId: string;
  eventType: string;
  confirmationStatus: "PRIMARY_CONFIRMED" | "CORROBORATED" | "REPORTED" | "UNVERIFIED" | "DISPUTED";
  lifecycleStatus: "ACTIVE" | "CORRECTED" | "RETRACTED";
  asKnownAt: string;
  sourceRefs: readonly string[];
}>;

/** Consumer-neutral read boundary. It contains no account, portfolio, order or valuation data. */
export type NewsConsumerEnvelopeV1<T> = Readonly<{
  contractVersion: typeof NEWS_CONSUMER_CONTRACT_VERSION;
  consumer: NewsConsumerKindV1;
  news: NewsEnvelope<T>;
}>;

export function adaptNewsForConsumerV1<T>(consumer: NewsConsumerKindV1, news: NewsEnvelope<T>): NewsConsumerEnvelopeV1<T> {
  if (consumer !== "INVESTING" && consumer !== "TRADING") throw new Error("NEWS_CONSUMER_INVALID");
  return { contractVersion: NEWS_CONSUMER_CONTRACT_VERSION, consumer, news };
}

export type MarketTemporalEnvelopeV1 = Readonly<{
  status: "AVAILABLE" | "STALE" | "PARTIAL" | "UNAVAILABLE" | "LICENSE_BLOCKED" | "AMBIGUOUS";
  firstSeenAt: string;
  ingestedAt: string;
  asKnownAt: string;
  revisionId: string;
}>;

export type NewsTemporalEnvelopeV1 = Readonly<{
  firstSeenAt: string;
  ingestedAt: string;
  asKnownAt: string;
  asOf: string;
  revisionId: string;
}>;

/**
 * Market Core's DataEnvelope and NewsEnvelope deliberately have different
 * ordering rules. This adapter validates each side independently and never
 * casts one envelope into the other.
 */
export function validateMarketTemporalV1(value: MarketTemporalEnvelopeV1): MarketTemporalEnvelopeV1 {
  const first = Date.parse(value.firstSeenAt), ingested = Date.parse(value.ingestedAt), known = Date.parse(value.asKnownAt);
  if (!value.revisionId || !Number.isFinite(first) || !Number.isFinite(ingested) || !Number.isFinite(known) || first > ingested || known > ingested) throw new Error("MARKET_TEMPORAL_CONTRACT_INVALID");
  return value;
}

export function validateNewsTemporalV1(value: NewsTemporalEnvelopeV1): NewsTemporalEnvelopeV1 {
  const first = Date.parse(value.firstSeenAt), ingested = Date.parse(value.ingestedAt), known = Date.parse(value.asKnownAt), asOf = Date.parse(value.asOf);
  if (!value.revisionId || !Number.isFinite(first) || !Number.isFinite(ingested) || !Number.isFinite(known) || !Number.isFinite(asOf) || first > ingested || ingested > known) throw new Error("NEWS_TEMPORAL_CONTRACT_INVALID");
  return value;
}

export function assertMarketNewsBoundaryV1(market: MarketTemporalEnvelopeV1, news: NewsTemporalEnvelopeV1): void {
  validateMarketTemporalV1(market);
  validateNewsTemporalV1(news);
  if (Date.parse(news.asOf) > Date.parse(news.asKnownAt)) throw new Error("NEWS_TEMPORAL_LOOKAHEAD");
  if (market.revisionId === news.revisionId) throw new Error("MARKET_NEWS_REVISION_NAMESPACE_COLLISION");
}

function utc(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 19) === value.slice(0, 19);
}

/** Validate the actual Market Core envelope shape before crossing into News. */
export function validateMarketDataEnvelopeV1(value: unknown): MarketDataEnvelopeV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("MARKET_DATA_ENVELOPE_INVALID");
  const x = value as Record<string, unknown>;
  const statuses = ["AVAILABLE", "STALE", "PARTIAL", "UNAVAILABLE", "LICENSE_BLOCKED", "AMBIGUOUS"];
  const quality = x.quality as Record<string, unknown> | null;
  const rights = x.rights as Record<string, unknown> | null;
  const sourceRefs = x.sourceRefs;
  if (!statuses.includes(String(x.status)) || !utc(x.firstSeenAt) || !utc(x.ingestedAt) || !utc(x.asKnownAt) ||
      Date.parse(x.firstSeenAt as string) > Date.parse(x.ingestedAt as string) || Date.parse(x.asKnownAt as string) > Date.parse(x.ingestedAt as string) ||
      typeof x.revisionId !== "string" || x.revisionId.length === 0 || typeof x.schemaVersion !== "string" || !/^\d+\.\d+$/.test(x.schemaVersion) ||
      !Array.isArray(sourceRefs) || sourceRefs.length === 0 || !sourceRefs.every(ref => {
        if (typeof ref !== "object" || ref === null) return false;
        const r = ref as Record<string, unknown>;
        return typeof r.provider === "string" && r.provider.length > 0 && typeof r.originalSourceId === "string" && r.originalSourceId.length > 0 &&
          (r.requestId === null || typeof r.requestId === "string") && (r.sourceDocumentUri === null || typeof r.sourceDocumentUri === "string");
      }) || !quality || !Array.isArray(quality.flags) || !quality.flags.every(flag => typeof flag === "string") ||
      !["FULL", "PARTIAL", "NONE"].includes(String(quality.coverage)) || !rights || typeof rights.policyId !== "string" || rights.policyId.length === 0 ||
      typeof rights.display !== "boolean" || (rights.retentionUntil !== null && !utc(rights.retentionUntil))) throw new Error("MARKET_DATA_ENVELOPE_INVALID");
  if (x.status === "AVAILABLE" && quality.coverage !== "FULL") throw new Error("MARKET_DATA_ENVELOPE_INVALID");
  if (x.status === "UNAVAILABLE" && "value" in x) throw new Error("MARKET_DATA_ENVELOPE_INVALID");
  return value as MarketDataEnvelopeV1;
}

/**
 * Cross-engine read-only adapter. Market and News keep their own timestamp
 * semantics; only the common historical cutoff is shared.
 */
export function assertMarketDataCompatibleWithNewsV1(
  market: unknown,
  news: NewsEnvelope<unknown>,
  cutoff: string,
): { market: MarketDataEnvelopeV1; news: NewsEnvelope<unknown>; asOf: string } {
  const checkedMarket = validateMarketDataEnvelopeV1(market);
  if (!utc(cutoff) || !utc(news.asOf) || !utc(news.servedAt) || Date.parse(news.asOf) > Date.parse(cutoff) ||
      Date.parse(checkedMarket.asKnownAt) > Date.parse(cutoff) || Date.parse(news.servedAt) < Date.parse(news.asOf) ||
      checkedMarket.revisionId === news.requestId) throw new Error("MARKET_NEWS_TEMPORAL_INCOMPATIBLE");
  if (news.status === "AVAILABLE" && !Array.isArray(news.data)) throw new Error("MARKET_NEWS_TEMPORAL_INCOMPATIBLE");
  return { market: checkedMarket, news, asOf: cutoff };
}
