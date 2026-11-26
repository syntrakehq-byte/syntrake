import { readNewsN5ForSite } from "../news-core/siteNewsN5";
import { NEWS_OFFICIAL_PLUS_DAILY_NEWS_V1 } from "../news-core/globalNewsOfficialSources";

// Read-only deployment gate for the existing N5-enabled Preview.
// No database access occurs in local builds, ordinary CI, or production.
async function main(): Promise<void> {
  if (process.env.VERCEL_ENV !== "preview" || process.env.NEWS_SITE_READ_MODE !== "N5") return;
  const rows = await readNewsN5ForSite({
    connectionString: process.env.NEWS_READER_DATABASE_URL ?? "",
    tlsCaPem: process.env.NEWS_READER_CA_PEM ?? "",
    sourceIds: NEWS_OFFICIAL_PLUS_DAILY_NEWS_V1.map(source => source.sourceId),
  });
  if (!rows.length) throw new Error("NEWS_PREVIEW_N5_EMPTY");
  // Only aggregate counts; never print credentials, URLs or publication text.
  console.log("NEWS_PREVIEW_N5_READ_PASS", { publications: rows.length, sourcesWithResults: new Set(rows.map(row => row.sourceId)).size });
}
main().catch(() => {
  console.error("NEWS_PREVIEW_N5_READ_FAILED");
  process.exitCode = 1;
});
