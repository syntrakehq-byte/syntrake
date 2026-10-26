import { Pool, type PoolClient } from "pg";
import { z } from "zod";
import { requireVerifiedClerkActor } from "./requireVerifiedClerkActor";
import type { Actor } from "../contracts";

const draftInput = z.object({
  accountId: z.string().uuid(),
  revisionId: z.string().min(1).max(160),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{15,127}$/),
  payload: z.record(z.string(), z.unknown()),
}).strict();

const applyInput = z.object({
  accountId: z.string().uuid(),
  portfolioId: z.string().uuid(),
  revisionId: z.string().min(1).max(160),
  expectedVersion: z.number().int().nonnegative(),
}).strict();

const abandonInput = z.object({
  accountId: z.string().uuid(),
  revisionId: z.string().min(1).max(160),
}).strict();

export type Pg6Database = Pick<Pool, "connect">;
export type Pg6RuntimeEnv = Readonly<Record<string, string | undefined>>;
const PG6_LOGIN_ROLE = "bl2proof_pg6_login";

/**
 * Dedicated server-only PG6 pool factory. It is disabled unless explicitly
 * enabled by a trusted server operator and never accepts a DSN from input.
 */
export function makePg6Pool(env: Pg6RuntimeEnv): Pool {
  if (env.SYNTRAKE_PG6_ENABLED !== "enabled" || env.VERCEL_ENV === "production") {
    throw new Error("PG6_NOT_AUTHORIZED");
  }
  const raw = env.SYNTRAKE_PG6_DATABASE_URL;
  if (!raw || raw.length > 2048) throw new Error("PG6_NOT_CONFIGURED");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("PG6_NOT_CONFIGURED"); }
  if (url.protocol !== "postgresql:" || !url.hostname || !url.pathname || url.search || url.hash || !url.password) {
    throw new Error("PG6_NOT_CONFIGURED");
  }
  if (decodeURIComponent(url.username) !== PG6_LOGIN_ROLE) throw new Error("PG6_DEDICATED_ROLE_REQUIRED");
  const ca = env.SYNTRAKE_PG6_PG_CA_PEM?.replace(/\\n/g, "\n");
  if (!ca?.includes("-----BEGIN CERTIFICATE-----") || !ca.includes("-----END CERTIFICATE-----")) {
    throw new Error("PG6_TLS_NOT_CONFIGURED");
  }
  return new Pool({ connectionString: raw, ssl: { ca, rejectUnauthorized: true }, max: 2, connectionTimeoutMillis: 3000, idleTimeoutMillis: 2000, allowExitOnIdle: true });
}

async function withPg6Transaction<T>(database: Pg6Database, fn: (client: PoolClient, actor: Actor) => Promise<T>): Promise<T> {
  const actor = await requireVerifiedClerkActor();
  const client = await database.connect();
  let open = false;
  let broken = false;
  try {
    await client.query("BEGIN"); open = true;
    await client.query("SET LOCAL ROLE bl2proof_runtime");
    const role = await client.query<{ role: string }>("SELECT current_user AS role");
    if (role.rows[0]?.role !== "bl2proof_runtime") throw new Error("PG6_RUNTIME_ROLE_NOT_ACTIVE");
    await client.query("SELECT set_config('lock_timeout','1500ms',true), set_config('statement_timeout','5000ms',true), set_config('idle_in_transaction_session_timeout','7000ms',true)");
    await client.query("SELECT set_config('bl2proof.actor_user_id',$1,true)", [actor.userId]);
    const result = await fn(client, actor);
    await client.query("COMMIT"); open = false;
    return result;
  } catch (error) {
    if (open) { try { await client.query("ROLLBACK"); } catch { broken = true; } }
    throw error;
  } finally { client.release(broken); }
}

export async function createPg6DraftFromClerk(database: Pg6Database, input: unknown): Promise<string> {
  const request = draftInput.parse(input);
  return withPg6Transaction(database, async (client, actor) => {
    const payload = JSON.stringify(request.payload);
    const hash = await client.query<{ hash: string }>("SELECT bl2proof.canonical_sha256($1::jsonb) AS hash", [payload]);
    const result = await client.query<{ create_draft: string }>(
      "SELECT bl2proof.create_draft($1,$2,$3,$4,$5::jsonb,$6) AS create_draft",
      [request.accountId, request.revisionId, actor.userId, request.idempotencyKey, payload, hash.rows[0].hash],
    );
    return result.rows[0].create_draft;
  });
}

export async function applyPg6RevisionFromClerk(database: Pg6Database, input: unknown): Promise<void> {
  const request = applyInput.parse(input);
  await withPg6Transaction(database, async (client, actor) => {
    await client.query("SELECT bl2proof.apply_revision($1,$2,$3,$4,$5,false)", [request.accountId, request.portfolioId, request.revisionId, actor.userId, request.expectedVersion]);
  });
}

export async function abandonPg6RevisionFromClerk(database: Pg6Database, input: unknown): Promise<string> {
  const request = abandonInput.parse(input);
  return withPg6Transaction(database, async (client, actor) => {
    const result = await client.query<{ abandon_revision: string }>("SELECT bl2proof.abandon_revision($1,$2,$3) AS abandon_revision", [request.accountId, request.revisionId, actor.userId]);
    return result.rows[0].abandon_revision;
  });
}
