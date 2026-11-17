import type { NewsPublicationRevision } from "./contracts";
import type {
  DiscoverNewsInput,
  EventEvidenceInput,
  NewsConsumptionApiV1,
  NewsEnvelope,
  NewsEventsInput,
  NewsHistoryInput,
  NewsServiceAuthV1,
} from "./n5Api";

export const GLOBAL_NEWS_API_CONTRACT_VERSION = "news-global-v1" as const;

export type NewsRightsModeV1 = "METADATA_ONLY" | "PERMITTED_TEXT";
export type GlobalNewsPublicationV1 = Readonly<{
  publicationRevisionId: string;
  publicationId: string;
  revisionNo: number;
  title: string;
  publishedAt: string | null;
  form: string;
  sourceDocumentRef: string;
  contentExcerpt: string | null;
  rightsMode: NewsRightsModeV1;
  qualityFlags: readonly string[];
  ingestedAt: string | null;
  asKnownAt: string | null;
  supersedesRevisionId: string | null;
}>;

export type GlobalNewsFiltersV1 = Readonly<{
  sourceIds?: readonly string[];
  forms?: readonly string[];
  /** Entity/instrument filters are applied only when an exact persisted link is available. */
  entityIds?: readonly string[];
  instrumentIds?: readonly string[];
  sectors?: readonly string[];
  countries?: readonly string[];
  categories?: readonly string[];
}>;

export type GlobalNewsSearchInputV1 = Readonly<DiscoverNewsInput & { filters?: GlobalNewsFiltersV1 }>;
export type GlobalNewsEnvelopeV1<T> = Readonly<{
  contractVersion: typeof GLOBAL_NEWS_API_CONTRACT_VERSION;
  news: NewsEnvelope<T>;
  coverage: "FULL" | "PARTIAL" | "NONE";
}>;

type RelationReader = (asOf: string, publicationId?: string) => Promise<readonly Record<string, unknown>[]>;
function publication(row: NewsPublicationRevision): GlobalNewsPublicationV1 {
  const flags = [...(row.qualityFlags ?? [])];
  const permitted = flags.includes("RIGHTS_PERMITTED_TEXT");
  return {
    publicationRevisionId: row.publicationRevisionId,
    publicationId: row.publicationId,
    revisionNo: row.revisionNo,
    title: row.title,
    publishedAt: row.publishedAt,
    form: row.form,
    sourceDocumentRef: row.sourceDocumentRef,
    contentExcerpt: permitted ? (row.contentExcerpt ?? null) : null,
    rightsMode: permitted ? "PERMITTED_TEXT" : "METADATA_ONLY",
    qualityFlags: flags,
    ingestedAt: row.ingestedAt,
    asKnownAt: row.asKnownAt,
    supersedesRevisionId: row.supersedesRevisionId,
  };
}

function exactRelationMatches(row: Record<string, unknown>, filters: GlobalNewsFiltersV1): boolean {
  if (row.identityStatus !== "EXACT") return false;
  const requested = new Set([...(filters.entityIds ?? []), ...(filters.instrumentIds ?? [])]);
  if (requested.size === 0) return true;
  return [...requested].some(value => [row.issuerId, row.instrumentId, row.listingId].includes(value));
}

/**
 * Global read boundary. It deliberately delegates storage, PIT and cursor
 * validation to the approved N5 API; this class only adds the global contract
 * and conservative rights/entity presentation.
 */
export class GlobalNewsApiV1 {
  constructor(private readonly n5: NewsConsumptionApiV1, private readonly relations?: RelationReader) {}

  private wrap<T>(news: NewsEnvelope<T>, coverage: "FULL" | "PARTIAL" | "NONE" = "FULL"): GlobalNewsEnvelopeV1<T> {
    return { contractVersion: GLOBAL_NEWS_API_CONTRACT_VERSION, news, coverage };
  }

  async search(auth: NewsServiceAuthV1, input: GlobalNewsSearchInputV1 = {}): Promise<GlobalNewsEnvelopeV1<GlobalNewsPublicationV1>> {
    const filters = input.filters ?? {};
    const unsupported = [...(filters.sectors ?? []), ...(filters.countries ?? []), ...(filters.categories ?? [])];
    if (unsupported.length > 0) throw new Error("NEWS_GLOBAL_FILTER_NOT_PROVEN");
    const result = await this.n5.discoverNews(auth, { ...input, filters: { sourceIds: filters.sourceIds, forms: filters.forms } });
    let rows = result.data.map(publication);
    let coverage: "FULL" | "PARTIAL" | "NONE" = "FULL";
    const relationIds = [...(filters.entityIds ?? []), ...(filters.instrumentIds ?? [])];
    if (relationIds.length > 0) {
      if (!this.relations) throw new Error("NEWS_GLOBAL_ENTITY_FILTER_NOT_AVAILABLE");
      const matched: GlobalNewsPublicationV1[] = [];
      for (const row of rows) {
        const links = await this.relations(result.asOf, row.publicationId);
        if (links.some(link => exactRelationMatches(link, filters))) matched.push(row);
      }
      rows = matched;
    }
    if (result.status !== "AVAILABLE") coverage = "NONE";
    else if (result.qualityFlags.length > 0) coverage = "PARTIAL";
    return this.wrap({ ...result, data: rows }, coverage);
  }

  recent(auth: NewsServiceAuthV1, input: Omit<GlobalNewsSearchInputV1, "asOf"> = {}): Promise<GlobalNewsEnvelopeV1<GlobalNewsPublicationV1>> {
    return this.search(auth, { ...input, asOf: new Date().toISOString() });
  }

  history(auth: NewsServiceAuthV1, input: NewsHistoryInput): Promise<GlobalNewsEnvelopeV1<unknown>> {
    return this.n5.getNewsHistory(auth, input).then(news => this.wrap(news));
  }

  events(auth: NewsServiceAuthV1, input: NewsEventsInput = {}): Promise<GlobalNewsEnvelopeV1<unknown>> {
    return this.n5.getNewsEvents(auth, input).then(news => this.wrap(news));
  }

  evidence(auth: NewsServiceAuthV1, input: EventEvidenceInput): Promise<GlobalNewsEnvelopeV1<unknown>> {
    return this.n5.getEventEvidence(auth, input).then(news => this.wrap(news));
  }

  /** Cursor-based at-least-once consumption; replaying a cursor is idempotent at the read boundary. */
  consume(auth: NewsServiceAuthV1, input: GlobalNewsSearchInputV1): Promise<GlobalNewsEnvelopeV1<GlobalNewsPublicationV1>> {
    return this.search(auth, input);
  }
}
