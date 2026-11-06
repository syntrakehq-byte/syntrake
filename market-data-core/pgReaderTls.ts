import { Client } from "pg";

type DbEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Build the restricted PostgreSQL reader with explicit certificate authority
 * and host verification. Never put credentials or the CA in client bundles.
 */
export function createMarketReaderClient(env: DbEnvironment): Client {
  const raw = env.MARKET_DATA_READER_DATABASE_URL;
  const ca = env.MARKET_DATA_READER_CA_PEM;
  if (!raw || !ca || !ca.includes("-----BEGIN CERTIFICATE-----")) {
    throw new Error("INVALID_CONFIGURATION");
  }
  const url = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("INVALID_CONFIGURATION");
  }
  // pg-connection-string overrides Client.ssl when sslmode or sslrootcert
  // are present in a connection string. Always supply explicit TLS options.
  for (const key of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) {
    url.searchParams.delete(key);
  }
  return new Client({
    connectionString: url.toString(),
    ssl: { ca, rejectUnauthorized: true, servername: url.hostname },
    connectionTimeoutMillis: 15000,
    query_timeout: 15000,
  });
}
