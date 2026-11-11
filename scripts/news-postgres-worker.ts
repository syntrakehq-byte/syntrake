import { Pool } from "pg";
import { PostgresNewsStore } from "../news-core/postgresStore";
import { registerSecTarget, runNewsExecutorForever } from "../news-core/autonomousExecutor";

const url = process.env.NEWS_DATABASE_URL;
const userAgent = process.env.SEC_USER_AGENT;
if (!url || !userAgent) throw new Error("NEWS_DATABASE_URL and SEC_USER_AGENT are required");
const pool = new Pool({ connectionString: url, max: 4, idleTimeoutMillis: 30_000, application_name: "syntrake-news-worker" });
const store = new PostgresNewsStore(pool);
const abort = new AbortController();
process.once("SIGTERM", () => abort.abort());
process.once("SIGINT", () => abort.abort());
registerSecTarget(store, process.env.SEC_CIK ?? "0000320193")
  .then(() => runNewsExecutorForever({ store, workerId: process.env.NEWS_WORKER_ID ?? `worker-${process.pid}`, secUserAgent: userAgent, intervalMs: Number(process.env.NEWS_POLL_INTERVAL_MS ?? 30000), signal: abort.signal }))
  .catch(error => { console.error(error instanceof Error ? error.message : "NEWS_WORKER_FAILED"); process.exitCode = 1; })
  .finally(() => store.close());
