/**
 * R3-C OFFLINE demonstration only: claim -> injected fake provider -> runtime
 * validation -> append-only R3-B revision -> atomic ACK/credit accounting.
 *
 * This is NOT a public route, scheduler, Twelve Data integration or approved
 * production worker. The test database connection is privileged for fixtures;
 * no permissions, real API keys, network calls or billing are granted here.
 */
import { createHash, randomUUID } from "node:crypto";
import type { Client } from "pg";
import { validateEnvelope } from "./contracts";
import type { DailyCandle } from "./twelveData";

type Claimed = Readonly<{
  job_id: string;
  demand_key: string;
  listing_id: string;
  provider_id: string;
  rights_policy_id: string;
  provider_key: string;
  estimated_credits: string;
  valid_from: string;
  valid_to: string | null;
}>;
export type OfflineProvider = (claim: Claimed) => Promise<unknown>;
export type OfflineResult =
  | Readonly<{ state: "NO_WORK" }>
  | Readonly<{ state: "COMMITTED"; jobId: string; observationId: string; revisionId: string }>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = /^\d{4}-\d{2}-\d{2}$/;
const price = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/;
const volume = /^(?:0|[1-9]\d{0,23})$/;
function scaled(value: string): bigint {
  const [whole, fractional = ""] = value.split(".");
  return BigInt(whole) * 1_000_000_000_000n + BigInt(fractional.padEnd(12, "0"));
}
function candleValid(value: unknown): value is DailyCandle {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const x = value as Record<string, unknown>;
  if (typeof x.marketDate !== "string" || !day.test(x.marketDate) ||
    !Number.isFinite(Date.parse(x.marketDate + "T00:00:00Z")) ||
    new Date(x.marketDate + "T00:00:00Z").toISOString().slice(0, 10) !== x.marketDate) return false;
  if (![x.open, x.high, x.low, x.close].every(v => typeof v === "string" && price.test(v))) return false;
  if (x.volume !== null && (typeof x.volume !== "string" || !volume.test(x.volume))) return false;
  const [o,h,l,c] = [x.open,x.high,x.low,x.close].map(v => scaled(v as string));
  return l > 0n && o >= l && o <= h && c >= l && c <= h;
}
function parseEnvelope(raw: unknown) {
  const result = validateEnvelope<readonly DailyCandle[]>(raw,
    (value): value is readonly DailyCandle[] => Array.isArray(value) &&
      value.length === 1 && value.every(candleValid));
  if (result.status !== "AVAILABLE" || result.value.length !== 1) {
    throw new Error("OFFLINE_PROVIDER_NOT_AVAILABLE");
  }
  return { ...result, status: "AVAILABLE" as const, value: result.value };
}

/**
 * A single explicitly injected fake provider and one claim. No sleep, polling,
 * environment secrets or external HTTP. The database is a disposable PG17.
 *
 * Claim reserves credits before calling the fake provider; invalid responses
 * leave the leased job for bounded lease recovery, without a false ACK.
 * Revision insertion and successful ACK are one PostgreSQL transaction.
 */
