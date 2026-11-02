-- G2-C offline candidate: source-evidenced calendars, no invented sessions.
DO $$ BEGIN CREATE ROLE market_core_calendar_ingest NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE market_core.trading_calendar_revisions (
 calendar_revision_id uuid PRIMARY KEY,
 listing_id uuid NOT NULL REFERENCES market_core.listings(listing_id),
 provider_id uuid NOT NULL REFERENCES market_core.providers(provider_id),
 rights_policy_id uuid NOT NULL REFERENCES market_core.license_policies(rights_policy_id),
 market_date date NOT NULL,
 session_state text NOT NULL CHECK (session_state IN ('OPEN','SHORT_SESSION','CLOSED','HALTED')),
 evidence_state text NOT NULL CHECK (evidence_state IN ('SCHEDULED','SOURCE_CONFIRMED')),
 exchange_timezone text NOT NULL CHECK (length(exchange_timezone) BETWEEN 1 AND 70),
 session_close_at timestamptz,
 source_revision text NOT NULL CHECK (source_revision ~ '^[a-f0-9]{64}$'),
 source_published_at timestamptz NOT NULL,
 first_seen_at timestamptz NOT NULL,
 ingested_at timestamptz NOT NULL,
 as_known_at timestamptz NOT NULL,
 UNIQUE (listing_id,provider_id,market_date,source_revision),
 CHECK ((session_state IN ('OPEN','SHORT_SESSION') AND session_close_at IS NOT NULL) OR
        (session_state IN ('CLOSED','HALTED') AND session_close_at IS NULL)),
 CHECK (source_published_at<=as_known_at AND first_seen_at<=ingested_at AND as_known_at<=ingested_at),
 CHECK (NOT (session_state IN ('OPEN','SHORT_SESSION') AND evidence_state='SOURCE_CONFIRMED')
        OR as_known_at>=session_close_at)
);
CREATE INDEX trading_calendar_pit_idx ON market_core.trading_calendar_revisions
 (listing_id,provider_id,market_date,as_known_at DESC);
CREATE TRIGGER trading_calendar_append_only BEFORE UPDATE OR DELETE ON market_core.trading_calendar_revisions
 FOR EACH ROW EXECUTE FUNCTION market_core.prevent_revision_mutation();
ALTER TABLE market_core.trading_calendar_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_core.trading_calendar_revisions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON market_core.trading_calendar_revisions FROM PUBLIC;
GRANT USAGE ON SCHEMA market_core TO market_core_calendar_ingest;
GRANT INSERT ON market_core.trading_calendar_revisions TO market_core_calendar_ingest;
GRANT SELECT ON market_core.trading_calendar_revisions TO market_core_reader;
CREATE POLICY calendar_reader ON market_core.trading_calendar_revisions FOR SELECT TO market_core_reader
 USING (current_user='market_core_reader');
CREATE POLICY calendar_ingest ON market_core.trading_calendar_revisions FOR INSERT TO market_core_calendar_ingest
 WITH CHECK (current_user='market_core_calendar_ingest');

CREATE OR REPLACE FUNCTION market_core.read_trading_calendar(
 p_listing_id uuid,p_provider_id uuid,p_start_date date,p_end_date date,p_cutoff timestamptz
) RETURNS TABLE (
 listing_id uuid,provider_id uuid,rights_policy_id uuid,market_date date,status text,
 session_state text,evidence_state text,exchange_timezone text,
 session_close_at timestamptz,calendar_revision_id uuid,as_known_at timestamptz,
 source_published_at timestamptz,source_revision text
) LANGUAGE sql STABLE SECURITY INVOKER AS $$
 WITH ranked AS (
   SELECT c.*,row_number() OVER (
     PARTITION BY c.listing_id,c.provider_id,c.market_date
     ORDER BY c.as_known_at DESC,c.ingested_at DESC,c.calendar_revision_id DESC
   ) rn
   FROM market_core.trading_calendar_revisions c
   JOIN market_core.listings l ON l.listing_id=c.listing_id
   WHERE c.listing_id=p_listing_id AND c.provider_id=p_provider_id
     AND c.market_date BETWEEN p_start_date AND p_end_date
     AND c.market_date>=l.valid_from AND (l.valid_to IS NULL OR c.market_date<l.valid_to)
     AND c.source_published_at<=p_cutoff AND c.first_seen_at<=p_cutoff
     AND c.ingested_at<=p_cutoff AND c.as_known_at<=p_cutoff
 )
 SELECT c.listing_id,c.provider_id,c.rights_policy_id,c.market_date,
   CASE WHEN auth.allowed THEN 'AVAILABLE' ELSE 'LICENSE_BLOCKED' END,
   CASE WHEN auth.allowed THEN c.session_state ELSE NULL END,
   CASE WHEN auth.allowed THEN c.evidence_state ELSE NULL END,
   CASE WHEN auth.allowed THEN c.exchange_timezone ELSE NULL END,
   CASE WHEN auth.allowed THEN c.session_close_at ELSE NULL END,
   CASE WHEN auth.allowed THEN c.calendar_revision_id ELSE NULL END,
   CASE WHEN auth.allowed THEN c.as_known_at ELSE NULL END,
   CASE WHEN auth.allowed THEN c.source_published_at ELSE NULL END,
   CASE WHEN auth.allowed THEN c.source_revision ELSE NULL END
 FROM ranked c
 JOIN market_core.license_policies lp ON lp.rights_policy_id=c.rights_policy_id
 CROSS JOIN LATERAL (
   SELECT (lp.display_allowed AND lp.cache_allowed AND
     (lp.retention_until IS NULL OR lp.retention_until>statement_timestamp())) AS allowed
 ) auth
 WHERE c.rn=1
 ORDER BY c.market_date;
$$;
REVOKE ALL ON FUNCTION market_core.read_trading_calendar(uuid,uuid,date,date,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION market_core.read_trading_calendar(uuid,uuid,date,date,timestamptz) TO market_core_reader;
