import { createMarketReaderClient } from "../market-data-core/pgReaderTls";

let step = "configuration";
const ok = (name: string) => console.log("G3_PG17_PROBE " + name + " PASS");
const errorCode = (e: unknown) => {
  const code = typeof e === "object" && e !== null && "code" in e ? String((e as {code?:unknown}).code) : "UNKNOWN";
  return /^[a-z0-9_]{1,40}$/i.test(code) ? code : "UNKNOWN";
};
async function main() {
  if (process.env.VERCEL_ENV !== "preview" ||
      process.env.VERCEL_GIT_COMMIT_REF !== "feat/g3e-integrated-rehearsal-20261106" ||
      process.env.MARKET_DATA_G3C_MODE === "enabled") {
    throw new Error("NOT_ALLOWED_ENVIRONMENT");
  }
  const client = createMarketReaderClient(process.env);
  try {
    step = "tls_login";
    await client.connect();
    const tls = (await client.query("SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()")).rows[0];
    if (tls?.ssl !== true) throw new Error("TLS_NOT_ACTIVE");
    ok("tls");

    step = "identity";
    const id = (await client.query("SELECT session_user, current_user")).rows[0];
    if (id.session_user !== "syntrake_g3_preview_reader") throw new Error("WRONG_LOGIN");
    ok("login");

    step = "role";
    await client.query("SET ROLE market_core_reader");
    if ((await client.query("SELECT current_user")).rows[0]?.current_user !== "market_core_reader") throw new Error("WRONG_ROLE");
    ok("set_role");

    step = "read";
    await client.query("SELECT 1 FROM market_core.license_policies LIMIT 1");
    ok("select");

    step = "history";
    await client.query("SELECT * FROM market_core.read_market_history($1,$2::date,$3::date,$4::timestamptz,$5,$6)", [
      "00000000-0000-0000-0000-000000000000", "2026-01-01", "2026-01-31", "2026-02-01T00:00:00Z", "1day", "none",
    ]);
    ok("history");

    for (const [label, sql] of [
      ["insert", "INSERT INTO market_core.market_observations DEFAULT VALUES"],
      ["update", "UPDATE market_core.market_observations SET listing_id=listing_id WHERE false"],
      ["delete", "DELETE FROM market_core.market_observations WHERE false"],
    ]) {
      step = label;
      await client.query("BEGIN");
      let rejected = false;
      try { await client.query(sql); }
      catch (e) { if (errorCode(e) === "42501") rejected = true; else throw e; }
      finally { await client.query("ROLLBACK"); }
      if (!rejected) throw new Error("WRITE_NOT_DENIED");
      ok(label + "_denied");
    }
  } finally {
    await client.end().catch(() => {});
  }
}
main().catch((e) => {
  console.error("G3_PG17_PROBE BLOCKED step=" + step + " code=" + errorCode(e));
  process.exitCode = 1;
});