export async function runOfflineIngestOnce(input: Readonly<{
  db: Client;
  provider: OfflineProvider;
  workerId: string;
  leaseToken: string;
  runId: string;
  providerRunKey: string;
  consumedCredits: string;
  exchangeTimezone: string;
}>): Promise<OfflineResult> {
  const { db } = input;
  if (typeof input.provider !== "function" ||
    ![input.leaseToken, input.runId].every(x => uuid.test(x)) ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(input.workerId) ||
    !/^[A-Za-z0-9_-]{1,80}$/.test(input.providerRunKey) ||
    typeof input.exchangeTimezone !== "string" || input.exchangeTimezone.length > 70 ||
    !/^(?:0|[1-9]\d{0,12})(?:\.\d{1,6})?$/.test(input.consumedCredits)) {
    throw new Error("INVALID_OFFLINE_WORK");
  }

  try { new Intl.DateTimeFormat("en-US", { timeZone: input.exchangeTimezone }); }
  catch { throw new Error("INVALID_EXCHANGE_TIMEZONE"); }

  const claim = await db.query<{ job_id: string }>(
    "SELECT job_id FROM market_core.claim_ingest_job($1,$2,clock_timestamp(),interval '5 minutes')",
    [input.workerId, input.leaseToken],
  );
  if (claim.rows.length === 0) return { state: "NO_WORK" };

  const jobId = claim.rows[0].job_id;
  const result = await db.query<Claimed>(
    `SELECT j.job_id, j.demand_key, j.listing_id, j.provider_id,
            j.rights_policy_id, j.estimated_credits::text, p.provider_key,
            l.valid_from::text, l.valid_to::text
       FROM market_core.ingest_jobs j
       JOIN market_core.providers p USING (provider_id)
       JOIN market_core.listings l USING (listing_id)
      WHERE j.job_id=$1`, [jobId]);
  const job = result.rows[0];
  if (!job) throw new Error("OFFLINE_JOB_MISSING");

  const envelope = parseEnvelope(await input.provider(job));
  if (envelope.sourceRefs.every(s => s.provider !== job.provider_key) ||
      envelope.rights.policyId !== job.rights_policy_id ||
      envelope.marketDate !== envelope.value[0].marketDate ||
      envelope.value[0].marketDate < job.valid_from ||
      (job.valid_to !== null && envelope.value[0].marketDate >= job.valid_to)) {
    throw new Error("OFFLINE_SOURCE_IDENTITY_MISMATCH");
  }
  const c = envelope.value[0];
  const sourceRevision = createHash("sha256").update(JSON.stringify({
    provider: job.provider_id, listing: job.listing_id,
    marketDate: c.marketDate, adjustment: "none", candle: c,
    sourceRefs: envelope.sourceRefs,
  })).digest("hex");
  // A real adapter has to validate/reconcile actual provider credit usage.
  // Here the cost is explicitly synthetic and bounded by the claim reservation.
  await db.query("BEGIN");
  try {
    const time = await db.query<{ now: Date }>("SELECT clock_timestamp() AS now");
    const now = time.rows[0].now.valueOf();
    if ([envelope.firstSeenAt, envelope.ingestedAt, envelope.asKnownAt].some(x => Date.parse(x) > now) ||
        (envelope.rights.retentionUntil !== null && Date.parse(envelope.rights.retentionUntil) <= now)) {
      throw new Error("OFFLINE_DATA_FUTURE_OR_EXPIRED");
    }
    const rights = await db.query<{ cache_allowed: boolean; retention_until: Date | null }>(
      "SELECT cache_allowed, retention_until FROM market_core.license_policies WHERE rights_policy_id=$1",
      [job.rights_policy_id]);
    if (!rights.rows[0]?.cache_allowed ||
        (rights.rows[0].retention_until !== null && rights.rows[0].retention_until.valueOf() <= now)) {
      throw new Error("OFFLINE_CACHE_RIGHTS_DENIED");
    }
    const observationId = randomUUID();
    await db.query(
      `INSERT INTO market_core.market_observations
       (observation_id, listing_id, provider_id, rights_policy_id, interval,
        market_date, exchange_timezone, adjustment, created_at)
       VALUES ($1,$2,$3,$4,'1day',$5,$6,'none',clock_timestamp())
       ON CONFLICT (listing_id, provider_id, interval, market_date, adjustment) DO NOTHING`,
      [observationId, job.listing_id, job.provider_id, job.rights_policy_id, c.marketDate, input.exchangeTimezone],
    );
    const obs = await db.query<{ observation_id: string; rights_policy_id: string }>(
      `SELECT observation_id, rights_policy_id FROM market_core.market_observations
        WHERE listing_id=$1 AND provider_id=$2 AND interval='1day'
          AND market_date=$3 AND adjustment='none'`,
      [job.listing_id, job.provider_id, c.marketDate],
    );
    if (obs.rows.length !== 1 || obs.rows[0].rights_policy_id !== job.rights_policy_id) {
      throw new Error("OFFLINE_OBSERVATION_RIGHTS_CONFLICT");
    }
    const savedObservationId = obs.rows[0].observation_id;
    const revisionId = randomUUID();
    await db.query(
      `INSERT INTO market_core.market_observation_revisions
       (revision_id, observation_id, listing_id, source_revision,
        open_value, high_value, low_value, close_value, volume_value,
        first_seen_at, ingested_at, as_known_at, quality_flags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (observation_id, source_revision) DO NOTHING`,
      [revisionId, savedObservationId, job.listing_id, sourceRevision,
        c.open, c.high, c.low, c.close, c.volume,
        envelope.firstSeenAt, envelope.ingestedAt, envelope.asKnownAt,
        [...envelope.quality.flags]],
    );
    const rev = await db.query<{ revision_id: string }>(
      `SELECT revision_id FROM market_core.market_observation_revisions
        WHERE observation_id=$1 AND source_revision=$2`, [savedObservationId, sourceRevision]);
    if (rev.rows.length !== 1) throw new Error("OFFLINE_REVISION_UNAVAILABLE");
    const savedRevisionId = rev.rows[0].revision_id;
    const ack = await db.query<{ ok: boolean }>(
      `SELECT market_core.complete_ingest_job($1,$2,$3,$4,$5,$6::numeric) AS ok`,
      [jobId, input.leaseToken, input.runId, input.providerRunKey, savedRevisionId, input.consumedCredits],
    );
    if (ack.rows[0]?.ok !== true) throw new Error("OFFLINE_ACK_REJECTED");
    await db.query("COMMIT");
    return { state: "COMMITTED", jobId, observationId: savedObservationId, revisionId: savedRevisionId };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}
