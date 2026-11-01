-- D1 CANDIDATE ONLY. Requires 20261031150000_r3b_market_core_candidate.sql.
-- Disposable PostgreSQL 17 rehearsal target. Never apply remotely.
DO $$ BEGIN CREATE ROLE market_core_catalog_ingest NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE market_core_catalog_reader NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE market_core_registry_reviewer NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE market_core.listings ADD COLUMN IF NOT EXISTS mic_role text;
ALTER TABLE market_core.listings ADD CONSTRAINT listings_mic_role_coherent CHECK ((mic IS NULL AND mic_role IS NULL) OR (mic IS NOT NULL AND mic_role IN ('OPERATING','SEGMENT')));
ALTER TABLE market_core.provider_aliases ADD COLUMN IF NOT EXISTS identifier_type text NOT NULL DEFAULT 'PROVIDER_NATIVE';
ALTER TABLE market_core.provider_aliases ADD COLUMN IF NOT EXISTS identifier_scope text NOT NULL DEFAULT 'LISTING';
ALTER TABLE market_core.provider_aliases ADD CONSTRAINT provider_aliases_type_scope_valid CHECK (
  (identifier_type IN ('PROVIDER_NATIVE','TICKER') AND identifier_scope = 'LISTING')
);

CREATE TABLE market_core.catalog_sources (
  source_id uuid PRIMARY KEY,
  provider_id uuid NOT NULL REFERENCES market_core.providers(provider_id),
  source_key text NOT NULL CHECK (source_key ~ '^[A-Z0-9_-]{2,64}$'),
  catalog_kind text NOT NULL CHECK (catalog_kind IN ('INSTRUMENTS','LISTINGS','IDENTIFIERS')),
  rights_policy_id uuid NOT NULL REFERENCES market_core.license_policies(rights_policy_id),
  storage_allowed boolean NOT NULL,
  sharing_allowed boolean NOT NULL,
  source_uri text,
  created_at timestamptz NOT NULL,
  UNIQUE (provider_id, source_key),
  CHECK (NOT sharing_allowed OR storage_allowed),
  CHECK (source_uri IS NULL OR source_uri ~ '^https://[^\s]+$')
);
CREATE TABLE market_core.catalog_snapshots (
  snapshot_id uuid PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES market_core.catalog_sources(source_id),
  snapshot_version text NOT NULL CHECK (length(snapshot_version) BETWEEN 1 AND 128),
  observed_at timestamptz NOT NULL,
  valid_from date,
  valid_to date,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('RECEIVED','REVIEW_REQUIRED','SUPERSEDED','CONFLICTED')),
  created_at timestamptz NOT NULL,
  UNIQUE (source_id, snapshot_version),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from)
);
CREATE TABLE market_core.catalog_candidates (
  candidate_id uuid PRIMARY KEY,
  snapshot_id uuid NOT NULL REFERENCES market_core.catalog_snapshots(snapshot_id),
  provider_reference text NOT NULL CHECK (length(provider_reference) BETWEEN 1 AND 128),
  provider_identifier_type text NOT NULL CHECK (provider_identifier_type IN ('PROVIDER_NATIVE','TICKER')),
  provider_scope text NOT NULL CHECK (provider_scope IN ('INSTRUMENT','LISTING')),
  issuer_reference text,
  instrument_reference text,
  listing_reference text,
  legal_name text,
  asset_class text CHECK (asset_class IN ('EQUITY','ETF','FX')),
  ticker text,
  mic char(4),
  mic_role text,
  trading_currency char(3),
  denomination_currency char(3),
  valid_from date,
  valid_to date,
  review_state text NOT NULL DEFAULT 'REVIEW_REQUIRED' CHECK (review_state IN ('REVIEW_REQUIRED','REJECTED','ACCEPTED_FOR_REVIEW')),
  created_at timestamptz NOT NULL,
  UNIQUE (snapshot_id, provider_reference, provider_scope),
  CHECK ((mic IS NULL AND mic_role IS NULL) OR (mic IS NOT NULL AND mic_role IN ('OPERATING','SEGMENT'))),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from),
  CHECK (trading_currency IS NULL OR trading_currency ~ '^[A-Z]{3}$'),
  CHECK (denomination_currency IS NULL OR denomination_currency ~ '^[A-Z]{3}$')
);
CREATE TABLE market_core.catalog_candidate_identifiers (
  candidate_identifier_id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES market_core.catalog_candidates(candidate_id),
  identifier_type text NOT NULL CHECK (identifier_type IN ('ISIN','FIGI','CIK','LEI','PROVIDER_NATIVE','TICKER')),
  identifier_value text NOT NULL CHECK (length(identifier_value) BETWEEN 1 AND 128),
  identifier_scope text NOT NULL CHECK (identifier_scope IN ('ISSUER','INSTRUMENT','LISTING')),
  source_id uuid NOT NULL REFERENCES market_core.catalog_sources(source_id),
  snapshot_id uuid NOT NULL REFERENCES market_core.catalog_snapshots(snapshot_id),
  valid_from date,
  valid_to date,
  evidence_kind text NOT NULL CHECK (evidence_kind IN ('PROVIDER_CATALOG','OFFICIAL_REGISTRY','EXCHANGE_REFERENCE','IDENTIFIER_RECORD')),
  evidence_strength text NOT NULL CHECK (evidence_strength IN ('STRONG','SUPPORTING')),
  verified boolean NOT NULL DEFAULT false,
  mic char(4),
  created_at timestamptz NOT NULL,
  UNIQUE (candidate_id, identifier_type, identifier_value, identifier_scope, snapshot_id),
  CHECK ((identifier_type='ISIN' AND identifier_scope='INSTRUMENT') OR (identifier_type='FIGI' AND identifier_scope IN ('INSTRUMENT','LISTING')) OR (identifier_type IN ('CIK','LEI') AND identifier_scope='ISSUER') OR (identifier_type IN ('PROVIDER_NATIVE','TICKER') AND identifier_scope IN ('INSTRUMENT','LISTING'))),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from),
  CHECK (mic IS NULL OR mic ~ '^[A-Z0-9]{4}$')
);
CREATE TABLE market_core.instrument_identifiers (
  identifier_id uuid PRIMARY KEY,
  identifier_type text NOT NULL CHECK (identifier_type IN ('ISIN','FIGI','CIK','LEI','PROVIDER_NATIVE','TICKER')),
  identifier_value text NOT NULL CHECK (length(identifier_value) BETWEEN 1 AND 128),
  identifier_scope text NOT NULL CHECK (identifier_scope IN ('ISSUER','INSTRUMENT','LISTING')),
  issuer_id uuid REFERENCES market_core.issuers(issuer_id),
  instrument_id uuid REFERENCES market_core.instruments(instrument_id),
  listing_id uuid REFERENCES market_core.listings(listing_id),
  source_id uuid NOT NULL REFERENCES market_core.catalog_sources(source_id),
  snapshot_id uuid NOT NULL REFERENCES market_core.catalog_snapshots(snapshot_id),
  valid_from date,
  valid_to date,
  evidence_kind text NOT NULL CHECK (evidence_kind IN ('PROVIDER_CATALOG','OFFICIAL_REGISTRY','EXCHANGE_REFERENCE','IDENTIFIER_RECORD')),
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  UNIQUE (identifier_type, identifier_value, identifier_scope, issuer_id, instrument_id, listing_id, snapshot_id),
  CHECK ((identifier_type IN ('CIK','LEI') AND identifier_scope='ISSUER' AND issuer_id IS NOT NULL AND instrument_id IS NULL AND listing_id IS NULL) OR (identifier_type='ISIN' AND identifier_scope='INSTRUMENT' AND instrument_id IS NOT NULL AND issuer_id IS NULL AND listing_id IS NULL) OR (identifier_type='FIGI' AND identifier_scope='INSTRUMENT' AND instrument_id IS NOT NULL AND issuer_id IS NULL AND listing_id IS NULL) OR (identifier_type='FIGI' AND identifier_scope='LISTING' AND listing_id IS NOT NULL AND issuer_id IS NULL AND instrument_id IS NULL) OR (identifier_type IN ('PROVIDER_NATIVE','TICKER') AND identifier_scope='LISTING' AND listing_id IS NOT NULL AND issuer_id IS NULL AND instrument_id IS NULL)),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from)
);
CREATE TABLE market_core.catalog_review_decisions (
  decision_id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES market_core.catalog_candidates(candidate_id),
  decision text NOT NULL CHECK (decision IN ('REVIEW_REQUIRED','REJECTED','ACCEPTED_FOR_REVIEW')),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z0-9_:-]{2,128}$'),
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  decided_by text NOT NULL CHECK (length(decided_by) BETWEEN 1 AND 128),
  decided_at timestamptz NOT NULL,
  UNIQUE (candidate_id, evidence_hash)
);
CREATE OR REPLACE FUNCTION market_core.validate_catalog_lineage() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=market_core,pg_catalog AS $$
DECLARE candidate_snapshot uuid; snapshot_source uuid;
BEGIN
  SELECT snapshot_id INTO candidate_snapshot FROM market_core.catalog_candidates WHERE candidate_id=NEW.candidate_id;
  SELECT source_id INTO snapshot_source FROM market_core.catalog_snapshots WHERE snapshot_id=candidate_snapshot;
  IF candidate_snapshot IS NULL OR candidate_snapshot <> NEW.snapshot_id OR snapshot_source <> NEW.source_id THEN RAISE EXCEPTION 'catalog evidence lineage mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER catalog_identifier_lineage BEFORE INSERT OR UPDATE ON market_core.catalog_candidate_identifiers FOR EACH ROW EXECUTE FUNCTION market_core.validate_catalog_lineage();
