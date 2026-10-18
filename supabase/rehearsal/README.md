# Investing R0-A — isolated rehearsal-only DDL

**Status: PREPARED / NOT APPLIED.** Source: `syntrakehq-byte/syntrake`, stacked on PR #5 at
`3eb6676d0980b4f272d39881e134525448d12c18`.

This directory is intentionally **outside** the standard `supabase/migrations/`
directory. Neither routine `supabase db push` nor the production migration
pipeline may automatically discover this LOGIN-creation script. It must never
be added to the default migrations folder in a production-targeted checkout.

## Scope and limits

- Allowed future target **only after separate authorization**:
  Supabase PREVIEW `investing-r0a-rehearsal`,
  project ref `zkqgpejlkgootkvkebhd`.
- Explicitly prohibited target: production/main `vbazzxqyuqcrmjytaboc`.
- Prerequisite already rehearsed: writer capability migration
  `20261018074500_investing_contribution_writer_capability.sql`.
- Candidate: `migrations/20261018112500_investing_writer_runtime_login.sql`.
- Creates one named private LOGIN with `PASSWORD NULL`; associates it to
  the existing `NOLOGIN` capability with `ADMIN FALSE, INHERIT FALSE, SET TRUE`.
- Creates **no credentials**, no runtime environment secret, no Clerk users,
  no portfolios/subledgers, no idempotency rows, and no financial movements.
- PostgreSQL role creation is cluster-scoped. Although a missing password
  blocks normal password authentication, other authentication methods must be
  independently assessed before any session is allowed to connect.

## Future gate (NOT authorized by this candidate)

1. Re-verify immutable predecessor/candidate SHAs and `git diff`. Verify the
   live Supabase PREVIEW project reference, migrations and catalog state, and
   document the target before requesting a separate migration authorization.
2. Run isolated PostgreSQL 17 tests of this exact versioned file plus negative
   authorization/role-inheritance checks. Inspect GitHub Actions CI.
3. Use a separate, rehearsal-only CLI workspace with the **remote migration
   history fetched**, confirm the linked `.temp/project-ref`, and use an
   official `db push --dry-run` to prove **exactly one pending migration**
   before any user-authorized application. Do not repair remote history
   without an independent audit and authorization.
4. After any separately approved rehearsal application, independently inspect
   `pg_roles`, `pg_auth_members`, `pg_policies`, actual SQL grants, migration
   history, and production unchanged. Stop on any mismatch.
5. A later separately approved step must provision a secret and runtime
   connection for the dedicated LOGIN. Test actual PostgreSQL authentication,
   verified Clerk A/B sessions, negative tenant access, missing/forged actor,
   replay/idempotency, race handling and journal reconciliation. Do not enable
   a financial HTTP endpoint before these gates.
6. Any test cash contributions must stay labelled `USER_REPORTED`, **not**
   broker-confirmed. No live brokerage execution or real cash movement.

**Important:** `syntrake.actor_user_id` is untrusted SQL context, not a signed
identity. Financial authority depends on real Clerk server authentication and
a private, audited database-login boundary. This prepared file does not
authorize a later live deployment, production migration, or merge.
