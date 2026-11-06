import { Client } from "pg";

const connectionString = process.env.MARKET_DATA_READER_DATABASE_URL;
const fakeListing = "00000000-0000-0000-0000-000000000000";
const stage = (name: string) => console.log(`PG17_PROBE ${name} PASS`);
const blocked = (name: string) => {
  console.log(`PG17_PROBE ${name} BLOCKED`);
  process.exitCode = 1;
};

if (!connectionString) {
  blocked("configuration");
} else {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 15000,
    query_timeout: 15000,
  });

  const expectDenied = async (name: string, sql: string) => {
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("ROLLBACK");
      blocked(name);
    } catch (error: unknown) {
      try { await client.query("ROLLBACK"); } catch {}
      if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "42501") stage(name);
      else blocked(name);
    }
  };

  try {
    await client.connect();
    const tls = (await client.query("SELECT ssl, cipher FROM pg_stat_ssl WHERE pid=pg_backend_pid()")).rows[0];
    if (tls?.ssl === true && typeof tls.cipher === "string" && tls.cipher.length > 0) stage("tls");
    else throw new Error("tls");

    const session = (await client.query("SELECT session_user, current_user")).rows[0];
    if (session?.session_user === "syntrake_g3_preview_reader" || session?.session_user === "syntrake_g3_preview_reader.gehlmcjctcfdbtzlyswm") stage("login");
    else throw new Error("login");

    await client.query("SET ROLE market_core_reader");
    const role = (await client.query("SELECT current_user")).rows[0];
    if (role?.current_user === "market_core_reader") stage("set-role");
    else throw new Error("set-role");

    await client.query("SELECT 1 FROM market_core.license_policies LIMIT 1");
    stage("select");

    await client.query(
      "SELECT * FROM market_core.read_market_history($1,$2::date,$3::date,$4::timestamptz,$5,$6)",
      [fakeListing, "2026-01-01", "2026-01-01", "2026-01-02T00:00:00Z", "1day", "none"],
    );
    stage("read-market-history");

    await expectDenied("insert", "INSERT INTO market_core.market_observations DEFAULT VALUES");
    await expectDenied("update", "UPDATE market_core.market_observations SET listing_id=listing_id WHERE false");
    await expectDenied("delete", "DELETE FROM market_core.market_observations WHERE false");
  } catch {
    blocked("connection-or-query");
  } finally {
    try { await client.end(); } catch {}
  }
}

void main();