CREATE OR REPLACE FUNCTION market_core.validate_registry_identifier_lineage() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=market_core,pg_catalog AS $$
DECLARE snapshot_source uuid;
BEGIN
  SELECT source_id INTO snapshot_source FROM market_core.catalog_snapshots WHERE snapshot_id=NEW.snapshot_id;
  IF snapshot_source IS NULL OR snapshot_source <> NEW.source_id THEN RAISE EXCEPTION 'registry identifier lineage mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER registry_identifier_lineage BEFORE INSERT OR UPDATE ON market_core.instrument_identifiers FOR EACH ROW EXECUTE FUNCTION market_core.validate_registry_identifier_lineage();
CREATE OR REPLACE FUNCTION market_core.validate_catalog_source_rights() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cache_allowed boolean; display_allowed boolean;
BEGIN
  SELECT lp.cache_allowed, lp.display_allowed INTO cache_allowed, display_allowed FROM market_core.license_policies lp WHERE lp.rights_policy_id=NEW.rights_policy_id;
  IF NOT FOUND OR (NEW.storage_allowed AND NOT cache_allowed) OR (NEW.sharing_allowed AND NOT display_allowed) THEN RAISE EXCEPTION 'catalog rights incompatible'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER catalog_source_rights BEFORE INSERT OR UPDATE ON market_core.catalog_sources FOR EACH ROW EXECUTE FUNCTION market_core.validate_catalog_source_rights();
