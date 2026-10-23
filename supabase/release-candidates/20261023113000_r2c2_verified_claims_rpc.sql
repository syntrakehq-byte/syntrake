-- R2-C2 PREVIEW correction: auth schema owned by supabase_admin.
-- The NOLOGIN restricted definer deliberately has NO USAGE on auth schema.
-- PostgREST fills request.jwt.claims only AFTER verifying the signed Clerk JWT.
-- The SQL function reads these verified claims, NEVER caller userId/body.
-- Forward-only amendment after exact original RPC and ACL lockdown migrations.
GRANT CREATE ON SCHEMA investing TO investing_initial_provisioner;
GRANT investing_initial_provisioner TO postgres WITH INHERIT FALSE, SET TRUE;
SET LOCAL ROLE investing_initial_provisioner;
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
 v_actor := nullif((nullif(current_setting('request.jwt.claims',true),'')::jsonb)->>'sub','');
 v_role := nullif((nullif(current_setting('request.jwt.claims',true),'')::jsonb)->>'role','');
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
RESET ROLE;
REVOKE investing_initial_provisioner FROM postgres GRANTED BY postgres;
REVOKE CREATE ON SCHEMA investing FROM investing_initial_provisioner;
DO $verify$
DECLARE function_oid oid;
BEGIN
 function_oid:='investing.provision_first_portfolio(uuid,text,text,text)'::regprocedure::oid;
 IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid=function_oid))
      IS DISTINCT FROM 'investing_initial_provisioner'
    OR has_function_privilege('anon',function_oid,'EXECUTE')
    OR NOT has_function_privilege('authenticated',function_oid,'EXECUTE')
    OR EXISTS(
     SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
     JOIN pg_roles c ON c.oid=m.member
     WHERE r.rolname='investing_initial_provisioner' AND c.rolname='postgres'
       AND m.set_option
    )
 THEN
   RAISE EXCEPTION 'JWT RPC owner, ACL or role grants drifted' USING ERRCODE='42501';
 END IF;
END $verify$;
