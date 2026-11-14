import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, Pool } from "pg";
import { NewsConsumptionApiV1 } from "../n5Api";
import { PostgresFactualStore } from "../factualPersistence";
import { PostgresNewsStore } from "../postgresStore";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const migration = (name: string) => new URL(`../../supabase/migrations/${name}`, import.meta.url);
const PASSWORD = "bl4-factual-supervisor-password";
const roleUrl = (base: string, role: string): string => { const url = new URL(base); url.username = role; url.password = PASSWORD; return url.toString(); };

test("FACTUAL supervisor restarts after SIGKILL and completes SEC work in N5", { skip: !DB_URL && "NEWS_DATABASE_URL or TEST_DATABASE_URL required: real PG17 only" }, async () => {
  assert.ok(DB_URL);
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const roles = { service: `bl4_service_${suffix}`, verifier: `bl4_verifier_${suffix}`, attestor: `bl4_attestor_${suffix}`, writer: `bl4_writer_${suffix}`, reader: `bl4_reader_${suffix}` };
  const admin = new Client({ connectionString: DB_URL });
  await admin.connect();
  const supervisor = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/news-supervisor.ts"], { cwd: process.cwd(), env: { ...process.env, NEWS_DATABASE_URL: roleUrl(DB_URL, roles.service), NEWS_PIPELINE_VERIFIER_DATABASE_URL: roleUrl(DB_URL, roles.verifier), NEWS_FACTUAL_ATTESTOR_DATABASE_URL: roleUrl(DB_URL, roles.attestor), NEWS_FACTUAL_WRITER_DATABASE_URL: roleUrl(DB_URL, roles.writer), NEWS_EXECUTION_MODE: "FACTUAL", SEC_CIK: "0000320193", SEC_USER_AGENT: "SYNTRAKE BL4 factual supervisor CI/1.0 security@syntrake.com", NEWS_POLL_INTERVAL_MS: "100", NEWS_FACTUAL_DOCUMENT_LIMIT: "20" }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let starts = 0;
  supervisor.stdout.on("data", chunk => { output += String(chunk); starts = (output.match(/NEWS_SUPERVISOR_STARTED/g) ?? []).length; });
  supervisor.stderr.on("data", chunk => { output += String(chunk); });
  const waitFor = (predicate: () => boolean | Promise<boolean>, timeoutMs: number) => new Promise<void>((resolve, reject) => { const deadline = setTimeout(() => reject(new Error(`FACTUAL_SUPERVISOR_TIMEOUT output=${output.slice(-5000)}`)), timeoutMs); const timer = setInterval(async () => { if (await predicate()) { clearTimeout(deadline); clearInterval(timer); resolve(); } }, 100); });
  try {
    for (const file of ["20261111150000_news_core_postgres_n1.sql", "20261111170000_news_core_n2a_revisions.sql", "20261112120000_news_core_n3c_factual_persistence.sql", "20261112170000_news_core_n3c_factual_writer_boundary.sql", "20261112150000_news_core_n5_read_api.sql", "20261113100000_news_core_bl3_factual_backlog.sql", "20261113110000_news_core_bl3_backlog_fencing.sql"]) await admin.query(await readFile(migration(file), "utf8"));
    for (const role of Object.values(roles)) await admin.query(`create role ${role} login inherit password '${PASSWORD}' nocreatedb nocreaterole`);
    await admin.query(`grant news_service to ${roles.service}`);
    await admin.query(`grant news_pipeline_verifier to ${roles.verifier}`);
    await admin.query(`grant news_factual_attestor to ${roles.attestor}`);
    await admin.query(`grant news_factual_writer to ${roles.writer}`);
    await admin.query(`grant news_reader to ${roles.reader}`);
    await waitFor(() => starts >= 1 && /NEWS_EXECUTION_MODE=FACTUAL/.test(output), 20_000);
    const firstPid = Number(output.match(/NEWS_SUPERVISOR_STARTED pid=(\d+)/)?.[1]);
    assert.ok(firstPid > 0);
    process.kill(firstPid, "SIGKILL");
    await waitFor(() => starts >= 2, 30_000);
    await waitFor(async () => Number((await admin.query("select count(*)::int n from news_core.fact_events")).rows[0].n) > 0, 120_000);
    const reader = new PostgresFactualStore(new Pool({ connectionString: roleUrl(DB_URL, roles.reader) }), "news_reader");
    const news = new PostgresNewsStore(new Pool({ connectionString: roleUrl(DB_URL, roles.service) }));
    const api = new NewsConsumptionApiV1({ news, factual: reader }, "0123456789abcdef", "bl4-factual-supervisor");
    const events = await api.getNewsEvents({ serviceId: "news_reader", credential: "bl4-factual-supervisor" }, { asOf: new Date(Date.now() + 60_000).toISOString() });
    assert.equal(events.status, "AVAILABLE"); assert.ok(events.data.length > 0);
    supervisor.kill("SIGTERM");
    const exit = await new Promise<{ code: number | null }>(resolve => supervisor.once("close", code => resolve({ code })));
    assert.equal(exit.code, 0, output);
    const duplicates = Number((await admin.query("select count(*)::int n from news_core.fact_revisions")).rows[0].n);
    assert.ok(duplicates > 0);
    await news.close(); await reader.close();
  } finally {
    if (!supervisor.killed) supervisor.kill("SIGTERM");
    for (const role of Object.values(roles)) await admin.query(`drop role if exists ${role}`).catch(() => undefined);
    await admin.end();
  }
});
