-- D3 CANDIDATE ONLY. Requires the R3-B and D1 candidate migrations.
-- Disposable PostgreSQL 17 rehearsal target. Never apply remotely.
-- No role is granted direct write access: authenticated review authority is not
-- established by this candidate migration, so persistence remains fail-closed.

-- Alias effectiveness (valid_from/valid_to) is not the same as when the
-- Registry learned the alias. This append-only record is the trusted PIT
-- source; callers must not synthesize its timestamp.
CREATE TABLE IF NOT EXISTS market_core.provider_alias_observations (
  provider_alias_id uuid PRIMARY KEY REFERENCES market_core.provider_aliases(provider_alias_id),
  known_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  CHECK (recorded_at >= known_at)
);

CREATE OR REPLACE FUNCTION market_core.prevent_alias_observation_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'provider alias observations are append-only';
END;
$$;

DROP TRIGGER IF EXISTS provider_alias_observation_immutable ON market_core.provider_alias_observations;
CREATE TRIGGER provider_alias_observation_immutable
  BEFORE UPDATE OR DELETE ON market_core.provider_alias_observations
  FOR EACH ROW EXECUTE FUNCTION market_core.prevent_alias_observation_mutation();

CREATE TABLE market_core.canonical_resolution_decisions (
  decision_id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES market_core.catalog_candidates(candidate_id),
  status text NOT NULL CHECK (status IN ('EXACT','AMBIGUOUS','UNRESOLVED','REVIEW_REQUIRED')),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z0-9_:-]{2,128}$'),
  issuer_id uuid REFERENCES market_core.issuers(issuer_id),
  instrument_id uuid REFERENCES market_core.instruments(instrument_id),
  listing_id uuid REFERENCES market_core.listings(listing_id),
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  decided_by text NOT NULL CHECK (length(decided_by) BETWEEN 1 AND 128),
  decided_at timestamptz NOT NULL,
  UNIQUE (candidate_id, evidence_hash),
  CHECK (status <> 'EXACT' OR (issuer_id IS NOT NULL AND instrument_id IS NOT NULL AND listing_id IS NOT NULL))
);

CREATE OR REPLACE FUNCTION market_core.validate_canonical_resolution_links()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=market_core,pg_catalog AS $$
DECLARE instrument_issuer uuid; listing_instrument uuid;
BEGIN
  IF NEW.status = 'EXACT' THEN
    RAISE EXCEPTION 'EXACT persistence requires an authenticated resolution writer';
  END IF;
  IF NEW.instrument_id IS NOT NULL THEN
    SELECT issuer_id INTO instrument_issuer FROM market_core.instruments WHERE instrument_id=NEW.instrument_id;
    IF instrument_issuer IS DISTINCT FROM NEW.issuer_id THEN RAISE EXCEPTION 'canonical instrument issuer mismatch'; END IF;
  END IF;
  IF NEW.listing_id IS NOT NULL THEN
    SELECT instrument_id INTO listing_instrument FROM market_core.listings WHERE listing_id=NEW.listing_id;
    IF listing_instrument IS DISTINCT FROM NEW.instrument_id THEN RAISE EXCEPTION 'canonical listing instrument mismatch'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER canonical_resolution_links BEFORE INSERT ON market_core.canonical_resolution_decisions
  FOR EACH ROW EXECUTE FUNCTION market_core.validate_canonical_resolution_links();

CREATE OR REPLACE FUNCTION market_core.prevent_canonical_resolution_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=market_core,pg_catalog AS $$
BEGIN RAISE EXCEPTION 'canonical resolution history is append-only'; END $$;
CREATE TRIGGER canonical_resolution_append_only
  BEFORE UPDATE OR DELETE ON market_core.canonical_resolution_decisions
  FOR EACH ROW EXECUTE FUNCTION market_core.prevent_canonical_resolution_mutation();

ALTER TABLE market_core.canonical_resolution_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_core.canonical_resolution_decisions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON market_core.canonical_resolution_decisions FROM PUBLIC;
GRANT SELECT ON market_core.canonical_resolution_decisions TO market_core_registry_reviewer;
CREATE POLICY canonical_resolution_review_reader ON market_core.canonical_resolution_decisions
  FOR SELECT TO market_core_registry_reviewer
  USING (current_user = 'market_core_registry_reviewer');
