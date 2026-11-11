export type NewsPublication = Readonly<{
  publicationId: string; sourceId: string; originFingerprint: string; externalId: string;
  originalUrl: string; title: string; publishedAt: string | null; firstSeenAt: string;
  ingestedAt: string | null; asKnownAt: string | null; form: string;
}>;
export type NewsProviderObservation = Readonly<{
  observationId: string; providerKey: string; providerObservationKey: string; publicationId: string;
  observedAt: string; retrievedAt: string; publisherKey: string;
}>;
export type NewsCheckpoint = Readonly<{ sourceId: string; collectionScopeKey: string; cursor: string | null; updatedAt: string }>;
export type NewsBatch = Readonly<{ publications: readonly NewsPublication[]; observations: readonly NewsProviderObservation[]; checkpoint: NewsCheckpoint }>;
export type NewsPublicationRevision = Readonly<{
  publicationRevisionId: string; publicationId: string; revisionNo: number; title: string;
  publishedAt: string | null; form: string; contentFingerprint: string | null;
  sourceDocumentRef: string; qualityFlags: readonly string[]; supersedesRevisionId: string | null;
  ingestedAt: string | null; asKnownAt: string | null;
}>;
export type NewsRevisionProvenance = Readonly<{
  provenanceId: string; publicationRevisionId: string; sourceId: string; providerKey: string;
  providerObservationKey: string | null; originalUrl: string | null; sourceDocumentRef: string;
  retrievedAt: string; qualityFlags: readonly string[];
}>;
const iso = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
export function assertNewsPublication(value: unknown): asserts value is NewsPublication {
  if (!value || typeof value !== "object") throw new Error("INVALID_NEWS_PUBLICATION");
  const x = value as Record<string, unknown>;
  for (const key of ["publicationId", "sourceId", "originFingerprint", "externalId", "originalUrl", "title", "firstSeenAt", "form"]) if (typeof x[key] !== "string" || x[key] === "") throw new Error("INVALID_NEWS_PUBLICATION");
  if (x.publishedAt !== null && (typeof x.publishedAt !== "string" || !iso(x.publishedAt))) throw new Error("INVALID_NEWS_PUBLICATION");
  const first = Date.parse(x.firstSeenAt as string);
  if (!Number.isFinite(first) || (x.ingestedAt !== null && (typeof x.ingestedAt !== "string" || !iso(x.ingestedAt))) || (x.asKnownAt !== null && (typeof x.asKnownAt !== "string" || !iso(x.asKnownAt)))) throw new Error("INVALID_NEWS_PUBLICATION");
  if (x.ingestedAt !== null && x.asKnownAt !== null && (first > Date.parse(x.ingestedAt as string) || Date.parse(x.ingestedAt as string) > Date.parse(x.asKnownAt as string))) throw new Error("INVALID_NEWS_PUBLICATION");
  if (!/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//.test(x.originalUrl as string)) throw new Error("INVALID_NEWS_PUBLICATION");
}
export function assertNewsObservation(value: unknown): asserts value is NewsProviderObservation {
  if (!value || typeof value !== "object") throw new Error("INVALID_NEWS_OBSERVATION");
  const x = value as Record<string, unknown>;
  for (const key of ["observationId", "providerKey", "providerObservationKey", "publicationId", "observedAt", "retrievedAt", "publisherKey"]) if (typeof x[key] !== "string" || x[key] === "") throw new Error("INVALID_NEWS_OBSERVATION");
  if (!iso(x.observedAt) || !iso(x.retrievedAt)) throw new Error("INVALID_NEWS_OBSERVATION");
}
export function assertNewsCheckpoint(value: unknown): asserts value is NewsCheckpoint {
  if (!value || typeof value !== "object") throw new Error("INVALID_NEWS_CHECKPOINT");
  const x = value as Record<string, unknown>;
  if (x.sourceId !== "sec-edgar" || typeof x.collectionScopeKey !== "string" || !x.collectionScopeKey || (x.cursor !== null && typeof x.cursor !== "string") || !iso(x.updatedAt)) throw new Error("INVALID_NEWS_CHECKPOINT");
}
