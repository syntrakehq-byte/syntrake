-- G2-A candidate: one consumer-neutral historical reader over the existing PIT revisions.
CREATE OR REPLACE FUNCTION market_core.read_market_history(
  p_listing_id uuid,
  p_start_date date,
  p_end_date date,
  p_cutoff timestamptz,
  p_interval text,
  p_adjustment text
)
RETURNS TABLE (
  listing_id uuid,
  instrument_id uuid,
  provider_id uuid,
  rights_policy_id uuid,
  currency text,
  bar_interval text,
  adjustment text,
  market_date date,
  status text,
  revision_id uuid,
  close_value numeric,
  as_known_at timestamptz,
  source_revision text,
  quality_flags text[]
)
LANGUAGE sql STABLE AS $$
  WITH ranked AS (
    SELECT o.listing_id, l.instrument_id, o.provider_id, o.rights_policy_id, l.trading_currency::text AS currency, o.interval, o.adjustment,
           o.market_date, r.revision_id, r.close_value, r.as_known_at, r.source_revision, r.quality_flags,
           row_number() OVER (PARTITION BY o.observation_id ORDER BY r.as_known_at DESC, r.ingested_at DESC, r.revision_id DESC) AS rn
    FROM market_core.market_observations o
    JOIN market_core.listings l ON l.listing_id = o.listing_id
    JOIN market_core.market_observation_revisions r ON r.observation_id = o.observation_id
    WHERE o.listing_id = p_listing_id
      AND o.market_date BETWEEN p_start_date AND p_end_date
      AND o.interval = p_interval
      AND o.adjustment = p_adjustment
      AND r.first_seen_at <= p_cutoff
      AND r.ingested_at <= p_cutoff
      AND r.as_known_at <= p_cutoff
  )
  SELECT x.listing_id, x.instrument_id, x.provider_id, x.rights_policy_id, x.currency, x.interval, x.adjustment,
         x.market_date,
         CASE WHEN lp.display_allowed AND lp.cache_allowed AND (lp.retention_until IS NULL OR lp.retention_until > p_cutoff) THEN 'AVAILABLE' ELSE 'LICENSE_BLOCKED' END,
         CASE WHEN lp.display_allowed AND lp.cache_allowed AND (lp.retention_until IS NULL OR lp.retention_until > p_cutoff) THEN x.revision_id ELSE NULL END,
         CASE WHEN lp.display_allowed AND lp.cache_allowed AND (lp.retention_until IS NULL OR lp.retention_until > p_cutoff) THEN x.close_value ELSE NULL END,
         x.as_known_at, x.source_revision, x.quality_flags
  FROM ranked x
  JOIN market_core.license_policies lp ON lp.rights_policy_id = x.rights_policy_id
  WHERE x.rn = 1;
$$;
REVOKE ALL ON FUNCTION market_core.read_market_history(uuid,date,date,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION market_core.read_market_history(uuid,date,date,timestamptz,text,text) TO market_core_reader;
