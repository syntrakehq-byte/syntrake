-- D6-A candidate only. This is not a remote migration.
-- A provider ticker is not a listing identity: MIC is part of the ingestion key.
ALTER TABLE market_core.catalog_candidates
  DROP CONSTRAINT IF EXISTS catalog_candidates_snapshot_id_provider_reference_provider_scope_key;

CREATE UNIQUE INDEX IF NOT EXISTS catalog_candidates_snapshot_reference_scope_mic_uq
  ON market_core.catalog_candidates(snapshot_id, provider_reference, provider_scope, COALESCE(mic, 'NO_MIC'));
