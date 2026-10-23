-- R2-C2 authenticated bootstrap, forward-only correction.
-- Supersedes the INACTIVE private runtime login. Uses validated PostgREST
-- JWT, never a user-supplied identity or direct privileged password.
-- SECURITY DEFINER is assigned to restricted NOLOGIN role (not postgres).
-- No Trading or production change.
CREATE OR REPLACE FUNCTION investing.provision_first_portfolio(
 p_idempotency_key uuid,
 p_account_name text,
 p_portfolio_name text,
 p_base_currency text
) RETURNS TABLE(account_id uuid, portfolio_id uuid, state text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, investing
AS $syntrake$
DECLARE
 v_actor text;
 v_role text;
 v_name text;
 v_portfolio_name text;
 v_hash text;
 v_previous investing.initial_portfolio_receipts%ROWTYPE;
 v_account uuid;
 v_portfolio uuid;
 v_code text;
BEGIN
 -- The PostgREST gateway verifies the Clerk JWT before database execution.
 -- Never read caller-provided actor_user_id or custom, unsigned GUC as auth.
 v_actor := nullif(auth.jwt()->>'sub','');
 v_role := nullif(auth.jwt()->>'role','');
 IF v_role IS DISTINCT FROM 'authenticated'
    OR v_actor IS NULL OR v_actor !~ '^user_[A-Za-z0-9_-]{5,120}$'
 THEN
    RAISE EXCEPTION 'authenticated session required' USING ERRCODE='P1201';
 END IF;
 IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid provisioning input' USING ERRCODE='P1202';
 END IF;
 v_name:=btrim(coalesce(p_account_name,''));
 v_portfolio_name:=btrim(coalesce(p_portfolio_name,''));
 IF length(v_name) NOT BETWEEN 2 AND 80
   OR length(v_portfolio_name) NOT BETWEEN 2 AND 80
   OR p_base_currency IS NULL
   OR p_base_currency NOT IN ('EUR','USD','GBP','CHF','JPY','KWD')
 THEN
    RAISE EXCEPTION 'invalid provisioning input' USING ERRCODE='P1202';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM investing.supported_currencies c
                 WHERE c.code=p_base_currency) THEN
    RAISE EXCEPTION 'unsupported currency' USING ERRCODE='P1202';
 END IF;

 -- Domain/version-tagged canonical request hash. No capital or brokerage
 -- instruction can be introduced through this signature.
 v_hash := encode(sha256(convert_to(
   'INITIAL_INVESTING_PORTFOLIO_V2' || chr(31) ||
   length(v_name)::text || ':' || v_name || chr(31) ||
   length(v_portfolio_name)::text || ':' || v_portfolio_name || chr(31) ||
   p_base_currency, 'UTF8')),'hex');
 PERFORM set_config('syntrake.actor_user_id',v_actor,true);
 PERFORM pg_advisory_xact_lock(hashtextextended(
   'syntrake.investing.initial:' || v_actor,20261023));

 SELECT * INTO v_previous FROM investing.initial_portfolio_receipts r
  WHERE r.user_id=v_actor;
 IF FOUND THEN
   IF v_previous.idempotency_key<>p_idempotency_key
      OR v_previous.request_sha256<>v_hash THEN
     RAISE EXCEPTION 'initial portfolio already exists' USING ERRCODE='P1203';
   END IF;
   RETURN QUERY SELECT v_previous.account_id,v_previous.portfolio_id,
     'STRUCTURE_CREATED_UNFUNDED'::text;
   RETURN;
 END IF;
 -- Existing legacy accounts need separate reconciliation; do not duplicate.
 IF EXISTS(SELECT 1 FROM investing.investment_accounts a
            WHERE a.owner_user_id=v_actor) THEN
   RAISE EXCEPTION 'existing account must be reconciled' USING ERRCODE='P1203';
 END IF;
 IF NOT EXISTS(
    SELECT 1 FROM investing.onboarding_intents o
    WHERE o.actor_user_id=v_actor AND o.evidence='USER_REPORTED'
      AND o.financial_state='NOT_PROVISIONED'
 ) THEN
    RAISE EXCEPTION 'onboarding choice required' USING ERRCODE='P1204';
 END IF;

 INSERT INTO investing.identity_accounts(user_id) VALUES(v_actor)
   ON CONFLICT (user_id) DO NOTHING;
 INSERT INTO investing.investment_accounts(owner_user_id,name,base_currency)
   VALUES(v_actor,v_name,p_base_currency) RETURNING id INTO v_account;
 INSERT INTO investing.account_memberships(investment_account_id,user_id,role)
   VALUES(v_account,v_actor,'owner');
 INSERT INTO investing.portfolios(investment_account_id,name)
   VALUES(v_account,v_portfolio_name) RETURNING id INTO v_portfolio;
 FOREACH v_code IN ARRAY ARRAY[
   'cash','external_clearing','position_cost','income','expense','equity'
 ] LOOP
   INSERT INTO investing.ledger_accounts(investment_account_id,code,currency)
    VALUES(v_account,v_code,p_base_currency);
 END LOOP;
 INSERT INTO investing.initial_portfolio_receipts(
     user_id,idempotency_key,request_sha256,account_id,portfolio_id
 ) VALUES(v_actor,p_idempotency_key,v_hash,v_account,v_portfolio);
 -- Canonical membership/owner constraints are deferred by the R0-A base.
 -- Force them NOW under the restricted definer before handing control back
 -- to the authenticated request role; otherwise COMMIT runs their invoker
 -- triggers under a role that correctly lacks financial write authority.
 SET CONSTRAINTS investing_account_owner_consistency,
   investing_membership_owner_consistency IMMEDIATE;
 RETURN QUERY SELECT v_account,v_portfolio,'STRUCTURE_CREATED_UNFUNDED'::text;
END
$syntrake$;

-- Caller cannot call as the definer, nor change financial tables directly.
-- SECURITY DEFINER ownership is the minimum-capability NOLOGIN role; the
-- transient CREATE privilege is revoked in this same migration.
-- Restrict JWT visibility to the standard signed-claims accessor. Do not
-- grant any auth table privileges or JWT creation/signing privileges.
GRANT USAGE ON SCHEMA auth TO investing_initial_provisioner;
GRANT EXECUTE ON FUNCTION auth.jwt() TO investing_initial_provisioner;
GRANT CREATE ON SCHEMA investing TO investing_initial_provisioner;
ALTER FUNCTION investing.provision_first_portfolio(uuid,text,text,text)
  OWNER TO investing_initial_provisioner;
REVOKE CREATE ON SCHEMA investing FROM investing_initial_provisioner;

REVOKE ALL ON FUNCTION investing.provision_first_portfolio(uuid,text,text,text)
  FROM PUBLIC, anon, authenticated;
DO $role$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
   REVOKE ALL ON FUNCTION investing.provision_first_portfolio(uuid,text,text,text)
     FROM service_role;
 END IF;
END $role$;
GRANT EXECUTE ON FUNCTION investing.provision_first_portfolio(uuid,text,text,text)
  TO authenticated;

-- Explicitly validated JWT is required for owner-only recovery of receipt.
GRANT SELECT ON investing.initial_portfolio_receipts TO authenticated;
CREATE POLICY authenticated_initial_receipt_select
ON investing.initial_portfolio_receipts FOR SELECT TO authenticated
USING (
 user_id = (select auth.jwt()->>'sub')
 AND nullif((select auth.jwt()->>'sub'),'') IS NOT NULL
);

-- Empty ledger remains empty. A new portfolio is not a contribution.
