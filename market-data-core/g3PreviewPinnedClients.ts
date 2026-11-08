import type { Client } from "pg";
import { createMarketReaderClient } from "./pgReaderTls";

type Env = Readonly<Record<string, string | undefined>>;
const PREVIEW_DB_HOST = "aws-1-eu-west-3.pooler.supabase.com";
const LOGINS = {
  reader: "syntrake_g3_preview_reader",
  ingest: "syntrake_g3_preview_ingest",
} as const;

/**
 * Both G3-G connections must terminate at the known, separate Supabase Preview
 * database with an official CA and full TLS hostname verification.
 * Never accept the production DSN, an arbitrary host or a service_role URL.
 */
export function createG3PreviewClient(env: Env, kind: "reader" | "ingest"): Client {
  const raw = kind === "reader" ? env.MARKET_DATA_READER_DATABASE_URL : env.G3G_INGEST_DATABASE_URL;
  const ca = env.MARKET_DATA_READER_CA_PEM;
  if (!raw || !ca) throw new Error("G3G_DB_NOT_CONFIGURED");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("G3G_DB_NOT_CONFIGURED"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) ||
      url.hostname !== PREVIEW_DB_HOST ||
      decodeURIComponent(url.username) !== LOGINS[kind] ||
      url.pathname !== "/postgres" ||
      (url.port !== "" && url.port !== "5432") ||
      url.password.length < 16 ||
      url.hash !== "") {
    throw new Error("G3G_DB_TARGET_REJECTED");
  }
  return createMarketReaderClient({
    MARKET_DATA_READER_DATABASE_URL: raw,
    MARKET_DATA_READER_CA_PEM: ca,
  });
}