CREATE OR REPLACE FUNCTION market_core.validate_catalog_storage_rights() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=market_core,pg_catalog AS $$
DECLARE allowed boolean; source_key_id uuid;
BEGIN
  source_key_id := CASE WHEN TG_TABLE_NAME='catalog_snapshots' THEN NEW.source_id ELSE (SELECT source_id FROM market_core.catalog_snapshots WHERE snapshot_id=NEW.snapshot_id) END;
  SELECT cs.storage_allowed AND lp.cache_allowed INTO allowed FROM market_core.catalog_sources cs JOIN market_core.license_policies lp ON lp.rights_policy_id=cs.rights_policy_id WHERE cs.source_id=source_key_id;
  IF allowed IS DISTINCT FROM true THEN RAISE EXCEPTION 'catalog storage is not permitted'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER catalog_snapshot_storage_rights BEFORE INSERT ON market_core.catalog_snapshots FOR EACH ROW EXECUTE FUNCTION market_core.validate_catalog_storage_rights();
CREATE TRIGGER catalog_candidate_storage_rights BEFORE INSERT ON market_core.catalog_candidates FOR EACH ROW EXECUTE FUNCTION market_core.validate_catalog_storage_rights();
CREATE TRIGGER catalog_identifier_storage_rights BEFORE INSERT ON market_core.catalog_candidate_identifiers FOR EACH ROW EXECUTE FUNCTION market_core.validate_catalog_storage_rights();
CREATE OR REPLACE FUNCTION market_core.prevent_source_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'catalog source history is append-only'; END $$;
CREATE TRIGGER catalog_sources_append_only BEFORE UPDATE OR DELETE ON market_core.catalog_sources FOR EACH ROW EXECUTE FUNCTION market_core.prevent_source_history_mutation();
CREATE OR REPLACE FUNCTION market_core.prevent_catalog_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'catalog history is append-only'; END $$;
CREATE TRIGGER catalog_snapshots_append_only BEFORE UPDATE OR DELETE ON market_core.catalog_snapshots FOR EACH ROW EXECUTE FUNCTION market_core.prevent_catalog_history_mutation();
CREATE TRIGGER catalog_candidates_append_only BEFORE UPDATE OR DELETE ON market_core.catalog_candidates FOR EACH ROW EXECUTE FUNCTION market_core.prevent_catalog_history_mutation();
CREATE TRIGGER catalog_candidate_identifiers_append_only BEFORE UPDATE OR DELETE ON market_core.catalog_candidate_identifiers FOR EACH ROW EXECUTE FUNCTION market_core.prevent_catalog_history_mutation();
CREATE TRIGGER catalog_decisions_append_only BEFORE UPDATE OR DELETE ON market_core.catalog_review_decisions FOR EACH ROW EXECUTE FUNCTION market_core.prevent_catalog_history_mutation();
CREATE TRIGGER registry_identifiers_append_only BEFORE UPDATE OR DELETE ON market_core.instrument_identifiers FOR EACH ROW EXECUTE FUNCTION market_core.prevent_catalog_history_mutation();

