import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, Pool } from "pg";
import { NewsConsumptionApiV1 } from "../n5Api";
import { PostgresFactualStore } from "../factualPersistence";
import { PostgresNewsStore } from "../postgresStore";
import { fetchSecFilings, secCollectionScopeKey } from "../secAdapter";
import { fetchSafeExternal } from "../sourceSecurity";

const DB_URL = process.env.NEWS_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const migration = (name: string) => new URL(`../../supabase/migrations/${name}`, import.meta.url);
const PASSWORD = "bl4-factual-supervisor-password";
const roleUrl = (base: string, role: string): string => { const url = new URL(base); url.username = role; url.password = PASSWORD; return url.toString(); };
const stripDocument = (html: string): string => html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
const hasControlledExcerpt = (html: string): boolean => stripDocument(html).split(/(?<=[.!?])\s+/).some(value => value.length >= 20 && value.length <= 1200 && /(?:\b(?:declares?|declared|announces?|announced)\b.{0,100}\bdividend\b|\b(?:reports?|reported|announces?|announced)\b.{0,100}\b(?:earnings|revenue|net income|profit|loss)\b|\b(?:was|were|is|are|has|have|had|received|fined|sanctioned|charged|sued|settled|convicted|approved|cleared|ordered)\b.{0,80}\b(?:fine|fined|sanction|sanctioned|charge|charged|lawsuit|sued|settlement|settled|convicted|approved|cleared|order|ordered)\b|\b(?:signed|declared|announced|imposed|lifted|entered|occurred|began|continued|reported)\b.{0,80}\b(?:ceasefire|sanctions?|invasion|military operation|armed conflict|treaty)\b)/i.test(value));

