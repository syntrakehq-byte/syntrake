import { createHmac, timingSafeEqual } from "node:crypto";
import type { NewsPublicationRevision } from "./contracts";
import type { FactAsOfRowV1, FactEvidenceAsOfRowV1, PostgresFactualStore } from "./factualPersistence";
import type { PostgresNewsStore } from "./postgresStore";
import { NewsObservabilityV1 } from "./observability";

export type NewsServiceAuthV1 = Readonly<{ serviceId: "news_reader" | "news_service"; credential: string }>;
export type NewsEnvelope<T> = Readonly<{ schemaVersion: "news-envelope-v1"; status: "AVAILABLE" | "EMPTY" | "UNAVAILABLE"; asOf: string; servedAt: string; data: readonly T[]; sourceRefs: readonly string[]; qualityFlags: readonly string[]; nextCursor: string | null }>;
export type NewsPageInput = Readonly<{ asOf?: string; limit?: number; cursor?: string | null }>;
export type NewsApiDataSource = Readonly<{
  readPublicationRevisionsAsOf(asOf: string): Promise<NewsPublicationRevision[]>;
  readAsOf(asOf: string): Promise<FactAsOfRowV1[]>;
  readHistoryAsOf(asOf: string, factEventId: string): Promise<FactAsOfRowV1[]>;
  readEvidenceAsOf(asOf: string, factRevisionId: string): Promise<FactEvidenceAsOfRowV1[]>;
}>;
type Cursor = Readonly<{ v: 1; operation: string; asOf: string; offset: number; limit: number; filter: string | null }>;

const json = (value: unknown): string => JSON.stringify(value);
const parseIso = (value: string): string => { const time = Date.parse(value); if (!Number.isFinite(time)) throw new Error("NEWS_N5_INVALID_CUTOFF"); return new Date(time).toISOString(); };
const encode = (value: string): string => Buffer.from(value, "utf8").toString("base64url");
const decode = (value: string): string => Buffer.from(value, "base64url").toString("utf8");

