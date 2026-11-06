import type { Client } from "pg";
import {
  historicalRowsToResult,
  type HistoricalMarketDataRequest,
  type HistoricalMarketDataResult,
} from "./contracts";

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

type Rights = Readonly<{
  rights_policy_id: string;
  cache_allowed: boolean;
  display_allowed: boolean;
  retention_until: Date | null;
}>;

/**
 * Private Market Data Core history read. Both Investing and Trading may consume
 * this SAME PIT snapshot for non-display computations; no browser endpoint,
 * no provider HTTP calls and no price caching in a frontend. Access to stored
 * market observations is controlled by the restricted market_core_reader role.
 */
export type SharedInternalHistory = Readonly<{
  status: "AVAILABLE" | "UNAVAILABLE" | "LICENSE_BLOCKED";
  rightsPolicyId: string;
  displayAllowed: boolean;
  retentionUntil: string | null;
  history: HistoricalMarketDataResult | null;
}>;

export async function loadSharedInternalMarketHistory(input: Readonly<{
  readerFactory: () => Promise<Client>;
  request: HistoricalMarketDataRequest;
  providerId: string;
  rightsPolicyId: string;
}>): Promise<SharedInternalHistory> {
  const q = input.request;
  if (!q || !UUID.test(q.listingId) || !UUID.test(input.providerId) ||
      !UUID.test(input.rightsPolicyId) ||
      !DATE.test(q.startDate) || !DATE.test(q.endDate) ||
      q.startDate > q.endDate || !UTC.test(q.asOf) ||
      Number.isNaN(Date.parse(q.asOf)) || q.interval !== "1day" ||
      q.adjustment !== "none") throw new Error("G3_INTERNAL_HISTORY_INVALID_REQUEST");

  const db = await input.readerFactory();
  try {
    await db.connect();
    await db.query("SET ROLE market_core_reader");
    // For the Basic internal non-display slice, NULL retention is not proof
    // of perpetual storage rights. The DB clock is authoritative.
    const rights = (await db.query<Rights>(`
      SELECT rights_policy_id::text, cache_allowed, display_allowed, retention_until
      FROM market_core.license_policies
      WHERE rights_policy_id=$1::uuid
        AND cache_allowed=true
        AND retention_until IS NOT NULL
        AND retention_until > clock_timestamp()
    `, [input.rightsPolicyId])).rows;
    if (rights.length !== 1) {
      return {status:"LICENSE_BLOCKED",rightsPolicyId:input.rightsPolicyId,
        displayAllowed:false,retentionUntil:null,history:null};
    }
    const policy=rights[0];
    const until=policy.retention_until?.toISOString() ?? null;
    if (!until || Date.parse(until) <= Date.now()) {
      return {status:"LICENSE_BLOCKED",rightsPolicyId:input.rightsPolicyId,
        displayAllowed:false,retentionUntil:null,history:null};
    }
    // Private purpose-specific read. The public read_market_history function
    // intentionally requires display rights and must NOT be weakened.
    const rows=(await db.query(`
      SELECT DISTINCT ON (o.market_date)
        o.listing_id::text AS listing_id,
        l.instrument_id::text AS instrument_id,
        o.provider_id::text AS provider_id,
        o.rights_policy_id::text AS rights_policy_id,
        btrim(l.trading_currency) AS currency,
        o.interval AS bar_interval, o.adjustment,
        o.market_date, 'AVAILABLE'::text AS status,
        r.revision_id::text AS revision_id,
        r.close_value::text AS close_value,
        r.as_known_at AS as_known_at,
        r.source_revision,
        r.quality_flags
      FROM market_core.market_observations o
      JOIN market_core.market_observation_revisions r
        ON r.observation_id=o.observation_id
       AND r.listing_id=o.listing_id
      JOIN market_core.listings l ON l.listing_id=o.listing_id
      WHERE o.listing_id=$1::uuid AND o.provider_id=$2::uuid
        AND o.rights_policy_id=$3::uuid
        AND o.interval='1day' AND o.adjustment='none'
        AND o.market_date BETWEEN $4::date AND $5::date
        AND r.as_known_at <= $6::timestamptz
        AND EXISTS (
          SELECT 1 FROM market_core.license_policies lp
          WHERE lp.rights_policy_id=o.rights_policy_id
            AND lp.cache_allowed AND lp.retention_until > clock_timestamp()
        )
      ORDER BY o.market_date, r.as_known_at DESC, r.revision_id DESC
    `,[q.listingId,input.providerId,input.rightsPolicyId,q.startDate,q.endDate,q.asOf])).rows;
    const history=historicalRowsToResult(q,rows);
    return {
      status:history.status==="AVAILABLE"?"AVAILABLE":"UNAVAILABLE",
      rightsPolicyId:input.rightsPolicyId,
      displayAllowed:policy.display_allowed,
      retentionUntil:until,
      history:history.status==="AVAILABLE"?history:null,
    };
  } finally {
    await db.end().catch(()=>{});
  }
}

/** Select an already materialized snapshot without triggering another provider call. */
export function selectHistoryForMarketCore(input: Readonly<{
  source: SharedInternalHistory;
  consumer: "INVESTING" | "TRADING";
  requiresDisplay: boolean;
  expectedRightsPolicyId: string;
  interval: "1day" | "1hour" | "1min";
  now?: Date;
}>): HistoricalMarketDataResult | null {
  const {source} = input;
  const now=input.now ?? new Date();
  if (!(now instanceof Date) || Number.isNaN(now.valueOf()) ||
      source.status!=="AVAILABLE" || source.history?.status!=="AVAILABLE" ||
      source.rightsPolicyId!==input.expectedRightsPolicyId ||
      (input.requiresDisplay && !source.displayAllowed) ||
      !source.retentionUntil || Date.parse(source.retentionUntil)<=now.valueOf() ||
      source.history.interval!==input.interval) return null;
  return source.history;
}
