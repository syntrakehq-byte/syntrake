import { createHash } from "node:crypto";
import type { GlobalNewsItem } from "./globalNewsAdapter";
import type { GlobalNewsRegistryEntry } from "./globalNewsRegistry";
import type { NewsBatch } from "./contracts";

function stable(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export function globalProviderKey(sourceType: GlobalNewsRegistryEntry["sourceType"]): string { return `global-${sourceType.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`; }

/** Converts a normalized N-G2 batch to the existing transactional N1 shape. */
export function globalItemsToNewsBatch(source: GlobalNewsRegistryEntry, items: readonly GlobalNewsItem[], updatedAt = new Date().toISOString()): NewsBatch {
  const providerKey = globalProviderKey(source.sourceType);
  const ordered = [...items].sort((left, right) => left.externalId.localeCompare(right.externalId));
  const publications = ordered.map(item => ({
    publicationId: item.publicationId, sourceId: item.sourceId, originFingerprint: item.contentFingerprint,
    externalId: item.externalId, originalUrl: item.originalUrl, title: item.title, publishedAt: item.publishedAt,
    firstSeenAt: item.retrievedAt, ingestedAt: null, asKnownAt: null, form: `GLOBAL_${source.sourceType}`,
  }));
  const observations = ordered.map(item => ({
    observationId: stable(`${source.sourceId}:observation:${item.externalId}`).slice(0, 40), providerKey,
    providerObservationKey: `${source.sourceId}:${item.externalId}`, publicationId: item.publicationId,
    observedAt: item.retrievedAt, retrievedAt: item.retrievedAt, publisherKey: source.publisherId,
  }));
  const watermark = ordered.reduce<string | null>((latest, item) => {
    const candidate = item.publishedAt ?? item.retrievedAt;
    return !latest || Date.parse(candidate) > Date.parse(latest) ? candidate : latest;
  }, null);
  return { publications, observations, checkpoint: {
    sourceId: source.sourceId, collectionScopeKey: source.checkpointScope,
    cursor: JSON.stringify({ version: 1, sourceId: source.sourceId, externalIds: ordered.map(item => item.externalId), watermark }),
    updatedAt,
  } };
}
