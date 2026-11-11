export type NewsPublication = Readonly<{
  publicationId: string;
  sourceId: string;
  originFingerprint: string;
  externalId: string;
  originalUrl: string;
  title: string;
  publishedAt: string | null;
  firstSeenAt: string;
  ingestedAt: string;
  asKnownAt: string;
  form: string;
}>;

export type NewsProviderObservation = Readonly<{
  observationId: string;
  providerKey: string;
  providerObservationKey: string;
  publicationId: string;
  observedAt: string;
  retrievedAt: string;
  publisherKey: string;
}>;

export type NewsCheckpoint = Readonly<{
  sourceId: string;
  cursor: string | null;
  updatedAt: string;
}>;

export type NewsBatch = Readonly<{
  publications: readonly NewsPublication[];
  observations: readonly NewsProviderObservation[];
  checkpoint: NewsCheckpoint;
}>;

export function assertNewsPublication(value: unknown): asserts value is NewsPublication {
  if (!value || typeof value !== "object") throw new Error("INVALID_NEWS_PUBLICATION");
  const x = value as Record<string, unknown>;
  for (const key of ["publicationId", "sourceId", "originFingerprint", "externalId", "originalUrl", "title", "firstSeenAt", "ingestedAt", "asKnownAt", "form"]) {
    if (typeof x[key] !== "string" || x[key] === "") throw new Error("INVALID_NEWS_PUBLICATION");
  }
  if (x.publishedAt !== null && typeof x.publishedAt !== "string") throw new Error("INVALID_NEWS_PUBLICATION");
  const first = Date.parse(x.firstSeenAt as string), ingested = Date.parse(x.ingestedAt as string), known = Date.parse(x.asKnownAt as string);
  if (![first, ingested, known].every(Number.isFinite) || first > ingested || ingested > known) throw new Error("INVALID_NEWS_PUBLICATION");
  if (x.publishedAt !== null && !Number.isFinite(Date.parse(x.publishedAt as string))) throw new Error("INVALID_NEWS_PUBLICATION");
}
