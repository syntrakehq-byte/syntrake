import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "pg";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const migration = new URL("../../supabase/migrations/20261111150000_news_core_postgres_n1.sql", import.meta.url);

test("News supervisor restarts a killed worker and stops cooperatively", { skip: !DB_URL && "NEWS_DATABASE_URL or TEST_DATABASE_URL required: real PG17 only" }, async () => {
  assert.ok(DB_URL);
  const admin = new Client({ connectionString: DB_URL });
  await admin.connect();
  const cik = "0000000001";
  await admin.query(await readFile(migration, "utf8"));
  const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/news-supervisor.ts"], {
    cwd: process.cwd(), env: { ...process.env, NEWS_DATABASE_URL: DB_URL, SEC_USER_AGENT: "SYNTRAKE supervisor CI/1.0 security@syntrake.com", NEWS_EXECUTION_MODE: "N1_ONLY", SEC_CIK: cik, NEWS_POLL_INTERVAL_MS: "50" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let started = 0;
  const waitFor = (predicate: () => boolean, timeoutMs: number) => new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`SUPERVISOR_TIMEOUT output=${output}`)), timeoutMs);
    const timer = setInterval(() => { if (predicate()) { clearTimeout(deadline); clearInterval(timer); resolve(); } }, 50);
  });
  child.stdout.on("data", chunk => { output += String(chunk); started = (output.match(/NEWS_SUPERVISOR_STARTED/g) ?? []).length; });
  child.stderr.on("data", chunk => { output += String(chunk); });
  try {
    await waitFor(() => started >= 1, 15_000);
    const firstPid = Number(output.match(/NEWS_SUPERVISOR_STARTED pid=(\d+)/)?.[1]);
    assert.ok(firstPid > 0);
    process.kill(firstPid, "SIGKILL");
    await waitFor(() => started >= 2, 20_000);
    child.kill("SIGTERM");
    const exit = await new Promise<{ code: number | null }>(resolve => child.once("close", code => resolve({ code })));
    assert.equal(exit.code, 0, output);
    assert.match(output, /NEWS_SUPERVISOR_EXIT/);
    assert.match(output, /NEWS_SUPERVISOR_STOP/);
  } finally {
    if (!child.killed) child.kill("SIGTERM");
    await admin.query("delete from news_core.collection_targets where entity_key=$1", [cik]).catch(() => undefined);
    await admin.end();
  }
});

test("News supervisor escalates a non-cooperative child without leaving it orphaned", { skip: process.platform === "win32" && "POSIX SIGTERM/SIGKILL semantics required" }, async () => {
  const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/news-supervisor.ts"], {
    cwd: process.cwd(), env: { ...process.env, NEWS_SUPERVISOR_TEST_NONCOOPERATIVE: "1", NEWS_SUPERVISOR_STOP_TIMEOUT_MS: "300" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", chunk => { output += String(chunk); });
  child.stderr.on("data", chunk => { output += String(chunk); });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`SUPERVISOR_NONCOOPERATIVE_TIMEOUT output=${output}`)), 15_000);
    const check = setInterval(() => { if (/NEWS_SUPERVISOR_STARTED/.test(output)) { clearTimeout(timer); clearInterval(check); resolve(); } }, 50);
  });
  child.kill("SIGTERM");
  const exit = await new Promise<{ code: number | null }>(resolve => child.once("close", code => resolve({ code })));
  assert.equal(exit.code, 0, output);
  assert.match(output, /NEWS_SUPERVISOR_EXIT/);
});
