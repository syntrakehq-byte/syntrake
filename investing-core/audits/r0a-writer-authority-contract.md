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

The `pg` package has now been promoted to **production dependencies**, retaining the installed 8.23.1 lock version (no package upgrade). CI explicitly verifies a clean `npm ci --omit=dev --ignore-scripts` can `require("pg")`; this proves Node's production-only package availability, **not** a live Next.js route.

`privateWriterPool.ts` is a lazy Node PostgreSQL factory. It rejects missing/disabled `INVESTING_WRITER_MODE=rehearsal`, invalid project ref, wrong database host/port, insecure URL query options, generic DB user, invalid URL/credentials, and enforces TLS certificate verification; no network connection occurs on construction. It uses bounded pool capacity and connect/idle timeouts. Its **compiled allowlist** pins `INVESTING_WRITER_PROJECT_REF` to the independently verified non-default rehearsal branch `zkqgpejlkgootkvkebhd`, and the database host must match `db.<approved-ref>.supabase.co:5432/postgres`; merely setting `INVESTING_WRITER_MODE=rehearsal` with a consistent production ref+host is explicitly rejected. If Supabase recreates the branch, the ref can change only in a new audited SHA. This candidate intentionally doesn't support poolers, localhost, production mode or direct public credentials. Expected branch ref must be set by the trusted server operator, not taken from the request.

`recordUserReportedContributionInRehearsal()` now composes server Clerk `auth()` → strict JSON → configured private pool → account-scoped restricted transaction, and closes the pool. **It is still an uninvoked server-only function, not an HTTP route**. No real signed Clerk session, actual Supabase writer login, deployment secret, or remote financial transaction was used to validate this composition. The Next.js site `tsconfig` excludes `investing-core/**/*.ts`; passing strict Investing TS + standalone Node tests is not evidence of Next.js server bundling. Do not expose HTTP writes until Node route bundling, secret management, connection lifetime and operational safety are independently proved.

## Prepared tests (isolated CI, not remote)

- Versioned RLS role DDL is executed by an isolated PostgreSQL 17 instance, with separate synthetic LOGIN identities: one permitted to `SET LOCAL ROLE investing_contribution_writer`, another denied. This proves genuine privilege isolation rather than impersonation from the superuser role.
- Tests create declared contributions and verify strict per-account authorization, no direct user/account mutations, replay/idempotency, ownership-transfer contention, lock timeout and full rollback.
- A single real `pg.Pool` connection with `max: 1` is reused in the order **A success → B attempting A denied → B success → B replay**. After every operation, the idle connection has its original login role and no residual transaction-local actor. There is no financial row from the rejected attempt.
- `contributionJsonContract.ts` parses future request JSON only. `amountMinor` MUST be a canonical positive base-10 **string** to avoid JavaScript precision loss (no JSON numbers, floats, leading zeros, or exponents), and it rejects all unknown identity/authority fields. This strict parser is invoked **after** server Clerk auth and **before** SQL by the existing server-only wrapper. It cannot prove JWT validity.
- Rejected invalid input is checked to fail before `database.connect()`, preventing SQL side effects.
- Node 20 standalone module import test loads the real Clerk-bound server adapter and PostgreSQL pool module without invoking auth or opening a database connection. This is a Node import/load proof, **not** a Next.js server-bundle or real signed Clerk request test.
- Negative configuration tests include a **real production Supabase ref paired with its correct production host** while mode is fraudulently set to rehearsal; the compiled allowlist denies that case.

## Real-identity A/B integration test plan — NOT YET EXECUTED

Execute only after explicitly authorized rehearsal writer DDL and separately approved private LOGIN and server-side connection configuration, with real signed Clerk sessions (never copy JWTs, keys, or passwords into Git logs). Each HTTP response/status listed is a **future acceptance expectation**, not a currently implemented endpoint:

| Request/session | Required future result | Independent database proof |
| --- | --- | --- |
| No signed Clerk session | 401 / denied | No SQL role assumption or new financial row |
| A session, account B | 403 or nondisclosing 404 | No cross-account journal/key/entry |
| B session, account A | 403 or nondisclosing 404 | Same denial in opposite direction |
| A, valid JSON decimal minor-units | Explicit USER_REPORTED only | One exactly balanced posted internal journal and provenance `verifiedByBroker=false` |
| Same A actor/key/same payload replay | Same transaction ID/result | Exactly one idempotency key and journal |
| Same A actor/key/different payload | 409 conflict | Original financial rows unmodified |
| Invalid or numeric JSON amount | 400 validation rejection | Connection-free denial before SQL |
| Lock wait exceeds permitted timeout | Bounded 409/503 error | Whole transaction rolled back, zero partial rows |
| Login lacks exact writer role | 503 fail closed | No privileged insert, no fallback to postgres/service_role |
| Rotate from A to B on one server pool | No session crossover | No retained actor/role after commit or rollback |

No test may publish a broker-confirmed or investable balance from USER_REPORTED. The tests must record exact Git SHA, migration versions, branch ref, timestamps, masked identity references and redacted evidence, with no user monetary data; test-account fixtures must be explicitly identified and cleaned. Production remains completely out of scope.

## Independent audit finding: SQL actor setting is not authoritative

`syntrake.actor_user_id` is a transaction-local PostgreSQL setting. A holder of login credentials sufficient to assume `investing_contribution_writer` could set it to another user's ID and operate across tenants. The RLS policies are **defense in depth** but not proof of the actual Clerk user. Real authority requires a server-secret boundary, verified Clerk session, nonexported pool and strict no-cross-tenant service isolation. Never provision this credential into client or general server contexts; a deployed role without verified runtime linkage remains **BLOCKED**.

## Proof requirements before acceptance

1. CI isolated PG17 must execute the *exact* versioned migration and verify privileges using `pg_roles`, `pg_policies` and negative SQL under the actual NOLOGIN role. Verify valid owner contribution, exactly-once retry, actor omission denial, A→B/B→A denial and prohibition of account/ledger mutation.
2. Fail-closed tests for inability to assume the capability role, cross-account insert, malformed data, commit/rollback and contention.
3. Secure session/connection handling with tight statement, lock and idle transaction timeouts, pool rollback/reset and denial of reuse/cross-tenant context leakage.
4. Separately authorized Supabase rehearsal migration, least-privilege login provisioning and real Clerk A/B → server → PG transaction verification (without exposing tokens, passwords or financial IDs).
5. Operational observability, reconciliation, replay, deny-logging without sensitive personal content and explicit human approval before any production or live authority.
6. Audit actual head SHA and a full CI run; the Git accepted predecessor remains accepted until candidate gate passes.

**Current gate: BLOCKED.** No merge, remote migration, production deploy or broker action authorized by preparing this file.
