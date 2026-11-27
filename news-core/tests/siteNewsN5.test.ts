import assert from "node:assert/strict";
import test from "node:test";
import { normalizeNewsTlsCaPem, newsDatabaseConnectionUrl } from "../databaseTls";
import { assertNewsSiteReadRole, mapNewsN5ForSite, type NewsSiteReaderIdentityV1 } from "../siteNewsN5";
import type { NewsPublicationRevision } from "../contracts";

const record = (overrides: Partial<NewsPublicationRevision> = {}): NewsPublicationRevision => ({
  publicationRevisionId: "publication-a:revision:1",
  publicationId: "publication-a",
  revisionNo: 1,
  title: "Central bank publishes a statement",
  publishedAt: "2026-11-25T12:00:00.000Z",
  form: "GLOBAL_RSS_2",
  contentFingerprint: "fingerprint",
  contentExcerpt: "This text must never be shown",
  sourceDocumentRef: "https://www.ecb.europa.eu/press/something",
  qualityFlags: ["RIGHTS_METADATA_ONLY"],
  supersedesRevisionId: null,
  ingestedAt: "2026-11-25T12:10:00.000Z",
  asKnownAt: "2026-11-25T12:10:10.000Z",
  sourceId: "eu-ecb-press",
  rightsMode: "METADATA_ONLY",
  ...overrides,
});

test("site maps N5 PIT publications to safe metadata only", () => {
  const data = mapNewsN5ForSite([record()], ["eu-ecb-press"]);
  assert.equal(data.length, 1);
  assert.equal(data[0].sourceId, "eu-ecb-press");
  assert.equal(data[0].title, "Central bank publishes a statement");
  assert.equal(data[0].publishedAt, "2026-11-25T12:00:00.000Z");
  assert.equal(data[0].originalUrl, "https://www.ecb.europa.eu/press/something");
  assert.equal("contentExcerpt" in data[0], false);
  assert.equal(JSON.stringify(data).includes("This text must never be shown"), false);
  assert.deepEqual(data[0].qualityFlags, ["RIGHTS_METADATA_ONLY"]);
});
test("site N5 mapping ignores unapproved sources and unsafe destinations", () => {
  const data = mapNewsN5ForSite([
    record({sourceId: "unapproved"}),
    record({sourceDocumentRef: "javascript:alert(1)"}),
    record({sourceDocumentRef: "http://www.ecb.europa.eu/press"}),
    record({sourceDocumentRef: "https://localhost/admin"}),
    record({sourceDocumentRef: "https://127.0.0.1/admin"}),
    record({sourceDocumentRef: "https://a.example:8443/news"}),
    record({sourceDocumentRef: "https://user:pass@a.example/news"}),
    record({sourceDocumentRef: "https://www.ecb.europa.eu/press#frag"}),
    record({sourceDocumentRef: "https://www.ecb.europa.eu/press", publicationRevisionId: "safe"}),
  ], ["eu-ecb-press"]);
  assert.deepEqual(data.map(x => x.publicationRevisionId), ["safe"]);
});

test("site accepts only a dedicated unprivileged DB login assuming news_reader", () => {
  const safe: NewsSiteReaderIdentityV1 = {
    role_name: "news_reader", login_name: "news_site_reader",
    rolsuper: false, rolbypassrls: false, rolcreaterole: false,
    rolcreatedb: false, has_writer_membership: false,
  };
  assert.doesNotThrow(() => assertNewsSiteReadRole(safe));
  assert.throws(() => assertNewsSiteReadRole(undefined), /READER_ROLE_REQUIRED/);
  assert.throws(() => assertNewsSiteReadRole({ ...safe, role_name: "news_service" }), /READER_ROLE_REQUIRED/);
  assert.throws(() => assertNewsSiteReadRole({ ...safe, login_name: "postgres", rolsuper: true }), /READER_ROLE_REQUIRED/);
  assert.throws(() => assertNewsSiteReadRole({ ...safe, has_writer_membership: true }), /READER_ROLE_REQUIRED/);
  assert.throws(() => assertNewsSiteReadRole({ ...safe, rolbypassrls: true }), /READER_ROLE_REQUIRED/);
  assert.throws(() => assertNewsSiteReadRole({ ...safe, rolcreaterole: true }), /READER_ROLE_REQUIRED/);
});

test("Vercel escaped and ordinary multiline TLS certificates normalize identically", () => {
  const pem = "-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----";
  assert.equal(normalizeNewsTlsCaPem(pem), pem);
  assert.equal(normalizeNewsTlsCaPem(pem.replaceAll("\n", "\\n")), pem);
  assert.equal(normalizeNewsTlsCaPem(pem.replaceAll("\n", "\\r\\n")), pem);
  assert.equal(normalizeNewsTlsCaPem(""), "");
});

test("Preview uses only the verified IPv4 session pooler and preserves the dedicated login", () => {
  const direct = "postgresql://news_fixture:fixture@db.gehlmcjctcfdbtzlyswm.supabase.co:5432/postgres";
  const preview = newsDatabaseConnectionUrl(direct, "news_reader", "preview");
  assert.equal(preview.url.hostname, "aws-1-eu-west-3.pooler.supabase.com");
  assert.equal(preview.url.username, "news_fixture.gehlmcjctcfdbtzlyswm");
  assert.equal(preview.url.password, "fixture");
  assert.equal(preview.sessionPooler, true);
  assert.equal(preview.url.searchParams.has("options"), false);
  const production = newsDatabaseConnectionUrl(direct, "news_reader", "production");
  assert.equal(production.url.hostname, "db.gehlmcjctcfdbtzlyswm.supabase.co");
  assert.equal(production.url.searchParams.get("options"), "-c role=news_reader");
  assert.throws(() => newsDatabaseConnectionUrl(direct.replace("news_fixture", "postgres"), "news_reader", "preview"));
  assert.throws(() => newsDatabaseConnectionUrl(direct.replace(":5432", ":6543"), "news_reader", "preview"));
});

test("production session pooler is explicit and bound to the distinct production project and role", () => {
  const direct = "postgresql://news_prod_site_reader:fixture@db.vbazzxqyuqcrmjytaboc.supabase.co:5432/postgres";
  const host = "aws-0-eu-west-3.pooler.supabase.com"; // fixture, not a deployment choice
  const p = newsDatabaseConnectionUrl(direct, "news_reader", "production", host);
  assert.equal(p.url.hostname, host);
  assert.equal(p.url.username, "news_prod_site_reader.vbazzxqyuqcrmjytaboc");
  assert.equal(p.url.password, "fixture");
  assert.equal(p.sessionPooler, true);
  assert.equal(p.url.searchParams.has("options"), false);
  assert.throws(() => newsDatabaseConnectionUrl(direct, "news_reader", "production", "evil.example"));
  assert.throws(() => newsDatabaseConnectionUrl(direct.replace("vbazzxqyuqcrmjytaboc", "gehlmcjctcfdbtzlyswm"), "news_reader", "production", host));
  assert.throws(() => newsDatabaseConnectionUrl(direct.replace("news_prod_site_reader", "postgres"), "news_reader", "production", host));
  assert.equal(newsDatabaseConnectionUrl(direct, "news_reader", "preview", host).url.hostname, "db.vbazzxqyuqcrmjytaboc.supabase.co");
});
