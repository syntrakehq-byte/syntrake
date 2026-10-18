# SYNTRAKE Investing Core — R0-A candidate (BLOCKED)

This bounded context is independent from Trading, Research Lab and Billing. It is not a functioning investing product or broker integration.

- Clerk is the identity provider. Supabase JWT verification must precede PostgreSQL RLS reads of `auth.jwt()->>'sub'`. A real tenant A/B Clerk→REST/RLS rehearsal PASS is **audit-reported** from the user's earlier independent-audit summary; redacted source transcript/signature details were not attached and therefore are not independently attested in this repo. The isolated server actor adapter calls Clerk `auth()` but is NOT exposed on an HTTP write route.
- Accounting uses exact bigint minor units and an explicit supported subset of ISO 4217 currencies, including JPY (0 minor digits) and KWD (3 minor digits). The SQL currency registry must match the domain registry. Three uppercase letters alone do not validate ISO currencies.
- Double-entry journals post between different internal ledger accounts within one investment account. Every currency independently balances. Journal state moves from draft to posted before COMMIT and cannot subsequently be changed. Corrections require compensating journals.
- The server-side `recordUserReportedContribution` checks ownership and the owner membership in PostgreSQL, serializes cooperating operations with a transaction-scoped advisory account lock, hashes normalized input, rejects idempotency-key conflicts and prevents duplicate external references. The forward-only owner-guard candidate uses the **same advisory key at COMMIT** to coordinate owner/membership changes. Reservation, journal and replay result commit atomically. PG17 CI proves a NOLOGIN/NO-BYPASSRLS restricted role can execute and replay a contribution **without UPDATE permission on investment_accounts**; this CI-only role/policy fixture is NOT a provisioned operational writer. There is a server-only Clerk-bound function, but NO enabled HTTP write route or provisioned privileged PostgreSQL runtime LOGIN.
- USER_REPORTED is a NON-VERIFIED financial declaration. Its journal is internal bookkeeping only; it is NOT proof of a deposit, broker-confirmed cash, performance, investable balance or available trading authority. Future investment/execution logic MUST NOT promote this evidence to broker-confirmed truth without independent reconciliation.
- PostgreSQL tests use synthetic fixtures, admin setup, and simulation of JWT claims at database level, NOT genuine signed Clerk JWT verification.
- The original foundation SQL was applied to the nonproduction Supabase `investing-r0a-rehearsal` branch under a separately named migration (`20261017191352_investing_core_r0a_foundation_f0a9c5c5`), with exact SQL contents matched to the GitHub foundation file at `f0a9c5c5...`. It was **not** applied to the main Supabase project. The PR #4 owner-guard migration `20261018070000_investing_owner_membership_guard.sql` **was** applied exclusively to the nonproduction rehearsal branch as the registered migration `20261018072636_investing_owner_membership_guard_467bd9b7`, with exact SQL parity and functional rollback-only tests verified. The PR #5 writer-capability migration `20261018074500_investing_contribution_writer_capability.sql` is **CI-only** and is not remotely applied; its authorized application was blocked by tool security restrictions. Rewriting either previously applied migration or silently reconciling version drift is prohibited.
- Supabase service_role is capability, never user authorization. A future constrained privileged DB writer, real external auth validation and operational auditing must be separately gated.

Outstanding BLOCKED gates: independently retain the redacted genuine Clerk/Supabase A/B rehearsal transcript if available, provision/test a strictly authorized server-held PostgreSQL writer role and its RLS/DDL in an explicitly authorized nonproduction rehearsal, operational auth-to-write/timeout/retry/failure/reconciliation, and dev/build-tool vulnerability assessment. Site build, PG17 tests and npm **runtime** audit passed on the current candidate ancestry; those successes do NOT authorize merge, production migrations, live execution or real deposits. No service in this slice may move real money.

## Read-only Clerk → Supabase transport candidate

- The server-only entry **loadOwnInvestingAccountsFromClerk** obtains `userId`, `sessionId`, and `getToken()` exclusively from Clerk's server-side `auth()` context. It has **no public route** in R0-A.
- **readOwnInvestingAccounts** uses an auditable, narrowly scoped PostgREST GET for investment account summaries, setting `Accept-Profile: investing`, a **publishable** key and the session's bearer token. No dynamic user/account filter, privileged fallback, client-supplied JWT, cash balance, or trading authority.
- Production callers MUST never construct the lower-level transport's session argument from client data. A valid-looking JWT is not verified by regex: verification is done by the Supabase gateway. The simulated transport tests CANNOT establish real Clerk/Supabase JWT signature validation.
- Unit tests cover missing session/token, wrong hosts, secret keys, synthetic gateway 401/403, network errors, malformed responses and two isolated **synthetic** sessions. PostgreSQL 17 tests additionally exercise mocked RLS A/B, unauthorized anon, missing `sub` and read-only access.
- The rehearsal JWT/REST/RLS A/B test is **AUDIT-REPORTED PASS** for the foundation schema, including negative cross-tenant checks. Its original signed-token assertions were not recovered here. This evidence does not demonstrate the newer owner-guard schema, production rollout, or authorized financial writes. The exact test environment and actor-to-tenant authority remain essential.

## Supabase Advisor disposition (rehearsal, 2026-10-18)

See [the scoped audit evidence](./audits/r0a-rehearsal-20261018.md).
The private `operation_idempotency_keys` table has FORCE RLS,
**no public policies**, and no anonymous/authenticated grants. This is
intentional deny-by-default, not a reason to add an externally callable
policy. Seven RLS-initplan warnings persist despite existing
`(SELECT auth.jwt()->>'sub')` wrappers. Seven FK index-coverage warnings
are performance questions, not proof of a correctness or auth defect;
benchmark with real workload evidence before adding speculative indexes.

## Writer integration preparation (candidate PR #5)

This candidate adds a strict JSON adapter and direct negative integration tests.
`amountMinor` arrives as a canonical decimal **string** to preserve bigint
precision; unknown identity/role fields are rejected. Server-only Clerk
`auth()` supplies the Actor, not request payload.

The isolated PostgreSQL 17 tests additionally reuse a single `pg` connection
across tenant A and B operations, verifying that `SET LOCAL ROLE` and
`syntrake.actor_user_id` never survive COMMIT/ROLLBACK. Invalid inputs fail
before acquiring SQL, and lock contention aborts without partial journals.
These are real PG17 CI fixtures, **not** Clerk-provider end-to-end tests.
Read the [integration acceptance matrix](./audits/r0a-writer-authority-contract.md).

The `pg` package has now been promoted into production dependencies with a
version-consistent lockfile. GitHub CI verifies `npm ci --omit=dev` and a
successful Node `require('pg')`, as well as a lazy, fail-closed rehearsal-only
private PostgreSQL pool configuration. The server-only
`recordUserReportedContributionInRehearsal()` now composes Clerk authentication,
strict JSON input and the private pool without enabling a request handler.
Global Next.js compilation still excludes `investing-core/**/*.ts`, so actual
Next runtime bundling is **not proved**. There is no server-held constrained
LOGIN, new remote writer-capability migration, REST writer endpoint or broker
confirmation.
