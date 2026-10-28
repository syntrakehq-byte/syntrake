# BL2/BL3 — Preview Clerk A/B rehearsal preflight (Draft PR #43)

The SQL in `docs/r2/bl2bl3-candidate.sql` is a **candidate**, not an
already-approved production migration. Do not apply to the primary Supabase
project or merge this PR as a shortcut.

## Supabase-managed PostgreSQL 17 portability

Managed `postgres` is not a superuser. Newly created `NOLOGIN` roles
receive administrative membership that does not necessarily permit
`SET ROLE`. A function ownership transfer requires both a temporary
`SET ROLE` capability and `CREATE` on the target schema. The candidate
grants these transiently and revokes them **in the same transaction**.
It does **not** grant `BYPASSRLS`, `SUPERUSER` or any ledger writes.

Verify after application on a throwaway project branch:

- All six private functions are owned by `investing_bl2bl3_owner`.
- `investing_bl2bl3_runtime` and `investing_bl2bl3_owner` have
  `NOLOGIN`, `NOSUPERUSER`, and `NOBYPASSRLS`.
- `investing_bl2bl3_owner` has no `CREATE` on schema `investing`.
- The `postgres` membership in `investing_bl2bl3_owner` has no `SET`
  option. Use `pg_auth_members.set_option` (not `pg_has_role` under a
  superuser harness) for an accurate check.
- `anon` and `authenticated` have no rights to the new BL2/BL3 tables.

## Before provisioning any paid branch

1. Require all GitHub checks, including `BL2/BL3 PostgreSQL 17` and
   `investing-r0a-quality-gates`, on the **exact current commit**.
2. Require a Vercel **READY** Preview deployment from the same exact commit.
   Git-integrated Preview builds may be canceled by an ignored-build-step
   rule; a manual deployment override may be necessary.
3. Verify `SYNTRAKE_ONBOARDING_PG_ENABLED` is unset or `disabled` on
   the Preview branch. The endpoint must return a fail-closed 404.
4. Prepare private credentials *in a secret store*, not source code or logs:
   dedicated PostgreSQL Preview login, verified CA PEM, and Clerk Preview
   credentials. Never copy production connection strings.
5. Account A and B must be authenticated through real Clerk sessions;
   repository fixtures and synthetic sessions are not this rehearsal.

## Only after preflight approval

- Create one disposable Supabase branch (cost must be rechecked/authorized).
- Apply the approved baseline and portable candidate there only.
- Create a dedicated least-privilege login allowed to `SET ROLE` to
  `investing_bl2bl3_runtime`, not `postgres` or `service_role`.
- Set **branch-scoped** Preview variables only, never project-wide:
  `SYNTRAKE_ONBOARDING_PG_ENABLED=enabled`,
  `SYNTRAKE_ONBOARDING_APPROVED_PREVIEW_SHA`,
  `SYNTRAKE_ONBOARDING_PREVIEW_PROJECT_REF`,
  `SYNTRAKE_ONBOARDING_DATABASE_URL`,
  `SYNTRAKE_ONBOARDING_PG_CA_PEM` and the matching Supabase Preview URL.
- Ensure R2-C2 has created the canonical portfolio for each authenticated
  test identity; BL2/BL3 must not create an alternative structure.
- Confirm with two *real* Clerk sessions: authorized first revision,
  replay, correction, abandonment; cross-account A/B denied; and zero
  financial ledger writes. Require actual HTTP responses and Postgres
  readback, not fixture-only tests.

## Teardown

Disable the branch-scoped write flag and remove ephemeral credentials,
then delete the Supabase test branch. Verify the branch list contains
only `main`. Keep GitHub PR #43 Draft until end-to-end verification and
independent review; do not touch Production.

## IPv4-only Vercel connector preflight

Vercel functions do not support the Supabase default IPv6 direct endpoint.
The Preview boundary requires the **Supavisor Session pooler** on port 5432,
not the transaction pooler on 6543, to preserve PostgreSQL transactions,
`SET LOCAL ROLE` and advisory locks.

The operator copies the actual pooler hostname from **Supabase → Connect →
Session pooler** into the branch-scoped
`SYNTRAKE_ONBOARDING_POOLER_HOST`. No index is inferred. The DSN must
use username `investing_bl2bl3_preview_login.<branch-project-ref>`, the
exact supplied hostname, port 5432 and database `postgres`. This gate
does not allow `db.<ref>.supabase.co` or any primary-project reference.

For verify-full TLS, obtain the branch's server/root CA from **Supabase →
Database Settings → SSL Configuration** and configure the branch-scoped
`SYNTRAKE_ONBOARDING_PG_CA_PEM`; the Vercel Preview connection keeps
`rejectUnauthorized=true`. Never substitute `sslmode=require` without
certificate verification for the tested financial workflow.

The app must report `NOT_FOUND` (HTTP 404) when the branch write flag is
disabled. A successful static Preview build is **not** a Clerk A/B rehearsal.
