import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "pg";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const migration = new URL("../../supabase/migrations/20261111150000_news_core_postgres_n1.sql", import.meta.url);
const repoRoot = join(process.cwd());

function runWorker(env: Record<string, string>): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/news-postgres-worker.ts"], {
      cwd: repoRoot, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    const timeout = setTimeout(() => child.kill(), 10_000);
    child.once("error", reject);
    child.once("close", (code, signal) => { clearTimeout(timeout); resolve({ code, signal, stdout, stderr }); });
  });
}

test("worker subprocess has one bootstrap, exits 0 after cooperative shutdown and closes the store", { skip: !DB_URL && "NEWS_DATABASE_URL or TEST_DATABASE_URL required" }, async () => {
  const admin = new Client({ connectionString: DB_URL }); await admin.connect();
  const directory = await mkdtemp(join(tmpdir(), "syntrake-news-worker-process-"));
  const shutdownFile = join(directory, "shutdown.request");
  const cik = "0000000001";
  try {
    await admin.query(await readFile(migration, "utf8"));
    await writeFile(shutdownFile, "cooperative\n", "utf8");
    const result = await runWorker({ NEWS_DATABASE_URL: DB_URL, SEC_USER_AGENT: "SYNTRAKE subprocess test@example.com", NEWS_SHUTDOWN_FILE: shutdownFile, SEC_CIK: cik, NEWS_POLL_INTERVAL_MS: "50" });
    assert.equal(result.signal, null); assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /NEWS_SHUTDOWN_REQUESTED reason=COOPERATIVE_FILE/);
    assert.match(result.stdout, /NEWS_STORE_CLOSED/);
    assert.equal((result.stdout.match(/NEWS_STORE_CLOSED/g) ?? []).length, 1, "import must not start a second worker bootstrap");
  } finally {
    await admin.query("delete from news_core.collection_targets where entity_key=$1", [cik]);
    await admin.end(); await rm(directory, { recursive: true, force: true });
  }
});

test("worker subprocess returns non-zero when startup cannot connect", async () => {
  const result = await runWorker({ NEWS_DATABASE_URL: "postgresql://127.0.0.1:1/unavailable", SEC_USER_AGENT: "SYNTRAKE subprocess test@example.com", PGCONNECT_TIMEOUT: "1" });
  assert.equal(result.signal, null); assert.notEqual(result.code, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /NEWS_STORE_CLOSED|connect|ECONNREFUSED|timeout/i);
});
