# SYNTRAKE R0-A — archived isolated PREVIEW rehearsal evidence

**Status: REHEARSAL COMPLETE; writer LOGIN DISABLED, role membership REVOKED on 2026-10-20.**

These scripts are operator-only audit artifacts, deliberately **outside**
`supabase/migrations/`. Do not run them through production migrations or
reenable them as part of future Investing Core work.

## Target and recorded facts

- ONLY rehearsal target: Supabase Preview `zkqgpejlkgootkvkebhd`.
- Forbidden target: production/main Supabase `vbazzxqyuqcrmjytaboc`.
- `migrations/20261018112500_investing_writer_runtime_login.sql`
  documents the historical restricted LOGIN setup.
- `fixtures/20261018_r0a_writer_subledgers_preview_only.sql`
  documents the one-off A/C EUR subledger setup.
- The audited and executed fail-closed operation is
  `teardown/20261020_r0a_preview_writer_fail_closed.sql`.
  It has strong fixture/ledger identity and integrity preconditions and
  atomically revokes financial writer authority, preserving evidence.

## Verified terminal state

Post-shutdown direct PostgreSQL checks returned:

- `investing_writer_runtime.rolcanlogin = false`.
- `pg_has_role('investing_writer_runtime',
  'investing_contribution_writer', 'SET') = false`.
- `investing_contribution_writer.rolcanlogin = false`.
- Exactly 2 synthetic `USER_REPORTED` journals, one each for Clerk A/C test
  owners, 4 balanced entries, 2 idempotency records, 0 integrity issues.
- No production Supabase role/schema modification.

All earlier rehearsal authorization instructions are historic, **not**
instructions or authorization to reapply roles, migrations or credentials.
An additional approval, canonical schema review, exact SHA and separate
nonproduction safety gate are required even to recreate this experiment.

## Important truth boundary

`USER_REPORTED` is a declaration, not broker-confirmed cash or performance.
`syntrake.actor_user_id` is untrusted SQL context and only meaningful
behind a verified Clerk server actor and trusted private PG authority.
A branch Preview env flag being paused does not revoke immutable deployments;
that is why the dedicated PG LOGIN and role capability were also disabled.
