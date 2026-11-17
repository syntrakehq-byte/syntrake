import { Pool } from "pg";
import { existsSync, unlinkSync } from "node:fs";
import { PostgresNewsStore } from "../news-core/postgresStore";
import { registerGlobalTarget, registerSecTarget, runNewsExecutorForever } from "../news-core/autonomousExecutor";
import type { GlobalNewsRegistryEntry } from "../news-core/globalNewsRegistry";
import { NewsFactualPipelineV1 } from "../news-core/factualPipeline";

const url = process.env.NEWS_DATABASE_URL;
const userAgent = process.env.SEC_USER_AGENT;
if (!url || !userAgent) throw new Error("NEWS_DATABASE_URL and SEC_USER_AGENT are required");
const withSessionRole = (connectionString: string, role: string): string => {
  const parsed = new URL(connectionString);
  const existing = parsed.searchParams.get("options");
  parsed.searchParams.set("options", [existing, `-c role=${role}`].filter(Boolean).join(" "));
  return parsed.toString();
};
const pool = new Pool({ connectionString: withSessionRole(url, "news_service"), max: 4, idleTimeoutMillis: 30_000, application_name: "syntrake-news-worker" });
const store = new PostgresNewsStore(pool);
const factualVerifierUrl = process.env.NEWS_PIPELINE_VERIFIER_DATABASE_URL;
const factualAttestorUrl = process.env.NEWS_FACTUAL_ATTESTOR_DATABASE_URL;
const factualWriterUrl = process.env.NEWS_FACTUAL_WRITER_DATABASE_URL;
const executionMode = process.env.NEWS_EXECUTION_MODE ?? "FACTUAL";
const factualConfigured = Boolean(factualVerifierUrl && factualAttestorUrl && factualWriterUrl);
const factualPublicationIds = process.env.NODE_ENV === "test" && process.env.NEWS_TEST_ALLOW_PROCESSING_HOLD === "1" && process.env.NEWS_FACTUAL_PUBLICATION_ID ? [process.env.NEWS_FACTUAL_PUBLICATION_ID] : undefined;
if (executionMode !== "FACTUAL" && executionMode !== "N1_ONLY") throw new Error("NEWS_EXECUTION_MODE_INVALID");
if (executionMode === "FACTUAL" && !factualConfigured) throw new Error("NEWS_FACTUAL_PIPELINE_CONFIG_INCOMPLETE");
if (executionMode === "N1_ONLY" && factualConfigured) throw new Error("NEWS_N1_ONLY_WITH_FACTUAL_CREDENTIALS");
console.log(`NEWS_EXECUTION_MODE=${executionMode}`);
console.log(`NEWS_WORKER_READY pid=${process.pid} workerId=${process.env.NEWS_WORKER_ID ?? `worker-${process.pid}`}`);
const factualPipeline = executionMode === "FACTUAL"
  ? new NewsFactualPipelineV1({ news: store, verifierPool: new Pool({ connectionString: withSessionRole(factualVerifierUrl, "news_pipeline_verifier"), max: 2, application_name: "syntrake-news-verifier" }), attestorPool: new Pool({ connectionString: withSessionRole(factualAttestorUrl, "news_factual_attestor"), max: 2, application_name: "syntrake-news-attestor" }), writerPool: new Pool({ connectionString: withSessionRole(factualWriterUrl, "news_factual_writer"), max: 2, application_name: "syntrake-news-writer" }), userAgent, maxDocuments: Number(process.env.NEWS_FACTUAL_DOCUMENT_LIMIT ?? 20), processingHoldMs: process.env.NODE_ENV === "test" && process.env.NEWS_TEST_ALLOW_PROCESSING_HOLD === "1" ? Number(process.env.NEWS_FACTUAL_PROCESSING_HOLD_MS ?? 0) : 0 })
  : undefined;
const globalSources = process.env.NEWS_GLOBAL_SOURCES_JSON ? JSON.parse(process.env.NEWS_GLOBAL_SOURCES_JSON) as GlobalNewsRegistryEntry[] : [];
const abort = new AbortController();
let executionFailed = false;
const shutdownFile = process.env.NEWS_SHUTDOWN_FILE;
let shutdownPoll: NodeJS.Timeout | undefined;
const requestShutdown = (reason: string) => {
  if (process.env.NEWS_TEST_IGNORE_SIGTERM === "1") return;
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
Promise.all([registerSecTarget(store, process.env.SEC_CIK ?? "0000320193"), ...globalSources.map(source => registerGlobalTarget(store, source))])
  .then(() => runNewsExecutorForever({ store, globalSources, factualPipeline, factualPublicationIds, workerId: process.env.NEWS_WORKER_ID ?? `worker-${process.pid}`, secUserAgent: userAgent, leaseSeconds: Number(process.env.NEWS_LEASE_SECONDS ?? 60), intervalMs: Number(process.env.NEWS_POLL_INTERVAL_MS ?? 30000), signal: abort.signal, onExecutionError: () => { executionFailed = true; } }))
  .catch(error => { console.error(error instanceof Error ? error.message : "NEWS_WORKER_FAILED"); process.exitCode = 1; })
  .finally(async () => {
    if (shutdownPoll) clearInterval(shutdownPoll);
    try {
      if (factualPipeline) await factualPipeline.close();
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