ALTER TABLE market_core.catalog_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_core.catalog_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_core.catalog_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_core.catalog_candidate_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_core.catalog_review_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_core.catalog_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE market_core.catalog_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE market_core.catalog_candidates FORCE ROW LEVEL SECURITY;
ALTER TABLE market_core.catalog_candidate_identifiers FORCE ROW LEVEL SECURITY;
ALTER TABLE market_core.catalog_review_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE market_core.instrument_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_core.instrument_identifiers FORCE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX instrument_identifiers_issuer_uq ON market_core.instrument_identifiers(identifier_type,identifier_value,identifier_scope,issuer_id,snapshot_id) WHERE issuer_id IS NOT NULL AND instrument_id IS NULL AND listing_id IS NULL;
CREATE UNIQUE INDEX instrument_identifiers_instrument_uq ON market_core.instrument_identifiers(identifier_type,identifier_value,identifier_scope,instrument_id,snapshot_id) WHERE issuer_id IS NULL AND instrument_id IS NOT NULL AND listing_id IS NULL;
CREATE UNIQUE INDEX instrument_identifiers_listing_uq ON market_core.instrument_identifiers(identifier_type,identifier_value,identifier_scope,listing_id,snapshot_id) WHERE issuer_id IS NULL AND instrument_id IS NULL AND listing_id IS NOT NULL;
REVOKE ALL ON market_core.catalog_sources, market_core.catalog_snapshots, market_core.catalog_candidates, market_core.catalog_candidate_identifiers, market_core.catalog_review_decisions, market_core.instrument_identifiers FROM PUBLIC;
GRANT USAGE ON SCHEMA market_core TO market_core_catalog_ingest, market_core_catalog_reader, market_core_registry_reviewer;
GRANT SELECT ON market_core.catalog_sources, market_core.catalog_snapshots, market_core.catalog_candidates, market_core.catalog_candidate_identifiers, market_core.instrument_identifiers TO market_core_catalog_reader, market_core_registry_reviewer;
GRANT INSERT ON market_core.catalog_sources, market_core.catalog_snapshots, market_core.catalog_candidates, market_core.catalog_candidate_identifiers TO market_core_catalog_ingest;
GRANT INSERT ON market_core.catalog_review_decisions TO market_core_registry_reviewer;
CREATE POLICY catalog_reader_sources ON market_core.catalog_sources FOR SELECT TO market_core_catalog_reader, market_core_registry_reviewer USING (current_user IN ('market_core_catalog_reader','market_core_registry_reviewer'));
CREATE POLICY catalog_reader_snapshots ON market_core.catalog_snapshots FOR SELECT TO market_core_catalog_reader, market_core_registry_reviewer USING (current_user IN ('market_core_catalog_reader','market_core_registry_reviewer'));
CREATE POLICY catalog_reader_candidates ON market_core.catalog_candidates FOR SELECT TO market_core_catalog_reader, market_core_registry_reviewer USING (current_user IN ('market_core_catalog_reader','market_core_registry_reviewer'));
CREATE POLICY catalog_reader_identifiers ON market_core.catalog_candidate_identifiers FOR SELECT TO market_core_catalog_reader, market_core_registry_reviewer USING (current_user IN ('market_core_catalog_reader','market_core_registry_reviewer'));
CREATE POLICY catalog_ingest_sources ON market_core.catalog_sources FOR INSERT TO market_core_catalog_ingest WITH CHECK (current_user='market_core_catalog_ingest');
CREATE POLICY catalog_ingest_snapshots ON market_core.catalog_snapshots FOR INSERT TO market_core_catalog_ingest WITH CHECK (current_user='market_core_catalog_ingest');
CREATE POLICY catalog_ingest_candidates ON market_core.catalog_candidates FOR INSERT TO market_core_catalog_ingest WITH CHECK (current_user='market_core_catalog_ingest');
CREATE POLICY catalog_ingest_identifiers ON market_core.catalog_candidate_identifiers FOR INSERT TO market_core_catalog_ingest WITH CHECK (current_user='market_core_catalog_ingest');
CREATE POLICY catalog_review_insert ON market_core.catalog_review_decisions FOR INSERT TO market_core_registry_reviewer WITH CHECK (current_user='market_core_registry_reviewer');
GRANT SELECT ON market_core.catalog_review_decisions TO market_core_registry_reviewer;
CREATE POLICY catalog_review_reader ON market_core.catalog_review_decisions FOR SELECT TO market_core_registry_reviewer USING (current_user='market_core_registry_reviewer');
CREATE POLICY registry_identifier_reader ON market_core.instrument_identifiers FOR SELECT TO market_core_catalog_reader, market_core_registry_reviewer USING (current_user IN ('market_core_catalog_reader','market_core_registry_reviewer'));
