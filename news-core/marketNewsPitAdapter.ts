import type { Client } from "pg";

export type JointPitReadV1 = Readonly<{
  cutoff: string;
  market: Readonly<{
    contract: "market-data-envelope-v1";
    status: "AVAILABLE" | "LICENSE_BLOCKED";
    revisionIds: readonly string[];
    rows: readonly Readonly<{ marketDate: string; status: string; revisionId: string; closeValue: string | null }>[];
  }>;
  news: Readonly<{
    contract: "news-envelope-v1";
    status: "AVAILABLE";
    revisionIds: readonly string[];
    rows: readonly Record<string, unknown>[];
  }>;
}>;

type QueryClient = Pick<Client, "query">;

/**
 * Read-only cross-engine PIT adapter. It invokes both engines' own readers and
 * never joins or writes their tables. The cutoff is passed unchanged to both
 * functions; timestamp proofs are checked before either result is exposed.
 */
export async function readJointMarketNewsPitV1(client: QueryClient, listingId: string, cutoff: string): Promise<JointPitReadV1> {
  const market = await client.query<{ market_date: string; status: string; revision_id: string; close_value: string | null }>(
    "select market_date::text,status,revision_id::text,close_value::text from market_core.read_market_pit($1::uuid,$2::timestamptz)", [listingId, cutoff],
  );
  const marketIds = market.rows.map(row => row.revision_id);
  const marketProof = marketIds.length === 0 ? [] : (await client.query<{ revision_id: string; as_known_at: Date; ingested_at: Date }>(
    "select revision_id::text,as_known_at,ingested_at from market_core.market_observation_revisions where revision_id = any($1::uuid[])", [marketIds],
  )).rows;
  if (marketProof.some(row => row.as_known_at.getTime() > Date.parse(cutoff) || row.ingested_at.getTime() > Date.parse(cutoff))) throw new Error("MARKET_PIT_LOOKAHEAD");

  const news = await client.query<Record<string, unknown>>("select * from news_core.read_fact_revisions_as_of($1::timestamptz)", [cutoff]);
  const newsTimes = news.rows.flatMap(row => [row.asKnownAt, row.committedAt]).filter(value => value !== null).map(value => new Date(String(value)).getTime());
  if (newsTimes.some(value => value > Date.parse(cutoff))) throw new Error("NEWS_PIT_LOOKAHEAD");
  return {
    cutoff,
    market: { contract: "market-data-envelope-v1", status: market.rows.some(row => row.status === "AVAILABLE") ? "AVAILABLE" : "LICENSE_BLOCKED", revisionIds: marketIds, rows: market.rows.map(row => ({ marketDate: row.market_date, status: row.status, revisionId: row.revision_id, closeValue: row.close_value })) },
    news: { contract: "news-envelope-v1", status: "AVAILABLE", revisionIds: news.rows.map(row => String(row.factRevisionId)), rows: news.rows },
  };
}