export class NewsConsumptionApiV1 {
  readonly observability: NewsObservabilityV1;
  constructor(private readonly source: NewsApiDataSource | { news: PostgresNewsStore; factual: PostgresFactualStore }, private readonly cursorSecret: string, private readonly expectedCredential: string, observability = new NewsObservabilityV1()) {
    if (cursorSecret.length < 16 || expectedCredential.length < 8) throw new Error("NEWS_N5_AUTH_CONFIGURATION_INVALID");
    this.observability = observability;
  }
  private auth(auth: NewsServiceAuthV1): void { if (!auth || !["news_reader", "news_service"].includes(auth.serviceId) || auth.credential !== this.expectedCredential) throw new Error("NEWS_N5_SERVICE_AUTH_REQUIRED"); }
  private data(): NewsApiDataSource { const source = this.source as NewsApiDataSource; if ("readAsOf" in source) return source; const stores = this.source as { news: PostgresNewsStore; factual: PostgresFactualStore }; return { readPublicationRevisionsAsOf: (asOf) => stores.news.readPublicationRevisionsAsOf(asOf), readAsOf: (asOf) => stores.factual.readAsOf(asOf), readHistoryAsOf: (asOf, id) => stores.factual.readHistoryAsOf(asOf, id), readEvidenceAsOf: (asOf, id) => stores.factual.readEvidenceAsOf(asOf, id) }; }
  private page(operation: string, input: NewsPageInput, filter: string | null): { asOf: string; limit: number; offset: number } {
    const served = Date.now(); const limit = input.limit ?? 50; if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("NEWS_N5_LIMIT_INVALID");
    let offset = 0; let cursorAsOf: string | null = null;
    if (input.cursor) { const [body, signature] = input.cursor.split("."); if (!body || !signature) throw new Error("NEWS_N5_CURSOR_INVALID"); const expected = createHmac("sha256", this.cursorSecret).update(body).digest("base64url"); const a = Buffer.from(signature); const b = Buffer.from(expected); if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("NEWS_N5_CURSOR_INVALID"); let cursor: Cursor; try { cursor = JSON.parse(decode(body)) as Cursor; } catch { throw new Error("NEWS_N5_CURSOR_INVALID"); } if (cursor.v !== 1 || cursor.operation !== operation || cursor.limit !== limit || cursor.filter !== filter || !Number.isInteger(cursor.offset) || cursor.offset < 0) throw new Error("NEWS_N5_CURSOR_INVALID"); offset = cursor.offset; cursorAsOf = cursor.asOf; }
    const asOf = parseIso(input.asOf ?? cursorAsOf ?? new Date(served).toISOString()); if (Date.parse(asOf) > served) throw new Error("NEWS_N5_FUTURE_CUTOFF");
    if (cursorAsOf && cursorAsOf !== asOf) throw new Error("NEWS_N5_CURSOR_INVALID");
    return { asOf, limit, offset };
  }
  private cursor(operation: string, asOf: string, offset: number, limit: number, filter: string | null): string { const body = encode(json({ v: 1, operation, asOf, offset, limit, filter } satisfies Cursor)); return `${body}.${createHmac("sha256", this.cursorSecret).update(body).digest("base64url")}`; }
  private envelope<T>(asOf: string, rows: readonly T[], sourceRefs: readonly string[], nextCursor: string | null, flags: readonly string[] = []): NewsEnvelope<T> { return { schemaVersion: "news-envelope-v1", status: rows.length ? "AVAILABLE" : "EMPTY", asOf, servedAt: new Date().toISOString(), data: rows, sourceRefs, qualityFlags: rows.length ? flags : [...flags, "NO_RESULTS"], nextCursor }; }
  private async run<T>(operation: string, auth: NewsServiceAuthV1, input: NewsPageInput, filter: string | null, read: (asOf: string) => Promise<readonly T[]>, refs: (row: T) => string[]): Promise<NewsEnvelope<T>> { this.auth(auth); const page = this.page(operation, input, filter); try { const all = await read(page.asOf); const rows = all.slice(page.offset, page.offset + page.limit); const next = page.offset + page.limit < all.length ? this.cursor(operation, page.asOf, page.offset + page.limit, page.limit, filter) : null; this.observability.markSuccess(); return this.envelope(page.asOf, rows, [...new Set(rows.flatMap(refs))], next); } catch (error) { this.observability.recordError(error); return { schemaVersion: "news-envelope-v1", status: "UNAVAILABLE", asOf: page.asOf, servedAt: new Date().toISOString(), data: [], sourceRefs: [], qualityFlags: ["READ_UNAVAILABLE"], nextCursor: null }; } }
  discoverNews(auth: NewsServiceAuthV1, input: NewsPageInput = {}): Promise<NewsEnvelope<NewsPublicationRevision>> { return this.run("discoverNews", auth, input, null, (asOf) => this.data().readPublicationRevisionsAsOf(asOf), row => [row.sourceDocumentRef]); }
  getNewsEvents(auth: NewsServiceAuthV1, input: NewsPageInput = {}): Promise<NewsEnvelope<FactAsOfRowV1>> { return this.run("getNewsEvents", auth, input, null, (asOf) => this.data().readAsOf(asOf), row => [row.factRevisionId]); }
  getEventEvidence(auth: NewsServiceAuthV1, factRevisionId: string, input: NewsPageInput = {}): Promise<NewsEnvelope<FactEvidenceAsOfRowV1>> { if (!factRevisionId) throw new Error("NEWS_N5_EVENT_REQUIRED"); return this.run("getEventEvidence", auth, input, factRevisionId, (asOf) => this.data().readEvidenceAsOf(asOf, factRevisionId), row => [row.sourceDocumentRef, row.provenanceRef]); }
  getNewsHistory(auth: NewsServiceAuthV1, factEventId: string, input: NewsPageInput = {}): Promise<NewsEnvelope<FactAsOfRowV1>> { if (!factEventId) throw new Error("NEWS_N5_EVENT_REQUIRED"); return this.run("getNewsHistory", auth, input, factEventId, (asOf) => this.data().readHistoryAsOf(asOf, factEventId), row => [row.factRevisionId]); }
}

