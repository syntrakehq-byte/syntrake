# SYNTRAKE R0-A — financial writer authority candidate (BLOCKED)

## Executable contract / dependency

- **GitHub predecessor:** PR #4 head `467bd9b7d5c256eb8f55bec28ba3a7327cbee118`.
- **SQL migration:** `supabase/migrations/20261018074500_investing_contribution_writer_capability.sql` is a *forward-only candidate* following the already rehearsed ownership guard. Not applied remotely; never rewrite previously applied Supabase migrations.
- **Clerk identity:** `recordUserReportedContributionFromClerk()` derives `userId` and `sessionId` using Clerk's server-only `auth()`. Request JSON never provides the actor or an arbitrary JWT.
- **Ledger:** `recordUserReportedContribution` rejects missing role authority, begins its transaction, issues `SET LOCAL ROLE investing_contribution_writer` and sets `syntrake.actor_user_id` *locally to the transaction*. The financial owner/member checks, RLS predicates, idempotency and double-entry journal must all pass in the same transaction.
- **NOLOGIN/NOINHERIT/NOBYPASSRLS:** the role has only narrowly scoped SELECT, INSERT and column-specific UPDATE grants. No account, owner/member, subledger or ledger-entry updates; no production SQL connection is created by this migration.
- **RLS:** policies restrict all financial reads and writes to the authenticated actor's owned investment account, using its canonical owner membership. A missing actor in the transaction defaults to no rows or denied writes. Public `anon`/`authenticated` access and private idempotency policy are unchanged.
- **Advisory locks:** the contribution writer and the separately rehearsed owner guard share a transaction account key; the policy is NOT authority and cannot replace membership checks.
- **Financial truth:** `USER_REPORTED` is declarative bookkeeping, not broker-confirmed cash, investable balance or a transfer. This candidate cannot execute trades, nor does it provide a live execution mandate.

## Security limitation — custom GUC != signed JWT

Any SQL caller holding a privileged role can potentially set `syntrake.actor_user_id`. PostgreSQL session context is **not cryptographic authentication** and RLS alone cannot prove that the claimed actor is real. The only allowed flow is a trusted server session, established with Clerk `auth()`, followed by the restricted database transaction; the login secret is never exposed to a browser or another service. No public route is provided here.

A dedicated *login role* with a credential stored solely in an approved server-side secret manager, minimal membership of `investing_contribution_writer`, and a pinned connection to the correct rehearsal database still requires a separate auditable provisioning slice. A NOLOGIN role cannot connect directly. Do not reuse `postgres`, `service_role`, a general-purpose Supabase key, or a cross-tenant pool from another bounded context.

The `pg` package currently resides in development dependencies, not runtime dependencies. Before exposing a Node.js runtime route, promote it in a tested, lockfile-pinned follow-up candidate and validate the build/runtime bundling. **Do not enable HTTP writes now.**

## Proof requirements before acceptance

1. CI isolated PG17 must execute the *exact* versioned migration and verify privileges using `pg_roles`, `pg_policies` and negative SQL under the actual NOLOGIN role. Verify valid owner contribution, exactly-once retry, actor omission denial, A→B/B→A denial and prohibition of account/ledger mutation.
2. Fail-closed tests for inability to assume the capability role, cross-account insert, malformed data, commit/rollback and contention.
3. Secure session/connection handling with tight statement, lock and idle transaction timeouts, pool rollback/reset and denial of reuse/cross-tenant context leakage.
4. Separately authorized Supabase rehearsal migration, least-privilege login provisioning and real Clerk A/B → server → PG transaction verification (without exposing tokens, passwords or financial IDs).
5. Operational observability, reconciliation, replay, deny-logging without sensitive personal content and explicit human approval before any production or live authority.
6. Audit actual head SHA and a full CI run; the Git accepted predecessor remains accepted until candidate gate passes.

**Current gate: BLOCKED.** No merge, remote migration, production deploy or broker action authorized by preparing this file.
