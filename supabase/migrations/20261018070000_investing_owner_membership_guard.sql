-- R0-A forward-only corrective candidate. NEVER retrofit the already rehearsed
-- 20261017160000 foundation migration. PG17 isolated CI must execute both.
--
-- An investment account's canonical owner MUST have exactly one matching
-- owner membership. Other users may hold viewer/operator memberships, never
-- an additional owner membership. Enforced at COMMIT to permit atomic
-- account + membership provisioning in one transaction.
--
-- This protects against accidental inconsistent privileged writes; it does
-- not authorize an operator and does not grant DML to browser roles.

create function investing.assert_canonical_owner_membership()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, investing
as $body$
declare
  target_account uuid;
  account_ids uuid[];
  canonical_owner text;
begin
  if TG_TABLE_NAME = 'investment_accounts' then
    account_ids := case when TG_OP = 'DELETE'
      then array[OLD.id] else array[NEW.id] end;
  elsif TG_OP = 'DELETE' then
    account_ids := array[OLD.investment_account_id];
  elsif TG_OP = 'UPDATE' then
    -- Reassigning a membership can orphan the OLD account even when the
    -- NEW account remains valid. Both sides must be checked at COMMIT.
    account_ids := array[OLD.investment_account_id, NEW.investment_account_id];
  else
    account_ids := array[NEW.investment_account_id];
  end if;

  foreach target_account in array account_ids loop
    -- Coordinate with the server-only contribution writer. Both use exactly
    -- the same transaction-scoped key before checking financial authority.
    -- This prevents an owner/membership COMMIT from overtaking a writer that
    -- has already established its verified-actor authorization, without
    -- granting UPDATE on the investment_accounts table to that writer.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('syntrake.investing.account:' || target_account::text, 20261018)
    );

    -- Serialize competing account ownership/membership transitions. This
    -- guard runs deferred so provisioning must be one atomic transaction.
    select a.owner_user_id into canonical_owner
      from investing.investment_accounts a
     where a.id = target_account
     for update;

    -- A deleted account has no surviving owner to validate. FK constraints
    -- independently protect references from orphaned memberships.
    if not found then
      continue;
    end if;

    if not exists (
      select 1 from investing.account_memberships m
      where m.investment_account_id = target_account
        and m.user_id = canonical_owner
        and m.role = 'owner'
    ) or exists (
      select 1 from investing.account_memberships m
      where m.investment_account_id = target_account
        and m.role = 'owner'
        and m.user_id <> canonical_owner
    ) then
      raise exception 'investment account canonical owner membership invariant violated'
        using errcode = '23514';
    end if;
  end loop;

  return null;
end
$body$;

-- Only DML privileges already granted to a future authorized server writer
-- can invoke these triggers. No auth/anon function execution is granted.
revoke execute on function investing.assert_canonical_owner_membership()
  from public, anon, authenticated;

create constraint trigger investing_account_owner_consistency
after insert or update on investing.investment_accounts
deferrable initially deferred
for each row execute function investing.assert_canonical_owner_membership();

create constraint trigger investing_membership_owner_consistency
after insert or update or delete on investing.account_memberships
deferrable initially deferred
for each row execute function investing.assert_canonical_owner_membership();
