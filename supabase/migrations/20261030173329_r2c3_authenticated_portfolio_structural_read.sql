-- SYNTRAKE R2-C3 Production: least-privilege authenticated portfolio structural read.
-- The existing FORCE RLS policy portfolio_member continues to enforce ownership.
-- Only the two columns required by existingAccountReview.fetchRows are exposed.
-- No financial columns, DML, service-role grants or ledger rights.
GRANT SELECT (id, investment_account_id) ON TABLE investing.portfolios TO authenticated;
