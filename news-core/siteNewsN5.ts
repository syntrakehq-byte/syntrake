import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import type { NewsPublicationRevision } from "./contracts";
import { NewsConsumptionApiV1 } from "./n5Api";
import { PostgresNewsStore } from "./postgresStore";
import { normalizeNewsTlsCaPem } from "./databaseTls";

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


export type NewsSiteReaderIdentityV1 = Readonly<{
  role_name: string;
  login_name: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  has_writer_membership: boolean;
}>;

/** Reject admin and writer logins even if they temporarily assume news_reader. */
export function assertNewsSiteReadRole(identity: NewsSiteReaderIdentityV1 | undefined): void {
  if (!identity ||
      identity.role_name !== "news_reader" ||
      !identity.login_name ||
      identity.login_name === "news_reader" ||
      identity.rolsuper || identity.rolbypassrls || identity.rolcreaterole ||
      identity.rolcreatedb || identity.has_writer_membership) {
    throw new Error("NEWS_SITE_N5_READER_ROLE_REQUIRED");
  }
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
  const { connectionString, sourceIds } = config;
  const tlsCaPem = normalizeNewsTlsCaPem(config.tlsCaPem);
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
  let stage = "CONNECT_AND_IDENTITY";
  try {
    const identity = await pool.query<NewsSiteReaderIdentityV1>(
      "select current_user as role_name, session_user as login_name, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, " +
      "coalesce((select bool_or(pg_has_role(r.rolname, p.rolname, 'MEMBER')) from pg_roles p " +
      "where p.rolname in ('news_service', 'news_pipeline_verifier', 'news_factual_attestor', 'news_factual_writer')),false) as has_writer_membership " +
      "from pg_roles r where r.rolname=session_user",
    );
    stage = "IDENTITY_VALIDATION";
    assertNewsSiteReadRole(identity.rows[0]);
    stage = "N5_READ";
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
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    // Never log a connection string, username, credential or raw error message.
    const safeCode = typeof code === "string" && /^[A-Z0-9_]{3,48}$/.test(code) ? code : "UNAVAILABLE";
    console.error("[NEWS_SITE_N5]", { stage, code: safeCode });
    throw new Error("NEWS_SITE_N5_UNAVAILABLE");
  } finally {
    await pool.end();
  }
}
