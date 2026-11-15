import { Pool } from "pg";
import { runNewsExecutorOnce } from "../autonomousExecutor";
import { PostgresNewsStore } from "../postgresStore";

const databaseUrl = process.env.NEWS_DATABASE_URL;
const scope = process.env.N0_T26_SCOPE;
const payloadBase64 = process.env.N0_T26_PAYLOAD_BASE64;
const mode = process.env.N0_T26_WORKER_MODE;
if (!databaseUrl || !scope || !payloadBase64 || !mode) throw new Error("N0_T26_WORKER_CONFIG_INVALID");
const payload = Buffer.from(payloadBase64, "base64").toString("utf8");
const fetchImpl: typeof fetch = async () => new Response(payload, { status: 200, headers: { "content-type": "application/json" } });
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const store = new PostgresNewsStore(pool);

try {
  if (mode === "barrier") {
    const originalIngest = store.ingest.bind(store);
    store.ingest = async (...args) => {
      process.stdout.write(`N0_T26_CHILD_READY pid=${process.pid}\n`);
      await new Promise<void>(() => undefined);
      return originalIngest(...args);
    };
  }
  const result = await runNewsExecutorOnce({ store, workerId: `n0-t26-pid-${process.pid}`, secUserAgent: process.env.SEC_USER_AGENT ?? "SYNTRAKE N0 T26 CI/1.0 security@syntrake.com", collectionScopeKey: scope, fetchImpl, fetchTimeoutMs: 30_000, leaseSeconds: 2 });
  process.stdout.write(`N0_T26_CHILD_DONE pid=${process.pid} claimed=${result.claimed}\n`);
} finally {
  await store.close();
}
