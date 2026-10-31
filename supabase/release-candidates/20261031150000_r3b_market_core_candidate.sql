-- R3-B CANDIDATE ONLY. Disposable PostgreSQL 17 rehearsal target.
-- Never apply remotely. No ledger, portfolio, owner or provider-call capability.
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA market_core;
REVOKE ALL ON SCHEMA market_core FROM PUBLIC;
DO $$ BEGIN CREATE ROLE market_core_reader NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE market_core_ingest NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE market_core.providers (
  provider_id uuid PRIMARY KEY,
  provider_key text NOT NULL UNIQUE CHECK (provider_key ~ '^[A-Z0-9_-]{2,64}$'),
  status text NOT NULL CHECK (status IN ('ACTIVE','DISABLED','REVIEW_REQUIRED'))
);
CREATE TABLE market_core.license_policies (
  rights_policy_id uuid PRIMARY KEY,
  policy_key text NOT NULL UNIQUE,
  cache_allowed boolean NOT NULL DEFAULT false,
  display_allowed boolean NOT NULL DEFAULT false,
  retention_until timestamptz
);
CREATE TABLE market_core.issuers (
  issuer_id uuid PRIMARY KEY,
  legal_name text NOT NULL CHECK (length(legal_name) BETWEEN 1 AND 512)
);
CREATE TABLE market_core.instruments (
  instrument_id uuid PRIMARY KEY,
  issuer_id uuid REFERENCES market_core.issuers(issuer_id),
  asset_class text NOT NULL CHECK (asset_class IN ('EQUITY','ETF','FX')),
  denomination_currency char(3) NOT NULL CHECK (denomination_currency ~ '^[A-Z]{3}$')
);
CREATE TABLE market_core.listings (
  listing_id uuid PRIMARY KEY,
  instrument_id uuid NOT NULL REFERENCES market_core.instruments(instrument_id),
  mic char(4),
  trading_currency char(3) NOT NULL CHECK (trading_currency ~ '^[A-Z]{3}$'),
  ticker text NOT NULL CHECK (ticker ~ '^[A-Z0-9][A-Z0-9.\\-]{0,31}$'),
  valid_from date NOT NULL,
  valid_to date,
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  UNIQUE (listing_id, valid_from)
);
ALTER TABLE market_core.listings ADD CONSTRAINT listings_no_identity_overlap EXCLUDE USING gist (
  instrument_id WITH =, ticker WITH =, (COALESCE(mic, '')) WITH =, trading_currency WITH =,
  daterange(valid_from, valid_to, '[)') WITH &&
);
CREATE TABLE market_core.provider_aliases (
  provider_alias_id uuid PRIMARY KEY,
  provider_id uuid NOT NULL REFERENCES market_core.providers(provider_id),
  provider_reference text NOT NULL CHECK (length(provider_reference) BETWEEN 1 AND 128),
  listing_id uuid NOT NULL REFERENCES market_core.listings(listing_id),
  valid_from date NOT NULL,
  valid_to date,
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);
ALTER TABLE market_core.provider_aliases ADD CONSTRAINT aliases_no_overlap EXCLUDE USING gist (
  provider_id WITH =, provider_reference WITH =, daterange(valid_from, valid_to, '[)') WITH &&
);
CREATE OR REPLACE FUNCTION market_core.validate_alias_window() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE listing_from date; listing_to date;
BEGIN
  SELECT valid_from, valid_to INTO listing_from, listing_to FROM market_core.listings WHERE listing_id = NEW.listing_id;
  IF listing_from IS NULL OR NEW.valid_from < listing_from OR (listing_to IS NOT NULL AND (NEW.valid_to IS NULL OR NEW.valid_to > listing_to)) THEN
    RAISE EXCEPTION 'provider alias window must be contained in listing window';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER provider_alias_window BEFORE INSERT OR UPDATE ON market_core.provider_aliases FOR EACH ROW EXECUTE FUNCTION market_core.validate_alias_window();

