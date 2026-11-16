import { createHash } from "node:crypto";
import type { GlobalNewsItem } from "./globalNewsAdapter";
import { validateGlobalNewsRegistryEntry, type GlobalNewsRegistryEntry } from "./globalNewsRegistry";

const MAX_XML_BYTES = 5 * 1024 * 1024;
const tag = (value: string, name: string): string | null => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = value.match(new RegExp(`<(?:(?:[A-Za-z0-9_.-]+):)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[A-Za-z0-9_.-]+):)?${escaped}>`, "i"));
  return match?.[1]?.trim() || null;
};
const attr = (value: string, name: string): string | null => {
  const match = value.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2]?.trim() || null;
};
function decode(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => String.fromCodePoint(code.toLowerCase().startsWith("x") ? parseInt(code.slice(1), 16) : Number(code))).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function text(value: string | null): string | null { if (!value) return null; const clean = decode(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); return clean || null; }
function iso(value: string | null): string | null { if (!value) return null; const date = new Date(value); return Number.isFinite(date.valueOf()) ? date.toISOString() : null; }
function url(value: string | null): string | null { if (!value) return null; try { const parsed = new URL(decode(value)); return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.hash && !parsed.port ? parsed.toString() : null; } catch { return null; } }
function fingerprint(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function validateXml(raw: string): void {
  if (Buffer.byteLength(raw, "utf8") > MAX_XML_BYTES || /<!DOCTYPE|<!ENTITY|SYSTEM\s+["']|PUBLIC\s+["']/i.test(raw) || !/^\s*<\?xml|^\s*</.test(raw)) throw new Error("GLOBAL_NEWS_XML_INVALID");
}
function itemFromFields(source: GlobalNewsRegistryEntry, providerKey: "rss" | "atom", fields: { id: string | null; link: string | null; title: string | null; summary: string | null; publishedAt: string | null; updatedAt: string | null }): GlobalNewsItem {
  const id = text(fields.id) || fields.link;
  const articleUrl = url(fields.link);
  const title = text(fields.title);
  if (!id || !articleUrl || !title || !source.allowedArticleHosts.includes(new URL(articleUrl).hostname)) throw new Error("GLOBAL_NEWS_ITEM_INVALID");
  const publishedAt = iso(text(fields.publishedAt));
  const updatedAt = iso(text(fields.updatedAt));
  if (text(fields.publishedAt) && !publishedAt || text(fields.updatedAt) && !updatedAt || publishedAt && updatedAt && Date.parse(updatedAt) < Date.parse(publishedAt)) throw new Error("GLOBAL_NEWS_DATE_INVALID");
  const summary = text(fields.summary);
  const externalId = id.slice(0, 512);
  return Object.freeze({ sourceId: source.sourceId, providerKey, externalId, publicationId: fingerprint(`global-news:${source.sourceId}:${externalId}`).slice(0, 32), originalUrl: articleUrl, title, summary: summary?.slice(0, 4000) ?? null, publishedAt, updatedAt, retrievedAt: "", publisher: source.publisher, rightsPolicyId: source.rightsPolicyId, contentFingerprint: fingerprint(JSON.stringify([externalId, articleUrl, title, summary, publishedAt, updatedAt])), qualityFlags: Object.freeze([...(publishedAt ? [] : ["SOURCE_PUBLICATION_DATE_UNKNOWN"])]) });
}

export function parseRssNewsFeed(source: GlobalNewsRegistryEntry, raw: string, retrievedAt: string, maxItems = 500): readonly GlobalNewsItem[] {
  validateGlobalNewsRegistryEntry(source); validateXml(raw);
  if (source.sourceType !== "RSS_2") throw new Error("GLOBAL_NEWS_FEED_FORMAT_MISMATCH");
  const blocks = [...raw.matchAll(/<(?:(?:[A-Za-z0-9_.-]+):)?item\b[^>]*>([\s\S]*?)<\/(?:(?:[A-Za-z0-9_.-]+):)?item>/gi)].map(match => match[1]);
  if (blocks.length > maxItems) throw new Error("GLOBAL_NEWS_FEED_TOO_LARGE");
  return Object.freeze(blocks.map(block => Object.freeze({ ...itemFromFields(source, "rss", { id: tag(block, "guid"), link: tag(block, "link"), title: tag(block, "title"), summary: tag(block, "description"), publishedAt: tag(block, "pubDate"), updatedAt: tag(block, "lastBuildDate") }), retrievedAt })));
}

export function parseAtomNewsFeed(source: GlobalNewsRegistryEntry, raw: string, retrievedAt: string, maxItems = 500): readonly GlobalNewsItem[] {
  validateGlobalNewsRegistryEntry(source); validateXml(raw);
  if (source.sourceType !== "ATOM") throw new Error("GLOBAL_NEWS_FEED_FORMAT_MISMATCH");
  const blocks = [...raw.matchAll(/<(?:(?:[A-Za-z0-9_.-]+):)?entry\b[^>]*>([\s\S]*?)<\/(?:(?:[A-Za-z0-9_.-]+):)?entry>/gi)].map(match => match[1]);
  if (blocks.length > maxItems) throw new Error("GLOBAL_NEWS_FEED_TOO_LARGE");
  return Object.freeze(blocks.map(block => {
    const links = [...block.matchAll(/<(?:(?:[A-Za-z0-9_.-]+):)?link\b([^>]*)>/gi)].map(match => ({ href: attr(match[1], "href"), rel: attr(match[1], "rel") }));
    const alternate = links.find(link => !link.rel || link.rel === "alternate")?.href ?? links[0]?.href ?? null;
    return Object.freeze({ ...itemFromFields(source, "atom", { id: tag(block, "id"), link: alternate, title: tag(block, "title"), summary: tag(block, "summary") ?? tag(block, "content"), publishedAt: tag(block, "published"), updatedAt: tag(block, "updated") }), retrievedAt });
  }));
}
