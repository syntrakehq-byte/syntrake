-- R3-B CANDIDATE ONLY. Never apply to Supabase remote or Production.
-- Disposable PostgreSQL 17 rehearsal target. No ledger, portfolio or owner data.
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA market_core;
REVOKE ALL ON SCHEMA market_core FROM PUBLIC;

DO $$ BEGIN
  CREATE ROLE market_core_reader NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE market_core_ingest NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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
  retention_until timestamptz,
  CHECK (retention_until IS NULL OR retention_until > now())
);
CREATE TABLE market_core.issuers (
  issuer_id uuid PRIMARY KEY,
  legal_name text NOT NULL CHECK (length(legal_name) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE market_core.instruments (
  instrument_id uuid PRIMARY KEY,
  issuer_id uuid REFERENCES market_core.issuers(issuer_id),
  asset_class text NOT NULL CHECK (asset_class IN ('EQUITY','ETF','FX')),
  denomination_currency char(3) NOT NULL CHECK (denomination_currency ~ '^[A-Z]{3}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
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
ALTER TABLE market_core.listings ADD CONSTRAINT listings_no_overlapping_identity EXCLUDE USING gist (
  instrument_id WITH =, ticker WITH =, COALESCE(mic, '') WITH =, trading_currency WITH =,
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
CREATE TABLE market_core.market_observations (
  observation_id uuid PRIMARY KEY,
  listing_id uuid NOT NULL REFERENCES market_core.listings(listing_id),
  provider_id uuid NOT NULL REFERENCES market_core.providers(provider_id),
  rights_policy_id uuid NOT NULL REFERENCES market_core.license_policies(rights_policy_id),
  interval text NOT NULL CHECK (interval = '1day'),
  market_date date NOT NULL,
  exchange_timezone text NOT NULL,
  adjustment text NOT NULL CHECK (adjustment IN ('none','splits','dividends','all')),
  open_value numeric(30,12) NOT NULL CHECK (open_value > 0),
  high_value numeric(30,12) NOT NULL CHECK (high_value >= open_value),
  low_value numeric(30,12) NOT NULL CHECK (low_value > 0 AND low_value <= open_value),
  close_value numeric(30,12) NOT NULL CHECK (close_value > 0 AND close_value BETWEEN low_value AND high_value),
  volume_value numeric(40,0) CHECK (volume_value IS NULL OR volume_value >= 0),
  first_seen_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL,
  as_known_at timestamptz NOT NULL,
  source_revision text NOT NULL CHECK (source_revision ~ '^[a-f0-9]{64}$'),
  quality_flags text[] NOT NULL DEFAULT '{}',
  UNIQUE (listing_id, provider_id, interval, market_date, adjustment, source_revision)
);
CREATE TABLE market_core.market_observation_revisions (
  revision_id uuid PRIMARY KEY,
  observation_id uuid NOT NULL REFERENCES market_core.market_observations(observation_id),
  supersedes_revision_id uuid REFERENCES market_core.market_observation_revisions(revision_id),
  source_revision text NOT NULL CHECK (source_revision ~ '^[a-f0-9]{64}$'),
  first_seen_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL,
  as_known_at timestamptz NOT NULL,
  superseded_at timestamptz,
  UNIQUE (observation_id, source_revision)
);

CREATE INDEX observations_pit_idx ON market_core.market_observations (listing_id, market_date, as_known_at);
CREATE INDEX revisions_pit_idx ON market_core.market_observation_revisions (observation_id, as_known_at);

ALTER TABLE market_core.providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_core.license_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_core.issuers ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_core.instruments ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_core.listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_core.provider_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_core.market_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_core.market_observation_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_core.providers FORCE ROW LEVEL SECURITY;
ALTER TABLE market_core.license_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE market_core.issuers FORCE ROW LEVEL SECURITY;
ALTER TABLE market_core.instruments FORCE ROW LEVEL SECURITY;
ALTER TABLE market_core.listings FORCE ROW LEVEL SECURITY;
ALTER TABLE market_core.provider_aliases FORCE ROW LEVEL SECURITY;
ALTER TABLE market_core.market_observations FORCE ROW LEVEL SECURITY;
ALTER TABLE market_core.market_observation_revisions FORCE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA market_core TO market_core_reader, market_core_ingest;
GRANT SELECT ON ALL TABLES IN SCHEMA market_core TO market_core_reader;
GRANT SELECT, INSERT, UPDATE ON market_core.market_observations, market_core.market_observation_revisions TO market_core_ingest;
CREATE POLICY reader_market_data ON market_core.market_observations FOR SELECT TO market_core_reader USING (current_user = 'market_core_reader');
CREATE POLICY reader_market_revisions ON market_core.market_observation_revisions FOR SELECT TO market_core_reader USING (current_user = 'market_core_reader');
CREATE POLICY ingest_observations ON market_core.market_observations FOR INSERT TO market_core_ingest WITH CHECK (current_user = 'market_core_ingest');
CREATE POLICY ingest_revisions ON market_core.market_observation_revisions FOR INSERT TO market_core_ingest WITH CHECK (current_user = 'market_core_ingest');
