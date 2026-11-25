import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import type { NewsPublicationRevision } from "./contracts";
import { NewsConsumptionApiV1 } from "./n5Api";
import { PostgresNewsStore } from "./postgresStore";

export type SiteNewsRecordV1 = Readonly<{
  sourceId: string;
  publicationId: string;
  publicationRevisionId: string;
  title: string;
  originalUrl: string;
  publishedAt: string | null;
  asKnownAt: string | null;
  ingestedAt: string | null;
  qualityFlags: readonly string[];
}>;

/** Separate, server-only N5 presentation mapping. Never expose SQL credentials or article text. */
export function mapNewsN5ForSite(rows: readonly NewsPublicationRevision[], allowedIds: readonly string[]): readonly SiteNewsRecordV1[] {
  const allowed = new Set(allowedIds);
  const result: SiteNewsRecordV1[] = [];
  for (const row of rows) {
    if (!row.sourceId || !allowed.has(row.sourceId) || !row.title || !row.publicationId || !row.publicationRevisionId) continue;
    let link: URL;
    try { link = new URL(row.sourceDocumentRef); }
    catch { continue; }
    if (link.protocol !== "https:" || !link.hostname || link.username || link.password || link.port || link.hash) continue;
    if (link.hostname === "localhost" || link.hostname.endsWith(".local") || link.hostname.includes(":") ||
        /^\d{1,3}(?:\.\d{1,3}){3}$/.test(link.hostname)) continue;
    result.push(Object.freeze({
      sourceId: row.sourceId,
      publicationId: row.publicationId,
      publicationRevisionId: row.publicationRevisionId,
      title: row.title,
      originalUrl: link.toString(),
      publishedAt: row.publishedAt,
      asKnownAt: row.asKnownAt,
      ingestedAt: row.ingestedAt,
      qualityFlags: Object.freeze([...row.qualityFlags]),
    }));
  }
  return Object.freeze(result);
}

export type SiteNewsN5Config = Readonly<{
  connectionString: string;
  tlsCaPem: string;
  sourceIds: readonly string[];
}>;

/**
 * Fail-closed, least-privilege N5 read. Call only after Clerk authentication.
 * The connection login must have SET ROLE news_reader; admin/service credentials
 * are never accepted by this API and must not be used for site rendering.
 */
export async function readNewsN5ForSite(config: SiteNewsN5Config): Promise<readonly SiteNewsRecordV1[]> {
  const { connectionString, tlsCaPem, sourceIds } = config;
  if (!connectionString || !tlsCaPem.includes("BEGIN CERTIFICATE") || !tlsCaPem.includes("END CERTIFICATE")) {
    throw new Error("NEWS_SITE_N5_NOT_CONFIGURED");
  }
  let url: URL;
  try { url = new URL(connectionString); } catch { throw new Error("NEWS_SITE_N5_DB_CONFIG_INVALID"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.password ||
      url.searchParams.has("options") || url.searchParams.has("sslmode") ||
      url.searchParams.has("sslcert") || url.searchParams.has("sslkey") || url.searchParams.has("sslrootcert")) {
    throw new Error("NEWS_SITE_N5_DB_CONFIG_INVALID");
  }
  url.searchParams.set("options", "-c role=news_reader");
  const pool = new Pool({
    connectionString: url.toString(),
    ssl: { ca: tlsCaPem, rejectUnauthorized: true },
    max: 2, connectionTimeoutMillis: 6000, idleTimeoutMillis: 4000,
    statement_timeout: 9000, application_name: "syntrake-news-site-reader",
  });
  try {
    const role = await pool.query<{ role_name: string }>("select current_user as role_name");
    if (role.rows[0]?.role_name !== "news_reader") throw new Error("NEWS_SITE_N5_READER_ROLE_REQUIRED");
    const secret = randomBytes(24).toString("hex");
    const n5 = new NewsConsumptionApiV1(
      { news: new PostgresNewsStore(pool), factual: {} as never },
      randomBytes(32).toString("hex"), secret,
    );
    const result = await n5.discoverNews({ serviceId: "news_reader", credential: secret }, {
      sort: "RECENT", limit: 100, filters: { sourceIds: [...new Set(sourceIds)] },
    });
    if (result.status !== "AVAILABLE") throw new Error("NEWS_SITE_N5_UNAVAILABLE");
    return mapNewsN5ForSite(result.data, sourceIds);
  } catch {
    throw new Error("NEWS_SITE_N5_UNAVAILABLE");
  } finally {
    await pool.end();
  }
}
