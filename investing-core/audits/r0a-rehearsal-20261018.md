# SYNTRAKE Investing Core R0-A — rehearsal evidence and advisory disposition

**Status: audit evidence, not a production approval.** This file records
observations about the Supabase **rehearsal branch**
`investing-r0a-rehearsal` (project ref `zkqgpejlkgootkvkebhd`).
No new broker balance, capital contribution, user financial movement, or
production configuration is inferred from this evidence.

## Provenance and lineage

- Accepted `main` predecessor: `8e0525a4a9916bffdb5f326b433f50ccfc5537f3`.
- Original Investing R0-A candidate / PR #2:
  `f0a9c5c5a2b214ba80e0e31588f6d10715b49b60`.
- Dependency/build candidate / PR #3:
  `2ee3e91ebf6d92ba348cc74c26489b22c895067f`.
- PR #4 builds on PR #3 and adds a **forward-only, not remotely applied**
  canonical owner-membership guard. Audit its exact PR head separately.
- Rehearsal migration `20261017191352_investing_core_r0a_foundation_f0a9c5c5`
  had SQL text identical (15,216 characters) to
  `supabase/migrations/20261017160000_investing_core_foundation.sql` at
  `f0a9c5c5...`. The migration *version/name* differs between environments,
  and must not be mistaken for a missing schema or rewritten migration.
- Main Supabase project `vbazzxqyuqcrmjytaboc` did not have Investing tables
  at the time of inspection. **No production database migration is authorized.**

## Clerk JWT / Supabase REST / tenant A/B

A previous independent-audit **summary provided by the user** reports:
- CI `investing-core` PASS, Vercel check PASS;
- real Clerk JWT → Supabase REST/RLS tenant A and tenant B PASS;
- `authenticated` had SELECT-only access, no `anon` access;
- direct write denied HTTP 403;
- A→B and B→A cross-tenant read isolation confirmed.

**Evidence classification: AUDIT-REPORTED PASS (transcript not attached).**
The summary does not itself contain redacted requests, timestamps per request,
response status/body hashes, signed-token issuer/audience verification records,
test account references, or a direct tool-observed network trace. Do not
represent it as independently replayed JWT signature validation. Existing
tests need not be repeated solely to reconstruct missing paperwork; retain
the original redacted transcript if it is available. The A/B exercise used
the *foundation-only* rehearsal schema, not the later PR #4 owner guard.

Direct read-only inspection on 2026-10-18 confirmed the rehearsal PostgreSQL
17.11 schema, two consistent owner/member fixtures, SELECT-only
`authenticated` table privileges, no direct anon table privileges,
and zero journal/ledger entries in that environment. These are independent
database observations, not a substitute for the reported signed-JWT API tests.

## Security Advisor — explicit decision

`investing.operation_idempotency_keys` has RLS **ENABLED and FORCE** and
**no** SELECT/INSERT/UPDATE/DELETE policies for `anon` or `authenticated`.
Neither role has any table grant. **KEEP IT PRIVATE / DEFAULT DENY.**
No policy is required simply to make this advisory disappear, and exposing
the idempotency store through PostgREST would enlarge the financial attack
surface. Future server writer credentials require separate, specifically
audited grants and RLS/authority behavior. A `service_role`, `postgres`
or possession of a database connection is not application authorization.

Advisor finding:
https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

## Performance Advisor — explicit decisions

### RLS initplan: seven WARN findings

Inspection of `pg_policies.qual` for all seven authenticated member/owner
read policies shows the JWT access is already wrapped in a scalar
subquery, e.g. `(SELECT (auth.jwt() ->> 'sub'))`.
This is the recommended hoisting syntax. The linter still reports
`auth_rls_initplan`. **Do not rewrite a proven RLS security policy
merely to suppress a warning.** Evaluate `EXPLAIN (ANALYZE, BUFFERS)`
under representative isolated authenticated workloads before any
performance-driven policy change. RLS policy semantics must never weaken.
https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan

### Foreign-key indexes: seven INFO findings

Observed unfollowed leading-column index coverage:
- `investment_accounts(base_currency)`
- `investment_accounts(owner_user_id)`
- `ledger_accounts(currency)`
- `ledger_entries(investment_account_id,ledger_account_id,currency)`
- `ledger_entries(transaction_id,investment_account_id)`
- `operation_idempotency_keys(user_id)`
- `portfolios(investment_account_id)`

The schema already has indexes for membership lookup, account-scoped
journals, transaction-id lookups, subledger identity, and idempotency keys.
The two ledger composite foreign-key indexes are *not* fully covered in
their stated order; a leading `transaction_id` index exists, and a
ledger-identity index exists in another column order. Neither is
equivalent to every proposed composite key. The findings are legitimate
index-coverage warnings but not proof of unacceptable query performance.

**DEFER additional indexes at R0-A** pending actual access patterns,
cardinality, FK update/delete frequency, buffer/planner evidence, and
write-path amplification analysis. In production, use a separate
forward-only, rehearsed migration with a verified locking/deployment
plan when justified; do not alter the already executed foundation
migration or add seven speculative indexes by default.
https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys

The two `unused_index` INFO findings have no significance in an
unpopulated ledger; do not drop protective indexes to clear the linter.
Auth DB connection allocation INFO is a capacity-planning decision,
not an R0-A financial isolation gate.

## Remaining security/operational acceptance gates

1. **Writer:** `recordUserReportedContribution` is presently an
   unexposed server helper. It accepts a server actor and a DB pool as
   parameters. End-to-end auth-to-write routing, connection authority,
   least-privilege PostgreSQL role, strict DML/RLS permissions, retries,
   failure recovery, reconciliation, timeouts and account ownership
   lifecycle are not yet proved in deployed runtime.
2. **Role concurrency:** the restricted PG17 candidate now uses
   a transaction-scoped account advisory lock for writer operations,
   with a matching deferred guard on privileged owner/membership commits.
   Synthetic PostgreSQL17 CI proves authorization, replay, same-account
   concurrency and owner-revocation conflict under a NOLOGIN, non-BYPASSRLS
   fixture role that has **no UPDATE privilege** on `investment_accounts`.
   This is not proof of a provisioned production writer, deployed DB grants,
   remote RLS correctness after the corrective migration, or complete
   broker reconciliation. Verify the actual role and concurrency semantics
   independently in a separately authorized nonproduction rehearsal.
3. **PR #4 forward-only owner guard:** isolated PG17 test passed. It
   has **not** been applied to the remote rehearsal branch. New
   two-tenant HTTP tests are not to be represented as proof of this
   additional migration.
4. **Dev dependency risk:** the npm runtime audit reported zero
   vulnerabilities at the PR #3 successor SHA; seven HIGH findings
   persist in dev/build tools (`@next/eslint-plugin-next`,
   `braces`, `chokidar`, `eslint-config-next`, `fast-glob`,
   `micromatch`, `tailwindcss`). Evaluate their exposure in CI,
   lockfile consistency and compatible remedies before formal acceptance.

**Gate:** R0-A remains BLOCKED for merge, production migration,
broker operations and financial writes until an exact SHA passes
independent review and the user separately authorizes each deployment
boundary. "NO ACTION" is the appropriate behavior for unproved live
financial authority.
