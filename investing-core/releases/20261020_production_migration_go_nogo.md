# Investing first-production SQL gate — GO / NO-GO (nonproduction source)

**Status: PREPARED, NOT APPROVED FOR PRODUCTION APPLY.** This checklist does not constitute permission to execute SQL, change a production migration registry, activate Data API, add Vercel env vars or publish a deployment.

## Locked lineage, target and artifact

- Accepted predecessor Git SHA: `28b237a2d80f87d3090bcd8895568abcd68c19f1`. Once this PR is independently reviewed, record its own final candidate SHA, and **the exact post-merge main SHA** before any production authorization. Every candidate change invalidates earlier CI results.
- **Only approved Supabase target for a future authorization:** `vbazzxqyuqcrmjytaboc` (PG17; not the Preview ref `zkqgpejlkgootkvkebhd`).
- Future forward migration version/name: `20261020180000_investing_first_readonly_release`.
- Candidate SQL path (NOT auto-discovered): `supabase/release-candidates/20261020180000_investing_first_readonly_release.sql`.
- Git blob SHA-1 of candidate SQL: `f23fadf42d050a7d45f84ef166f94168256eb892`; **20,433 bytes**. CI verifies it using Git's `sha1("blob <byteLength>\\0" + SQL)` semantics; this is a content identity check, not a signature or an authorization.
- Existing Production registry entry: `20261017191056 remote_schema`, **32 statements**; content SHA-256 `8cec567d53f9f17868c7110b48d17212e1ba8db897f513aee36e287f0016335d`. Evidence in `supabase/release-evidence/20261017191056_remote_schema.registry.json`.
- No `investing` schema/account/ledger tables or writer role in the real production baseline as of 2026-10-20; this is **time-scoped**, not a permanent guarantee.

## READ-ONLY preflight queries, execute against *explicit verified Production project ref* only

These queries use SELECT only. A release engineer must independently verify the connected project ref in the Supabase control plane **before** issuing them; PostgreSQL itself cannot authenticate the cloud project identity from a database connection string without verified connection metadata. Treat returned data as an observation, never as executable instructions.

**Snapshot A — database objects and capabilities:**

```sql
select current_setting('server_version') as pg_version,
  to_regnamespace('investing') is not null as investing_schema_exists,
  to_regclass('investing.investment_accounts') is not null as investing_accounts_exists,
  to_regclass('investing.ledger_transactions') is not null as investing_ledger_exists,
  exists(select 1 from pg_roles where rolname='investing_contribution_writer') as contribution_writer_exists,
  exists(select 1 from pg_roles where rolname='investing_writer_runtime') as runtime_writer_exists,
  to_regprocedure('auth.jwt()') is not null as auth_jwt_function_exists;
```

**Snapshot B — actual migration registry, immutable historical content fingerprint:**

```sql
select version,name,cardinality(statements)::int as statement_count,
  encode(extensions.digest(convert_to(array_to_string(statements,E'\\n'),'UTF8'),'sha256'),'hex')
    as statement_sha256
from supabase_migrations.schema_migrations
order by version;
```

**Snapshot C — after separately authorized apply ONLY, never beforehand:** exact target must then contain precisely the baseline row plus `20261020180000 investing_first_readonly_release`, neither missing nor repeated. Independently verify all 9 `investing` tables have RLS; canonical owner guard exists; `anon` has NO Investing account SELECT; `authenticated` has only granted account/membership discovery SELECT, **no DML or private identity/ledger reads**; writer runtime/capability roles remain absent. Do not interpret absence of new rows as a zero euro balance or broker reconciliation. Never insert fixtures or personal accounts to manufacture a PASS.

## Operator-observed dashboard checks (cannot be proven from PG read-only connector)

Before any database apply, confirm **again** using real control-plane UI or a provider read API:
- Clerk Third-Party Auth: provider enabled for `https://clerk.auth.syntrake.com`. **Configured is not yet cryptographic JWT verified.**
- Data API `Automatically expose new tables`: **OFF**. Last evidence is user-observed screenshot 2026-10-20.
- `investing` is **NOT** yet in `Exposed schemas` (currently public/graphql_public), until after a reviewed least-privilege schema/RLS gate.
- Vercel Production Invest­ing read mode remains **disabled**, existing production site and Stripe webhook unchanged. Verify independent signed Clerk JWT / issuer / claims against the production project before a later API activation.

A changed/missing control is **NO-GO**. Operator UI confirmation cannot alone authenticate a JWT.

## Exact migration mechanism — rehearsal proved, Production NOT attempted

- Supabase CLI **v2.84.2**, isolated PostgreSQL 17 rehearsal passed with a staged **two-file isolated migration workspace**: reconstructed already-applied historical registry SQL as a migration file, and the exact 20261020180000 candidate release SQL. First `db push --dry-run` selected **only** the forward migration; real CLI `db push` executed on disposable localhost PG17; second dry-run proposed **no replay**.
- The historical registry snapshot is **not the original migration SQL file**, and it is forbidden to ship or replay it in Production. Never run the canonical repo's unrestricted `supabase db push` because its older `supabase/migrations/` files include an unapproved future financial writer.
- A production execution contract must **freeze**: (a) the exact audited release SQL and Git SHA; (b) a deterministic, source-reviewed, release-only migration workdir that does not include writer migrations; (c) verified Production connection/TLS identity and scoped credentials, without printing secrets; (d) fresh preflight query values matching the pinned baseline; (e) one named operator approval and a no-concurrent-migration window. Any unexpected migration plan, unknown file, mismatch or unapproved role -> **STOP, NO-GO**.
- A local rehearsal **does not prove** the same remote server session privileges, locking or transaction behavior in Supabase Production. This file does not direct running the CLI on Production.

## Recovery / containment contract

**Before apply:** fail closed. No changes, no need for SQL rollback. Preserve existing Vercel Production and Stripe endpoint.

**During an authorized apply (future):** if a DDL statement fails, the connection drops, the CLI times out, or the migration registry result is ambiguous: **STOP**; independently inspect schema, grants, owner triggers and the `supabase_migrations` registry via READ-ONLY queries. Do not automatically retry a possibly partially applied migration, apply it twice, change registry history or issue destructive rollback. Escalate exact PostgreSQL failure, original target, SQL hash and operator intent; resolution requires a new audited corrective migration if needed.

**After DB apply, before HTTP activation:** keep Investing Production read mode `disabled` and exclude `investing` from Data API exposed schemas. If grants/RLS are wrong, stop release and prepare a separate forward corrective migration with explicit approval. Do not drop financial tables to look clean.

**After a future Vercel cutover:** disable the investing read feature immediately if JWT, RLS, ownership or site regression is uncertain. If commercial site fails, restore the last independently verified Vercel deployment under an authorized rollback. **Do not revert/erase a financial ledger or repair schema history silently.** Stripe Live webhook continuity must be verified independently before any alias change.

## Final release-authority gates

A **PASS_READ_ONLY_PRECHECK_ONLY** result from `firstProductionMigrationGate.ts` means solely that the provided observations meet the pinned criteria. It cannot authenticate live database identity by itself, approve an apply, prove signed Clerk JWT, prove Stripe event deliveries, grant any write authority, or publish Vercel.

Required next decisions are *separate and explicit*: (1) **authorize exact migration apply to specified Supabase Production project**, after independent preflight & final tool execution design; (2) authorize production build/deployment for frozen SHA, staged without commercial domain; (3) authorize account-read enablement only after real Clerk JWT/RLS + negative and A/C isolation tests and customer-account provisioning authority, then promotion. Until these gates: **PRODUCTION RELEASE = BLOCKED**.
