import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
  const adminNews = new PostgresNewsStore(new Pool({ connectionString: DB_URL, max: 2, statement_timeout: 15_000, query_timeout: 20_000 }));
  let supervisor: ReturnType<typeof spawn> | undefined;
  let reader: PostgresFactualStore | undefined;
  let news: PostgresNewsStore | undefined;
  let output = "";
  let starts = 0;
  const workerPids = new Set<number>();
  let selectedDocumentSha256 = "";
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
    await admin.query("delete from news_core.factual_pipeline_backlog");
    console.log("BL4_FACTUAL_SETUP roles=ok");
    const userAgent = "SYNTRAKE BL4 factual supervisor CI/1.0 security@syntrake.com";
    const collected = await fetchSecFilings({ cik: "0000320193", userAgent, now: new Date(), signal: AbortSignal.timeout(20_000) });
    console.log(`BL4_FACTUAL_SETUP sec_publications=${collected.publications.length}`);
    let publication: typeof collected.publications[number] | undefined;
    for (const candidate of collected.publications.filter(item => item.form === "8-K").slice(0, 8)) {
      try {
        const documentResponse = await fetchSafeExternal(candidate.originalUrl, { headers: { "User-Agent": userAgent, Accept: "text/html" }, signal: AbortSignal.timeout(5_000) });
        if (documentResponse.ok) {
          const body = await documentResponse.text();
          if (hasControlledExcerpt(body) && Number((await admin.query("select count(*)::int n from news_core.fact_events where canonical_claim_id=$1", [`sec:${candidate.externalId}`])).rows[0].n) === 0) { publication = candidate; selectedDocumentSha256 = createHash("sha256").update(body, "utf8").digest("hex"); break; }
        }
      } catch { /* bounded live-source probe; continue conservatively */ }
    }
    assert.ok(publication, "SEC live collection must provide a supported 8-K document");
    const scope = secCollectionScopeKey("0000320193");
    const observedAt = new Date().toISOString();
    await adminNews.ingestAdministrative({ publications: [publication], observations: collected.observations.filter(item => item.publicationId === publication.publicationId), checkpoint: { sourceId: "sec-edgar", collectionScopeKey: scope, cursor: collected.nextCursor, updatedAt: observedAt } });
    console.log(`BL4_FACTUAL_SETUP ingest=ok publication=${publication.publicationId}`);
    assert.equal(Number((await admin.query("select count(*)::int n from news_core.fact_events where canonical_claim_id=$1", [`sec:${publication.externalId}`])).rows[0].n), 0);
    supervisor = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/news-supervisor.ts"], { cwd: process.cwd(), env: { ...process.env, NEWS_DATABASE_URL: roleUrl(DB_URL, roles.service), NEWS_PIPELINE_VERIFIER_DATABASE_URL: roleUrl(DB_URL, roles.verifier), NEWS_FACTUAL_ATTESTOR_DATABASE_URL: roleUrl(DB_URL, roles.attestor), NEWS_FACTUAL_WRITER_DATABASE_URL: roleUrl(DB_URL, roles.writer), NEWS_EXECUTION_MODE: "FACTUAL", SEC_CIK: "0000320193", SEC_USER_AGENT: userAgent, NEWS_POLL_INTERVAL_MS: "100", NEWS_FACTUAL_DOCUMENT_LIMIT: "1", NEWS_FACTUAL_PROCESSING_HOLD_MS: "10000" }, stdio: ["ignore", "pipe", "pipe"] });
    const processHandle = supervisor;
    console.log("BL4_FACTUAL_SETUP supervisor=spawned");
    processHandle.stdout.on("data", chunk => {
      output += String(chunk);
      starts = (output.match(/NEWS_SUPERVISOR_STARTED/g) ?? []).length;
      for (const match of output.matchAll(/NEWS_SUPERVISOR_STARTED pid=(\d+)/g)) workerPids.add(Number(match[1]));
    });
    processHandle.stderr.on("data", chunk => { output += String(chunk); });
    await waitFor(() => starts >= 1 && /NEWS_EXECUTION_MODE=FACTUAL/.test(output), 20_000);
    const firstPid = Number(output.match(/NEWS_SUPERVISOR_STARTED pid=(\d+)/)?.[1]);
    assert.ok(firstPid > 0);
    await waitFor(async () => Number((await admin.query("select count(*)::int n from news_core.factual_pipeline_backlog where publication_id=$1 and state='PROCESSING'", [publication.publicationId])).rows[0].n) === 1, 20_000);
    process.kill(firstPid, "SIGKILL");
    await waitFor(() => starts >= 2, 30_000);
    const canonicalClaimId = `sec:${publication.externalId}`;
    const factsDeadline = Date.now() + 30_000;
    while (Date.now() < factsDeadline) {
      if (Number((await admin.query("select count(*)::int n from news_core.fact_events where canonical_claim_id=$1", [canonicalClaimId])).rows[0].n) === 1) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const factual = await admin.query<{ event_count: number; revision_count: number; confirmation_status: string; content_fingerprint: string; evidence_count: number }>(`select count(distinct fe.fact_event_id)::int event_count, count(distinct fr.fact_revision_id)::int revision_count, max(fr.confirmation_status) confirmation_status, max(pr.content_fingerprint) content_fingerprint, count(fre.evidence_id)::int evidence_count from news_core.fact_events fe join news_core.fact_revisions fr on fr.fact_event_id=fe.fact_event_id join news_core.publication_revisions pr on pr.publication_revision_id=fr.publication_revision_id left join news_core.fact_revision_evidence fre on fre.fact_revision_id=fr.fact_revision_id where fe.canonical_claim_id=$1 and fre.source_document_ref=$2`, [canonicalClaimId, publication.originalUrl]);
    assert.equal(factual.rows[0].event_count, 1, `FACTUAL_SUPERVISOR_TIMEOUT output=${output.slice(-5000)}`);
    assert.equal(factual.rows[0].revision_count, 1);
    assert.equal(factual.rows[0].confirmation_status, "REPORTED");
    assert.equal(factual.rows[0].content_fingerprint, selectedDocumentSha256);
    assert.ok(factual.rows[0].evidence_count > 0);
    reader = new PostgresFactualStore(new Pool({ connectionString: roleUrl(DB_URL, roles.reader), statement_timeout: 15_000, query_timeout: 20_000 }), "news_reader");
    news = new PostgresNewsStore(new Pool({ connectionString: roleUrl(DB_URL, roles.service), statement_timeout: 15_000, query_timeout: 20_000 }));
    const api = new NewsConsumptionApiV1({ news, factual: reader }, "0123456789abcdef", "bl4-factual-supervisor");
    const asOf = (await admin.query<{ cutoff: string }>("select clock_timestamp()::timestamptz::text cutoff")).rows[0].cutoff;
    const events = await api.getNewsEvents({ serviceId: "news_reader", credential: "bl4-factual-supervisor" }, { asOf });
    assert.equal(events.status, "AVAILABLE"); assert.ok(events.data.some(event => event.canonicalClaimId === canonicalClaimId));
    processHandle.kill("SIGTERM");
    const exit = await new Promise<{ code: number | null }>(resolve => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          processHandle.kill("SIGKILL");
          settled = true;
          resolve({ code: processHandle.exitCode });
        }
      }, 15_000);
      const finish = (code: number | null) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ code }); } };
      processHandle.once("close", finish);
      if (processHandle.exitCode !== null || processHandle.signalCode !== null) finish(processHandle.exitCode);
    });
    assert.equal(exit.code, 0, output);
    const duplicates = Number((await admin.query("select count(*)::int n from news_core.fact_revisions fr join news_core.fact_events fe on fe.fact_event_id=fr.fact_event_id where fe.canonical_claim_id=$1", [canonicalClaimId])).rows[0].n);
    assert.equal(duplicates, 1);
  } finally {
    for (const pid of workerPids) {
      try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ }
    }
    if (supervisor && supervisor.exitCode === null) {
      supervisor.kill("SIGTERM");
      await new Promise<void>(resolve => { const timer = setTimeout(resolve, 2_000); supervisor?.once("close", () => { clearTimeout(timer); resolve(); }); });
      if (supervisor.exitCode === null) supervisor.kill("SIGKILL");
    }
    supervisor?.stdout?.destroy();
    supervisor?.stderr?.destroy();
    await news?.close().catch(() => undefined);
    await reader?.close().catch(() => undefined);
    await adminNews.close();
    for (const role of Object.values(roles)) await admin.query(`drop role if exists ${role}`).catch(() => undefined);
    await admin.end();
  }
});
