import type { NewsEnvelope } from "./n5Api";

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