test("FACTUAL supervisor restarts after SIGKILL and completes SEC work in N5", { skip: !DB_URL && "NEWS_DATABASE_URL or TEST_DATABASE_URL required: real PG17 only" }, async () => {
  assert.ok(DB_URL);
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const roles = { service: `bl4_service_${suffix}`, verifier: `bl4_verifier_${suffix}`, attestor: `bl4_attestor_${suffix}`, writer: `bl4_writer_${suffix}`, reader: `bl4_reader_${suffix}` };
  const admin = new Client({ connectionString: DB_URL, statement_timeout: 15_000, query_timeout: 20_000 });
  await admin.connect();
  const adminNews = new PostgresNewsStore(new Pool({ connectionString: DB_URL, max: 2 }));
  let supervisor: ReturnType<typeof spawn> | undefined;
  let reader: PostgresFactualStore | undefined;
  let news: PostgresNewsStore | undefined;
  let output = "";
  let starts = 0;
  const waitFor = (predicate: () => boolean | Promise<boolean>, timeoutMs: number) => new Promise<void>((resolve, reject) => { let settled = false; const timer = setInterval(async () => { if (settled) return; if (await predicate()) { settled = true; clearTimeout(deadline); clearInterval(timer); resolve(); } }, 100); const deadline = setTimeout(() => { if (!settled) { settled = true; clearInterval(timer); reject(new Error(`FACTUAL_SUPERVISOR_TIMEOUT output=${output.slice(-5000)}`)); } }, timeoutMs); });
  try {
    for (const file of ["20261111150000_news_core_postgres_n1.sql", "20261111170000_news_core_n2a_revisions.sql", "20261112120000_news_core_n3c_factual_persistence.sql", "20261112170000_news_core_n3c_factual_writer_boundary.sql", "20261112150000_news_core_n5_read_api.sql", "20261113100000_news_core_bl3_factual_backlog.sql", "20261113110000_news_core_bl3_backlog_fencing.sql"]) { console.log(`BL4_FACTUAL_SETUP migration=${file}`); await admin.query(await readFile(migration(file), "utf8")); }
    console.log("BL4_FACTUAL_SETUP migrations=ok");
    for (const role of Object.values(roles)) await admin.query(`create role ${role} login inherit password '${PASSWORD}' nocreatedb nocreaterole`);
    await admin.query(`grant news_service to ${roles.service}`);
    await admin.query(`grant news_pipeline_verifier to ${roles.verifier}`);
    await admin.query(`grant news_factual_attestor to ${roles.attestor}`);
    await admin.query(`grant news_factual_writer to ${roles.writer}`);
    await admin.query(`grant news_reader to ${roles.reader}`);
    console.log("BL4_FACTUAL_SETUP roles=ok");
    const userAgent = "SYNTRAKE BL4 factual supervisor CI/1.0 security@syntrake.com";
    const collected = await fetchSecFilings({ cik: "0000320193", userAgent, now: new Date(), signal: AbortSignal.timeout(20_000) });
    console.log(`BL4_FACTUAL_SETUP sec_publications=${collected.publications.length}`);
    let publication: typeof collected.publications[number] | undefined;
    for (const candidate of collected.publications.filter(item => item.form === "8-K").slice(0, 8)) {
      try {
        const documentResponse = await fetchSafeExternal(candidate.originalUrl, { headers: { "User-Agent": userAgent, Accept: "text/html" }, signal: AbortSignal.timeout(5_000) });
        if (documentResponse.ok && hasControlledExcerpt(await documentResponse.text())) { publication = candidate; break; }
      } catch { /* bounded live-source probe; continue conservatively */ }
    }
    assert.ok(publication, "SEC live collection must provide a supported 8-K document");
    const scope = secCollectionScopeKey("0000320193");
    const observedAt = new Date().toISOString();
    await adminNews.ingestAdministrative({ publications: [publication], observations: collected.observations.filter(item => item.publicationId === publication.publicationId), checkpoint: { sourceId: "sec-edgar", collectionScopeKey: scope, cursor: collected.nextCursor, updatedAt: observedAt } });
    console.log(`BL4_FACTUAL_SETUP ingest=ok publication=${publication.publicationId}`);
    supervisor = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/news-supervisor.ts"], { cwd: process.cwd(), env: { ...process.env, NEWS_DATABASE_URL: roleUrl(DB_URL, roles.service), NEWS_PIPELINE_VERIFIER_DATABASE_URL: roleUrl(DB_URL, roles.verifier), NEWS_FACTUAL_ATTESTOR_DATABASE_URL: roleUrl(DB_URL, roles.attestor), NEWS_FACTUAL_WRITER_DATABASE_URL: roleUrl(DB_URL, roles.writer), NEWS_EXECUTION_MODE: "FACTUAL", SEC_CIK: "0000320193", SEC_USER_AGENT: userAgent, NEWS_POLL_INTERVAL_MS: "100", NEWS_FACTUAL_DOCUMENT_LIMIT: "20" }, stdio: ["ignore", "pipe", "pipe"] });
    const processHandle = supervisor;
    console.log("BL4_FACTUAL_SETUP supervisor=spawned");
    processHandle.stdout.on("data", chunk => { output += String(chunk); starts = (output.match(/NEWS_SUPERVISOR_STARTED/g) ?? []).length; });
    processHandle.stderr.on("data", chunk => { output += String(chunk); });
    await waitFor(() => starts >= 1 && /NEWS_EXECUTION_MODE=FACTUAL/.test(output), 20_000);
    const firstPid = Number(output.match(/NEWS_SUPERVISOR_STARTED pid=(\d+)/)?.[1]);
    assert.ok(firstPid > 0);
    process.kill(firstPid, "SIGKILL");
    await waitFor(() => starts >= 2, 30_000);
    const factsDeadline = Date.now() + 30_000;
    while (Date.now() < factsDeadline) {
      if (Number((await admin.query("select count(*)::int n from news_core.fact_events")).rows[0].n) > 0) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(Number((await admin.query("select count(*)::int n from news_core.fact_events")).rows[0].n) > 0, `FACTUAL_SUPERVISOR_TIMEOUT output=${output.slice(-5000)}`);
    reader = new PostgresFactualStore(new Pool({ connectionString: roleUrl(DB_URL, roles.reader) }), "news_reader");
    news = new PostgresNewsStore(new Pool({ connectionString: roleUrl(DB_URL, roles.service) }));
    const api = new NewsConsumptionApiV1({ news, factual: reader }, "0123456789abcdef", "bl4-factual-supervisor");
    const asOf = (await admin.query<{ cutoff: string }>("select clock_timestamp()::timestamptz::text cutoff")).rows[0].cutoff;
    const events = await api.getNewsEvents({ serviceId: "news_reader", credential: "bl4-factual-supervisor" }, { asOf });
    assert.equal(events.status, "AVAILABLE"); assert.ok(events.data.length > 0);
    processHandle.kill("SIGTERM");
    const exit = await new Promise<{ code: number | null }>(resolve => {
      let settled = false;
      const finish = (code: number | null) => { if (!settled) { settled = true; resolve({ code }); } };
      processHandle.once("close", finish);
      if (processHandle.exitCode !== null || processHandle.signalCode !== null) finish(processHandle.exitCode);
    });
    assert.equal(exit.code, 0, output);
    const duplicates = Number((await admin.query("select count(*)::int n from news_core.fact_revisions")).rows[0].n);
    assert.ok(duplicates > 0);
  } finally {
    if (supervisor && !supervisor.killed) supervisor.kill("SIGKILL");
    if (supervisor && supervisor.exitCode === null) await new Promise<void>(resolve => { const timer = setTimeout(resolve, 2_000); supervisor?.once("close", () => { clearTimeout(timer); resolve(); }); });
    await news?.close().catch(() => undefined);
    await reader?.close().catch(() => undefined);
    await adminNews.close();
    for (const role of Object.values(roles)) await admin.query(`drop role if exists ${role}`).catch(() => undefined);
    await admin.end();
  }
});
