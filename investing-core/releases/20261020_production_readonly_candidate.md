# Investing — Production read-only release candidate (NOT APPLIED)

**Predecessor (accepted)**: `main@036a3166997214d556c4f02c8f2d851390abdb52` (first release preflight merged).
**Candidate scope:** create a reviewed SQL release artifact and a fail-closed production account-read contract. This document does not authorize Supabase/Vercel changes, live accounts, financial writes or brokerage access.

## 1. Exact intended application

- Supabase project: `vbazzxqyuqcrmjytaboc`, Paris `eu-west-3`, PostgreSQL 17.11, **not Preview** `zkqgpejlkgootkvkebhd`.
- Vercel project: `prj_JLOTCtdLdHfFDCj7GhUaf9NdVQEC`; commercial site currently on an older accepted app deployment. `main` git deploy is deliberately disabled in `vercel.json`.
- HTTP route `GET /api/investing/accounts` and page `/investing/accounts` share the same server-side release gate, default **HTTP 404** on production. Sign-in is always based on Clerk server `auth()`, not on browser-supplied actor/account/tenant data. Supabase PostgREST must verify the signed Clerk third-party JWT, then enforce financial membership RLS.
- The only allowed data for this slice is **account UUID, account name and 3-letter base currency**, with `financialState: NOT_INCLUDED`. No cash, positions, deposits, income, returns, account opening or write HTTP endpoints.

## 2. Release SQL artifact (candidate, not migration-applied)

`supabase/release-candidates/20261020180000_investing_first_readonly_release.sql`

This is a **forward-timestamped, exact source-copied composite** of accepted:
- `20261017160000_investing_core_foundation.sql` (Git blob `e572262de0c07a39132d7417febb0b551a7ddc64`).
- `20261018070000_investing_owner_membership_guard.sql` (Git blob `0773eb0713defa1d267e881880f869fceaa0dda0`).
- Plus an explicit **least-privilege `REVOKE SELECT`** for authenticated users on private identity, portfolios, ledger accounts/journals/entries. Read of investment accounts and membership stays permitted under RLS. No writer role, no financial DML, no fixture/account creation.

The artifact is intentionally **outside** `supabase/migrations` so standard migration discovery cannot inadvertently replay historic Git migrations on a production database with newer `20261017191056 remote_schema` history. It must not be applied or renamed merely to silence CLI drift. Before authorization, independently decide whether the final migration will become a new canonical file in `supabase/migrations` and how to preserve past local/remote history without duplicate DDL; rehearse the exact approved tool/CLI execution in a separate disposable PG17 instance and record the applied version/hash/target. **This unresolved migration lineage is a release blocker.**

The existing historical `20261018074500_investing_contribution_writer_capability.sql` is **not** part of this read-only release. The `supabase/rehearsal/migrations/20261018112500_investing_writer_runtime_login.sql` is Preview-only and **never** a production prerequisite.

The `investing-release-readonly-pg17` GitHub workflow now executes this **exact compiled SQL candidate** in a clean isolated PostgreSQL 17, compares both embedded source chunks byte-for-byte with original versioned migrations, and verifies that the data API's `authenticated` role has no financial write capabilities, cannot read private ledgers, cannot bypass membership RLS, and no writer role/login is created. This is math/DB/privilege proof, not a proof of live production signature/JWT configuration.

## 3. Production release gate: two independent operator controls

`isR1AccountReadEnabled(process.env)` permits production reads only when **all** of the following hold:

- `VERCEL_ENV=production` and `VERCEL_GIT_COMMIT_REF=main` (platform-owned values).
- `INVESTING_R1_PRODUCTION_READ_MODE=enabled` **explicitly** (defaults `disabled`).
- `INVESTING_R1_PRODUCTION_APPROVED_SHA` is **40 lowercase hex characters** and equals the platform-provided `VERCEL_GIT_COMMIT_SHA` for the **exact approved deployment**.
- `INVESTING_R1_SUPABASE_PROJECT_REF=vbazzxqyuqcrmjytaboc` and `NEXT_PUBLIC_SUPABASE_URL=https://vbazzxqyuqcrmjytaboc.supabase.co` exactly.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` matches Supabase **publishable** key syntax. No secret/service_role key permitted.

If any property is missing, the API and the page **remain 404** without reading financial data. A syntactically valid key is **not** proof the key belongs to that project; only a real cryptographic third-party JWT + RLS test can prove that integration. Signed-JWT failure or missing schema returns unavailable, never empty balance/€0.

Preview may use only an allowlisted candidate branch and previously verified Preview project with separate opt-in. Production and Preview cannot be cross-wired.

## 4. Production gates remaining BLOCKED

1. **Lineage:** close historic Git vs remote migration-history drift without historical mutation; make a canonical new-version release migration and independently rehearse it under production-like history, then fix its exact SHA.
2. **Clerk/Supabase configuration:** independently verify production issuer/audience/token template, Supabase third-party Clerk integration, **Exposed schemas** listing includes `investing`, correct API publishing permissions, policies, runtime env wiring, and a secured isolated positive/negative user/tenant test. No public JWTs, bearer credentials or user IDs in evidence.
3. **Accounts:** production schema creates **zero** customer accounts. Define and validate server-owned, transactionally idempotent account onboarding (or narrowly scoped operator provisioning) before calling the interface usable. Account absence is **UNPROVISIONED**, not zero invested capital.
4. **Site rollout:** controlled deployment of the **exact accepted SHA** staged without production customer alias before final promotion. Verify Clerk login, existing commercial pages, Stripe subscription/webhook semantics, JWT/RLS, wrong account/session denial, error handling, log hygiene and old-site rollback policy. Never switch DNS/aliases or enable automatic `main` deployment without final cutover authorization.
5. **Financial authority:** no contribution writer activation, no brokerage credentials, no paper/live capital movement. Service-role capability is not authorization.

## 5. Required explicit approval boundaries

Approval A: **apply identified, audited migration SQL to Supabase Production** (separate operator consent, exact project/ref/SQL SHA, migration history checked).

Approval B: **deploy an exact Git SHA to Vercel Production** (separate consent; preserve existing customer domain until staging gate passes).

Approval C: **activate/read-only production functionality and promote staged deployment to the commercial domain** (separate consent after real signed Clerk JWT/RLS and account/source evidence).

**Current verdict: candidate code/test preparation only; not ready for production, zero DDL/DML/deploys.**
