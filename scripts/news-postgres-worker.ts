import { Pool } from "pg";
import { existsSync, unlinkSync } from "node:fs";
import { PostgresNewsStore } from "../news-core/postgresStore";
import { registerSecTarget, runNewsExecutorForever } from "../news-core/autonomousExecutor";

const url = process.env.NEWS_DATABASE_URL;
const userAgent = process.env.SEC_USER_AGENT;
if (!url || !userAgent) throw new Error("NEWS_DATABASE_URL and SEC_USER_AGENT are required");
const pool = new Pool({ connectionString: url, max: 4, idleTimeoutMillis: 30_000, application_name: "syntrake-news-worker" });
const store = new PostgresNewsStore(pool);
const abort = new AbortController();
const shutdownFile = process.env.NEWS_SHUTDOWN_FILE;
let shutdownPoll: NodeJS.Timeout | undefined;
const requestShutdown = (reason: string) => {
  if (!abort.signal.aborted) {
    console.log(`NEWS_SHUTDOWN_REQUESTED reason=${reason}`);
    abort.abort();
  }
};
process.once("SIGTERM", () => requestShutdown("SIGTERM"));
process.once("SIGINT", () => requestShutdown("SIGINT"));
if (shutdownFile) {
  shutdownPoll = setInterval(() => {
    if (existsSync(shutdownFile)) {
      try { unlinkSync(shutdownFile); } catch { /* supervisor may remove it */ }
      requestShutdown("COOPERATIVE_FILE");
    }
  }, 100);
}
registerSecTarget(store, process.env.SEC_CIK ?? "0000320193")
  .then(() => runNewsExecutorForever({ store, workerId: process.env.NEWS_WORKER_ID ?? `worker-${process.pid}`, secUserAgent: userAgent, leaseSeconds: Number(process.env.NEWS_LEASE_SECONDS ?? 60), intervalMs: Number(process.env.NEWS_POLL_INTERVAL_MS ?? 30000), signal: abort.signal }))
  .catch(error => { console.error(error instanceof Error ? error.message : "NEWS_WORKER_FAILED"); process.exitCode = 1; })
  .finally(async () => {
    if (shutdownPoll) clearInterval(shutdownPoll);
    await store.close();
    console.log("NEWS_STORE_CLOSED");
    process.exit(0);
  });
