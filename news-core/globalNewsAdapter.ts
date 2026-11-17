import { createHash } from "node:crypto";
import { normalizeNewsTextV1 } from "./textNormalization";

/**
 * Neutral, source-agnostic normalized news item.
 * No database writes, external HTTP or financial interpretation.
 * A source must be registered explicitly before accepting a feed payload.
 */
export type GlobalNewsSource = Readonly<{
  sourceId: string;
  publisher: string;
  feedUrl: string;
  allowedArticleHosts: readonly string[];
  format: "JSON_FEED_V1";
  rightsPolicyId: string;
}>;

export type GlobalNewsItem = Readonly<{
  sourceId: string;
  providerKey: "json-feed" | "rss" | "atom";
  externalId: string;
  publicationId: string;
  originalUrl: string;
  title: string;
  summary: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  retrievedAt: string;
  publisher: string;
  rightsPolicyId: string;
  contentFingerprint: string;
  qualityFlags: readonly string[];
}>;

const idPattern = /^[a-z0-9][a-z0-9._:-]{1,100}$/;
const fingerprint = (s: string) => createHash("sha256").update(s).digest("hex");
const safeString = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v) ? v.trim() : null;

function httpsUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("GLOBAL_NEWS_URL_INVALID"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || !url.hostname || /\.$/.test(url.hostname)) throw new Error("GLOBAL_NEWS_URL_INVALID");
  return url;
}

function timestamp(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)) throw new Error("GLOBAL_NEWS_DATE_INVALID");
  const dt = new Date(v);
  if (Number.isNaN(dt.getTime())) throw new Error("GLOBAL_NEWS_DATE_INVALID");
  return dt.toISOString();
}

export function validateGlobalNewsSource(source: GlobalNewsSource): void {
  if (!source || !idPattern.test(source.sourceId) || !safeString(source.publisher, 200) ||
      !idPattern.test(source.rightsPolicyId) || source.format !== "JSON_FEED_V1" ||
      !Array.isArray(source.allowedArticleHosts) || source.allowedArticleHosts.length === 0 ||
      source.allowedArticleHosts.length > 20) throw new Error("GLOBAL_NEWS_SOURCE_INVALID");
  httpsUrl(source.feedUrl);
  if (new Set(source.allowedArticleHosts).size !== source.allowedArticleHosts.length ||
      source.allowedArticleHosts.some(host => !/^[a-z0-9.-]+$/.test(host) || host !== host.toLowerCase() || host.startsWith(".") || host.endsWith("."))) throw new Error("GLOBAL_NEWS_SOURCE_INVALID");
}

/** Parse JSON Feed 1.x without assuming availability of full article text.
 * Unknown dates are null, not inferred from the polling time.
 * Invalid individual records fail the entire batch so the caller cannot advance a checkpoint silently.
 */
export function parseJsonNewsFeed(source: GlobalNewsSource, payload: unknown, retrievedAt: string, maxItems = 500): readonly GlobalNewsItem[] {
  validateGlobalNewsSource(source);
  const retrieved = timestamp(retrievedAt);
  if (!retrieved || !payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("GLOBAL_NEWS_FEED_INVALID");
  const feed = payload as Record<string, unknown>;
  if (typeof feed.version !== "string" || !/^https:\/\/jsonfeed\.org\/version\/1(?:\.1)?$/.test(feed.version) ||
      !Array.isArray(feed.items) || feed.items.length > maxItems || !Number.isInteger(maxItems) || maxItems < 1 || maxItems > 5000) throw new Error("GLOBAL_NEWS_FEED_INVALID");
  const result: GlobalNewsItem[] = [];
  const seen = new Set<string>();
  for (const raw of feed.items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("GLOBAL_NEWS_ITEM_INVALID");
    const item = raw as Record<string, unknown>;
    const externalId = safeString(item.id, 512), title = safeString(typeof item.title === "string" ? normalizeNewsTextV1(item.title) : item.title, 1500), urlValue = safeString(item.url, 4096);
    if (!externalId || !title || !urlValue) throw new Error("GLOBAL_NEWS_ITEM_INVALID");
    const url = httpsUrl(urlValue);
    if (!source.allowedArticleHosts.includes(url.hostname.toLowerCase())) throw new Error("GLOBAL_NEWS_ARTICLE_HOST_NOT_ALLOWED");
    if (seen.has(externalId)) throw new Error("GLOBAL_NEWS_DUPLICATE_EXTERNAL_ID");
    seen.add(externalId);
    const publishedAt = timestamp(item.date_published), updatedAt = timestamp(item.date_modified);
    if (publishedAt && updatedAt && Date.parse(updatedAt) < Date.parse(publishedAt)) throw new Error("GLOBAL_NEWS_DATE_ORDER_INVALID");
    const summary = item.summary == null ? null : safeString(typeof item.summary === "string" ? normalizeNewsTextV1(item.summary) : item.summary, 4000);
    if (item.summary != null && summary === null) throw new Error("GLOBAL_NEWS_ITEM_INVALID");
    const publicationId = fingerprint(`global-news:${source.sourceId}:${externalId}`).slice(0, 32);
    result.push(Object.freeze({
      sourceId: source.sourceId, providerKey: "json-feed" as const, externalId, publicationId,
      originalUrl: url.toString(), title, summary, publishedAt, updatedAt,
      retrievedAt: retrieved, publisher: source.publisher, rightsPolicyId: source.rightsPolicyId,
      contentFingerprint: fingerprint(JSON.stringify([externalId, url.toString(), title, summary, publishedAt, updatedAt])),
      qualityFlags: Object.freeze(publishedAt ? [] : ["SOURCE_PUBLICATION_DATE_UNKNOWN"]),
    }));
  }
  return Object.freeze(result);
}
