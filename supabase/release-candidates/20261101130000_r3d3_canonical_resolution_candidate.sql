-- D3 CANDIDATE ONLY. Requires the R3-B and D1 candidate migrations.
-- Disposable PostgreSQL 17 rehearsal target. Never apply remotely.
-- No role is granted direct write access: authenticated review authority is not
-- established by this candidate migration, so persistence remains fail-closed.
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
