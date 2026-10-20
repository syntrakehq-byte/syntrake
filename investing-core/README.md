# SYNTRAKE Investing R0-A — foundation candidate

**Status (2026-10-20): CANDIDATE, NOT MERGED, NOT RELEASED.** This is not the functioning Investing Core or a broker integration.

## What has been independently proven

- A versioned PostgreSQL 17 double-entry ledger and restricted owner-based financial writer, with validated bigint minor units, immutable journals, independent currencies and deterministic idempotency.
- Isolated PG17 CI, including concurrent same-key replay, owner/member isolation, missing-actor rejection and transactional integrity.
- Genuine Clerk A/C sessions in a nonproduction rehearsal project, with server-derived identity, cross-account HTTP denials and one authorized synthetic `USER_REPORTED` contribution per account. Both sequential replays returned their original transaction IDs.
- Independently reconciled **Preview** project `zkqgpejlkgootkvkebhd`: 2 posted journals (1 A, 1 C), 4 balanced entries, 2 idempotency keys and 0 reported integrity findings. Amount: **1 EUR minor unit per account**, NOT broker-confirmed cash or actual transferred funds.
- End-of-ensayo fail-closed shutdown performed only in that Preview database: `investing_writer_runtime` is now `NOLOGIN`; its `investing_contribution_writer` membership was revoked, with both states re-read and confirmed after the change.

## What survives in the R0-A product foundation

- Financial invariants in `investing-core/domain` and `investing-core/server`.
- Private Clerk actor adapter, typed untrusted-input validation, tenant-aware read-only transport and a transaction-scoped deterministic writer that requires a separately authorized minimally privileged PG connection.
- Versioned candidate schema migrations and PostgreSQL 17/security tests.
- Immutable evidence and operator-only fixture/teardown scripts under `investing-core/audits` and `supabase/rehearsal`.

## Removed at closure

All temporary browser-accessible Preview rehearsal routes, writer smoke UI, JWT/debug inspectors, hardcoded preview HTTP gate, and preview-specific private writer pool/TLS trust-anchor implementation have been **removed from this candidate tree**. The old Preview deployments may still be reachable but their low-privilege writer database capability was independently revoked. Audit evidence remains in Git history.

## Explicit limits

- **No Investing Core product workflow** yet: no imported living portfolios, current positions, real cash reconciliation, market-data valuations, risk/allocation engines, decision engines or broker integrations.
- No production schemas/DB migration or production authorization. The connected production Supabase project is separate and has not received the Preview financial schema.
- The compiler excludes `investing-core/**/*.ts` from the general Next application typecheck; a dedicated strict investing typecheck and isolated PostgreSQL 17 integration gate exist.
- Sequential HTTP replay on A/C is demonstrated, while concurrent HTTP race tests against a live Clerk Preview were **not** performed. Concurrent idempotency was tested independently in PostgreSQL 17 CI.
- `USER_REPORTED` denotes user declaration, **not externally verified cash**, returns or investable balance.
- R0-A must not be merged or migrated to production without a separate lineage, schema/RLS and security acceptance gate and explicit operator authorization.

See the detailed source-backed rehearsal reports in `investing-core/audits/` and the guarded Preview-only shutdown at `supabase/rehearsal/teardown/20261020_r0a_preview_writer_fail_closed.sql`.


## R1 read-only account discovery — candidate, NOT ACTIVE

- The new `GET /api/investing/accounts` endpoint is **disabled by default** (HTTP 404). It requires `INVESTING_R1_ACCOUNTS_READ_MODE=enabled`, an independently configured 20-character `INVESTING_R1_SUPABASE_PROJECT_REF` matching `NEXT_PUBLIC_SUPABASE_URL` exactly, and a Supabase **publishable** API key. There is no service-role fallback.
- When enabled, the route uses the existing verified Clerk server `auth()` adapter to obtain a JWT. Supabase PostgREST checks the signed token and PostgreSQL owner/member RLS. The browser cannot choose an actor/account/tenant through a query or body.
- HTTP 200 returns only `state: AVAILABLE | EMPTY_OR_UNPROVISIONED`, basic account summaries, `source: SUPABASE_RLS_READ` and `financialState: NOT_INCLUDED`. It deliberately omits cash, balances, performance and user/session identity. HTTP 401 = absent session; 403 = upstream authorization denied; 503 = unavailable or invalid upstream evidence. 404 = disabled, 400 = invalid path/filter.
- Do not interpret zero visible accounts as zero invested capital. A production SQL schema/RLS and real provider/JWT/account smoke test are still unapproved and unperformed. This R1 candidate makes no remote DDL/DML, Vercel deployment or API activation.
- Unit tests cover the disabled gate, configuration drift, forged query filters, session failures, sanitized errors, no-store and no fake financial values. Existing isolated PG17 RLS tests remain required.
