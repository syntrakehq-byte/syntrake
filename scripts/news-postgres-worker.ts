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
let executionFailed = false;
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
  if (existsSync(shutdownFile)) requestShutdown("COOPERATIVE_FILE");
  shutdownPoll = setInterval(() => {
    if (existsSync(shutdownFile)) {
      try { unlinkSync(shutdownFile); } catch { /* supervisor may remove it */ }
      requestShutdown("COOPERATIVE_FILE");
    }
  }, 100);
}
registerSecTarget(store, process.env.SEC_CIK ?? "0000320193")
  .then(() => runNewsExecutorForever({ store, workerId: process.env.NEWS_WORKER_ID ?? `worker-${process.pid}`, secUserAgent: userAgent, leaseSeconds: Number(process.env.NEWS_LEASE_SECONDS ?? 60), intervalMs: Number(process.env.NEWS_POLL_INTERVAL_MS ?? 30000), signal: abort.signal, onExecutionError: () => { executionFailed = true; } }))
  .catch(error => { console.error(error instanceof Error ? error.message : "NEWS_WORKER_FAILED"); process.exitCode = 1; })
  .finally(async () => {
    if (shutdownPoll) clearInterval(shutdownPoll);
    try {
      await store.close();
      console.log("NEWS_STORE_CLOSED");
    } catch (error) {
      console.error(error instanceof Error ? `NEWS_STORE_CLOSE_FAILED: ${error.message}` : "NEWS_STORE_CLOSE_FAILED");
      process.exitCode = 1;
    }
    if (executionFailed) process.exitCode = 1;
    if (process.exitCode === undefined) process.exitCode = 0;
    process.exit(process.exitCode);
  });
