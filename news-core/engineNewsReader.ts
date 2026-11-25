import { Pool } from "pg";
import { readNewsForAnalysisV1, type AnalysisNewsInputV1 } from "./analysisNewsConsumer";
import type { NewsConsumerKindV1 } from "./consumerContracts";
import { GlobalNewsApiV1 } from "./globalNewsApi";
import { NewsConsumptionApiV1, type EventEvidenceInput, type NewsServiceAuthV1 } from "./n5Api";
import { PostgresNewsStore } from "./postgresStore";
import { PostgresFactualStore } from "./factualPersistence";
import { assertNewsSiteReadRole, type NewsSiteReaderIdentityV1 } from "./siteNewsN5";

type ReaderConfig = Readonly<{ url: URL; ca: string; cursorSecret: string; credential: string }>;

/** Internal server adapter. No user, portfolio or execution data enters News.
 * Each engine has its own DB login and stable cursor secret, never a writer. */
export function resolveEngineNewsReaderV1(consumer: NewsConsumerKindV1, env: NodeJS.ProcessEnv = process.env): ReaderConfig {
  if (consumer !== "INVESTING" && consumer !== "TRADING") throw new Error("NEWS_CONSUMER_INVALID");
  const prefix = consumer + "_NEWS_";
  const connection = env[prefix + "READER_DATABASE_URL"] ?? "";
  const other = env[(consumer === "INVESTING" ? "TRADING" : "INVESTING") + "_NEWS_READER_DATABASE_URL"];
  const ca = env.NEWS_READER_CA_PEM ?? "";
  const cursorSecret = env[prefix + "CURSOR_SECRET"] ?? "";
  const credential = env[prefix + "SERVICE_CREDENTIAL"] ?? "";
  if (!connection || !ca.includes("BEGIN CERTIFICATE") || !ca.includes("END CERTIFICATE") ||
      cursorSecret.length < 32 || credential.length < 24) throw new Error("NEWS_ENGINE_READER_NOT_CONFIGURED");
  let url: URL;
  try {
    url = new URL(connection);
    if (other && new URL(other).username === url.username) throw new Error();
  } catch { throw new Error("NEWS_ENGINE_READER_DB_CONFIG_INVALID"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.password ||
      url.port === "6543" || [...url.searchParams.keys()].some(key => ["options", "sslmode", "sslcert", "sslkey", "sslrootcert"].includes(key.toLowerCase()))) {
    throw new Error("NEWS_ENGINE_READER_DB_CONFIG_INVALID");
  }
  url.searchParams.set("options", "-c role=news_reader");
  return { url, ca, cursorSecret, credential };
}

async function withReader<T>(consumer: NewsConsumerKindV1, operation: (api: NewsConsumptionApiV1, auth: NewsServiceAuthV1, pool: Pool) => Promise<T>): Promise<T> {
  const config = resolveEngineNewsReaderV1(consumer);
  const pool = new Pool({ connectionString: config.url.toString(), ssl: { ca: config.ca, rejectUnauthorized: true },
    max: 2, connectionTimeoutMillis: 6000, idleTimeoutMillis: 4000, statement_timeout: 9000,
    application_name: "syntrake-news-" + consumer.toLowerCase() + "-reader" });
  try {
    const identity = await pool.query<NewsSiteReaderIdentityV1>(
      "select current_user as role_name, session_user as login_name, r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb, " +
      "coalesce((select bool_or(pg_has_role(r.rolname,p.rolname,'MEMBER')) from pg_roles p where p.rolname in " +
      "('news_service','news_pipeline_verifier','news_factual_attestor','news_factual_writer')),false) as has_writer_membership " +
      "from pg_roles r where r.rolname=session_user",
    );
    assertNewsSiteReadRole(identity.rows[0]);
    const durability = await pool.query<{ enabled: string }>("select current_setting('track_commit_timestamp') enabled");
    if (durability.rows[0]?.enabled !== "on") throw new Error("NEWS_ENGINE_FACTUAL_DURABILITY_NOT_CONFIGURED");
    const api = new NewsConsumptionApiV1({ news: new PostgresNewsStore(pool), factual: new PostgresFactualStore(pool, "news_reader") }, config.cursorSecret, config.credential);
    return await operation(api, { serviceId: "news_reader", credential: config.credential }, pool);
  } finally { await pool.end(); }
}

export function readInvestingNewsV1(input: AnalysisNewsInputV1) {
  return withReader("INVESTING", (api, auth) => readNewsForAnalysisV1(new GlobalNewsApiV1(api), auth, "INVESTING", input));
}
export function readTradingNewsV1(input: AnalysisNewsInputV1) {
  return withReader("TRADING", (api, auth) => readNewsForAnalysisV1(new GlobalNewsApiV1(api), auth, "TRADING", input));
}
export function readEngineNewsEvidenceV1(consumer: NewsConsumerKindV1, input: EventEvidenceInput & { asOf: string }) {
  return withReader(consumer, (api, auth) => api.getEventEvidence(auth, input));
}

/** Current operational health, not a historical/backtest fact. The engine
 * owns its acceptable maximum age; an absent source is never healthy. */
export function readEngineNewsHealthV1(consumer: NewsConsumerKindV1) {
  return withReader(consumer, async (_api, _auth, pool) => {
    const result = await pool.query("select source_id,collection_scope_key,health,coverage,last_success_at,last_published_at,last_error_code from news_core.global_operational_state order by source_id,collection_scope_key");
    return { observedAt: new Date().toISOString(), sources: result.rows.map(row => Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
    )) };
  });
}