-- Stable series/session identity. Prices live only in immutable revisions.
CREATE TABLE market_core.market_observations (
  observation_id uuid PRIMARY KEY,
  listing_id uuid NOT NULL REFERENCES market_core.listings(listing_id),
  provider_id uuid NOT NULL REFERENCES market_core.providers(provider_id),
  rights_policy_id uuid NOT NULL REFERENCES market_core.license_policies(rights_policy_id),
  interval text NOT NULL CHECK (interval = '1day'),
  market_date date NOT NULL,
  exchange_timezone text NOT NULL,
  adjustment text NOT NULL CHECK (adjustment IN ('none','splits','dividends','all')),
  created_at timestamptz NOT NULL,
  UNIQUE (listing_id, provider_id, interval, market_date, adjustment),
  UNIQUE (observation_id, listing_id)
);
CREATE TABLE market_core.market_observation_revisions (
  revision_id uuid PRIMARY KEY,
  observation_id uuid NOT NULL REFERENCES market_core.market_observations(observation_id),
  listing_id uuid NOT NULL,
  supersedes_revision_id uuid,
  source_revision text NOT NULL CHECK (source_revision ~ '^[a-f0-9]{64}$'),
  open_value numeric(30,12) NOT NULL CHECK (open_value > 0),
  high_value numeric(30,12) NOT NULL CHECK (high_value >= open_value),
  low_value numeric(30,12) NOT NULL CHECK (low_value > 0 AND low_value <= open_value),
  close_value numeric(30,12) NOT NULL CHECK (close_value > 0 AND close_value BETWEEN low_value AND high_value),
  volume_value numeric(40,0) CHECK (volume_value IS NULL OR volume_value >= 0),
  first_seen_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL,
  as_known_at timestamptz NOT NULL,
  superseded_at timestamptz,
  quality_flags text[] NOT NULL DEFAULT '{}',
  UNIQUE (observation_id, source_revision),
  UNIQUE (revision_id, observation_id),
  FOREIGN KEY (observation_id, listing_id) REFERENCES market_core.market_observations(observation_id, listing_id),
  FOREIGN KEY (supersedes_revision_id, observation_id) REFERENCES market_core.market_observation_revisions(revision_id, observation_id),
  CHECK (first_seen_at <= ingested_at AND as_known_at <= ingested_at),
  CHECK (superseded_at IS NULL OR superseded_at >= ingested_at)
);
CREATE OR REPLACE FUNCTION market_core.prevent_revision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'market revisions are append-only'; END $$;
CREATE TRIGGER revisions_append_only BEFORE UPDATE OR DELETE ON market_core.market_observation_revisions FOR EACH ROW EXECUTE FUNCTION market_core.prevent_revision_mutation();
CREATE INDEX observations_pit_idx ON market_core.market_observations (listing_id, market_date, observation_id);
CREATE INDEX revisions_pit_idx ON market_core.market_observation_revisions (observation_id, as_known_at DESC);
CREATE OR REPLACE FUNCTION market_core.read_market_pit(p_listing_id uuid, p_cutoff timestamptz)
RETURNS TABLE (market_date date, status text, revision_id uuid, close_value numeric)
LANGUAGE sql STABLE AS $$
  WITH ranked AS (
    SELECT o.market_date, o.rights_policy_id, r.revision_id, r.close_value,
           row_number() OVER (PARTITION BY o.observation_id ORDER BY r.as_known_at DESC, r.ingested_at DESC, r.revision_id DESC) AS rn
    FROM market_core.market_observations o
    JOIN market_core.market_observation_revisions r ON r.observation_id = o.observation_id
    WHERE o.listing_id = p_listing_id
      AND r.first_seen_at <= p_cutoff
      AND r.ingested_at <= p_cutoff
      AND r.as_known_at <= p_cutoff
  )
  SELECT x.market_date,
         CASE WHEN lp.display_allowed AND lp.cache_allowed AND (lp.retention_until IS NULL OR lp.retention_until > p_cutoff) THEN 'AVAILABLE' ELSE 'LICENSE_BLOCKED' END,
         x.revision_id,
         CASE WHEN lp.display_allowed AND lp.cache_allowed AND (lp.retention_until IS NULL OR lp.retention_until > p_cutoff) THEN x.close_value ELSE NULL END
  FROM ranked x JOIN market_core.license_policies lp ON lp.rights_policy_id = x.rights_policy_id
  WHERE x.rn = 1;
$$;
REVOKE ALL ON FUNCTION market_core.read_market_pit(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION market_core.read_market_pit(uuid, timestamptz) TO market_core_reader;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['providers','license_policies','issuers','instruments','listings','provider_aliases','market_observations','market_observation_revisions'] LOOP
    EXECUTE format('ALTER TABLE market_core.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE market_core.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT ON market_core.%I TO market_core_reader', t);
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA market_core TO market_core_reader, market_core_ingest;
GRANT INSERT ON market_core.market_observations, market_core.market_observation_revisions TO market_core_ingest;
CREATE POLICY reader_catalog ON market_core.providers FOR SELECT TO market_core_reader USING (current_user = 'market_core_reader');
CREATE POLICY reader_rights ON market_core.license_policies FOR SELECT TO market_core_reader USING (current_user = 'market_core_reader');
CREATE POLICY reader_issuers ON market_core.issuers FOR SELECT TO market_core_reader USING (current_user = 'market_core_reader');
CREATE POLICY reader_instruments ON market_core.instruments FOR SELECT TO market_core_reader USING (current_user = 'market_core_reader');
CREATE POLICY reader_listings ON market_core.listings FOR SELECT TO market_core_reader USING (current_user = 'market_core_reader');
CREATE POLICY reader_aliases ON market_core.provider_aliases FOR SELECT TO market_core_reader USING (current_user = 'market_core_reader');
CREATE POLICY reader_observations ON market_core.market_observations FOR SELECT TO market_core_reader USING (current_user = 'market_core_reader');
CREATE POLICY reader_revisions ON market_core.market_observation_revisions FOR SELECT TO market_core_reader USING (current_user = 'market_core_reader');
CREATE POLICY ingest_observations ON market_core.market_observations FOR INSERT TO market_core_ingest WITH CHECK (current_user = 'market_core_ingest');
CREATE POLICY ingest_revisions ON market_core.market_observation_revisions FOR INSERT TO market_core_ingest WITH CHECK (current_user = 'market_core_ingest');
