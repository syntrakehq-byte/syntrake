import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import { Client } from "pg";

const urlText = process.env.MARKET_DATA_READER_DATABASE_URL;
const emit = (stage: string, result: "PASS" | "BLOCKED", code = "") =>
  console.log(`PG17_DIAGNOSTIC ${stage} ${result}${code ? ` ${code}` : ""}`);

function codeOf(error: unknown): string {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9_:-]{2,32}$/.test(code)) return code;
    const name = (error as { name?: unknown }).name;
    if (name === "Error" && code === "ENOTFOUND") return "DNS_ENOTFOUND";
    if (typeof name === "string" && /^[A-Za-z0-9_]{2,24}$/.test(name)) return name.toUpperCase();
  }
  return "UNKNOWN";
}

async function main() {
  if (!urlText) {
    emit("configuration", "BLOCKED", "MISSING_URL");
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(urlText);
    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") throw new Error("PROTOCOL");
    if (!parsed.hostname || !parsed.username) throw new Error("IDENTITY");
    emit("configuration", "PASS");
  } catch (error) {
    emit("configuration", "BLOCKED", codeOf(error));
    return;
  }

  try {
    await dns.lookup(parsed.hostname);
    emit("dns", "PASS");
  } catch (error) {
    emit("dns", "BLOCKED", codeOf(error));
    return;
  }

  await new Promise<void>((resolve) => {
    const socket = net.connect({ host: parsed.hostname, port: Number(parsed.port || 5432) });
    const done = (result: "PASS" | "BLOCKED", code?: string) => {
      socket.destroy();
      emit("tcp", result, code);
      resolve();
    };
    socket.setTimeout(10000, () => done("BLOCKED", "TIMEOUT"));
    socket.once("connect", () => done("PASS"));
    socket.once("error", (error) => done("BLOCKED", codeOf(error)));
  });

  await new Promise<void>((resolve) => {
    const socket = tls.connect({
      host: parsed.hostname,
      port: Number(parsed.port || 5432),
      servername: parsed.hostname,
      rejectUnauthorized: true,
    });
    const done = (result: "PASS" | "BLOCKED", code?: string) => {
      socket.destroy();
      emit("tls", result, code);
      resolve();
    };
    socket.setTimeout(10000, () => done("BLOCKED", "TIMEOUT"));
    socket.once("secureConnect", () => socket.authorized ? done("PASS") : done("BLOCKED", "CERT_UNAUTHORIZED"));
    socket.once("error", (error) => done("BLOCKED", codeOf(error)));
  });

  const client = new Client({
    connectionString: urlText,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 15000,
    query_timeout: 15000,
  });

  try {
    await client.connect();
    emit("authentication", "PASS");
    const identity = (await client.query("SELECT session_user, current_user")).rows[0];
    if (identity?.session_user === "syntrake_g3_preview_reader" ||
        identity?.session_user === "syntrake_g3_preview_reader.gehlmcjctcfdbtzlyswm") emit("login-identity", "PASS");
    else emit("login-identity", "BLOCKED", "UNEXPECTED_ROLE");

    try {
      await client.query("SET ROLE market_core_reader");
      emit("set-role", "PASS");
    } catch (error) {
      emit("set-role", "BLOCKED", codeOf(error));
    }

    try {
      await client.query("SELECT 1 FROM market_core.license_policies LIMIT 1");
      emit("select", "PASS");
    } catch (error) {
      emit("select", "BLOCKED", codeOf(error));
    }

    try {
      await client.query(
        "SELECT * FROM market_core.read_market_history($1,$2::date,$3::date,$4::timestamptz,$5,$6)",
        ["00000000-0000-0000-0000-000000000000", "2026-01-01", "2026-01-01", "2026-01-02T00:00:00Z", "1day", "none"],
      );
      emit("historical-function", "PASS");
    } catch (error) {
      emit("historical-function", "BLOCKED", codeOf(error));
    }

    for (const [stage, sql] of [
      ["insert-denied", "INSERT INTO market_core.market_observations DEFAULT VALUES"],
      ["update-denied", "UPDATE market_core.market_observations SET listing_id=listing_id WHERE false"],
      ["delete-denied", "DELETE FROM market_core.market_observations WHERE false"],
    ] as const) {
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("ROLLBACK");
        emit(stage, "BLOCKED", "WRITE_ALLOWED");
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch {}
        emit(stage, error && typeof error === "object" && (error as { code?: string }).code === "42501" ? "PASS" : "BLOCKED", codeOf(error));
      }
    }
  } catch (error) {
    emit("authentication", "BLOCKED", codeOf(error));
  } finally {
    try { await client.end(); } catch {}
  }
}

void main();
