-- G2-B candidate only. Directed FX pair -> canonical listing -> G2-A PIT reader.
-- Private market_core schema; do not apply remotely or expose via Data API.
CREATE TABLE market_core.fx_pairs (
  listing_id uuid PRIMARY KEY REFERENCES market_core.listings(listing_id),
  base_currency char(3) NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
  quote_currency char(3) NOT NULL CHECK (quote_currency ~ '^[A-Z]{3}$'),
  CHECK (base_currency <> quote_currency),
  UNIQUE (base_currency, quote_currency)
);
CREATE OR REPLACE FUNCTION market_core.check_fx_pair_binding() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE existing record;
BEGIN
  SELECT l.ticker, l.trading_currency, l.mic, l.mic_role, i.asset_class, i.denomination_currency
    INTO existing
    FROM market_core.listings l
    JOIN market_core.instruments i ON i.instrument_id = l.instrument_id
    WHERE l.listing_id = NEW.listing_id;
  IF NOT FOUND OR existing.asset_class <> 'FX'
     OR existing.mic IS NOT NULL OR existing.mic_role IS NOT NULL
     OR existing.ticker <> (NEW.base_currency::text || NEW.quote_currency::text)
     OR existing.trading_currency <> NEW.quote_currency
     OR existing.denomination_currency <> NEW.quote_currency THEN
    RAISE EXCEPTION 'FX pair does not match canonical FX listing';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fx_pair_validate BEFORE INSERT OR UPDATE ON market_core.fx_pairs
  FOR EACH ROW EXECUTE FUNCTION market_core.check_fx_pair_binding();
-- The directed currency mapping is immutable once registered, like PIT revisions.
CREATE TRIGGER fx_pair_append_only BEFORE UPDATE OR DELETE ON market_core.fx_pairs
  FOR EACH ROW EXECUTE FUNCTION market_core.prevent_revision_mutation();
ALTER TABLE market_core.fx_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_core.fx_pairs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON market_core.fx_pairs FROM PUBLIC;
GRANT SELECT ON market_core.fx_pairs TO market_core_reader;
CREATE POLICY fx_pair_reader ON market_core.fx_pairs FOR SELECT TO market_core_reader
  USING (current_user = 'market_core_reader');

-- No inversion, triangulation or inferred identity. The same licensed PIT values
-- and current retention check are inherited from G2-A's read_market_history.
CREATE OR REPLACE FUNCTION market_core.read_fx_history(
  p_base text, p_quote text, p_start_date date, p_end_date date, p_cutoff timestamptz
) RETURNS TABLE (
  fx_base_currency text,
  fx_quote_currency text,
  listing_id uuid, instrument_id uuid, provider_id uuid, rights_policy_id uuid,
  currency text, bar_interval text, adjustment text, market_date date,
  status text, revision_id uuid, close_value numeric, as_known_at timestamptz,
  source_revision text, quality_flags text[]
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT fp.base_currency::text, fp.quote_currency::text,
         h.listing_id, h.instrument_id, h.provider_id, h.rights_policy_id,
         h.currency, h.bar_interval, h.adjustment, h.market_date, h.status,
         h.revision_id, h.close_value, h.as_known_at, h.source_revision, h.quality_flags
    FROM market_core.fx_pairs fp
    CROSS JOIN LATERAL market_core.read_market_history(
      fp.listing_id, p_start_date, p_end_date, p_cutoff, '1day', 'none'
    ) h
   WHERE fp.base_currency::text = p_base AND fp.quote_currency::text = p_quote;
$$;
REVOKE ALL ON FUNCTION market_core.read_fx_history(text,text,date,date,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION market_core.read_fx_history(text,text,date,date,timestamptz) TO market_core_reader;
