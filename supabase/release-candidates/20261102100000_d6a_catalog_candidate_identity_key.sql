-- D6-A candidate only. This is not a remote migration.
-- A provider ticker is not a listing identity: MIC is part of the ingestion key.
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'market_core'
    AND rel.relname = 'catalog_candidates'
    AND con.contype = 'u'
    AND pg_get_constraintdef(con.oid) LIKE 'UNIQUE (snapshot_id, provider_reference, provider_scope)%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE market_core.catalog_candidates DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS catalog_candidates_snapshot_reference_scope_mic_uq
  ON market_core.catalog_candidates(snapshot_id, provider_reference, provider_scope, COALESCE(mic, 'NO_MIC'));
