# SYNTRAKE Investing — first production release: preflight (2026-10-20)

**Purpose:** prepare—not execute—the first controlled Investing production release.
**Accepted predecessor SHA:** `e50670d2123463ece13cab1da74232221fd86025` (R0-A / R1-A / R1-B closed **in Git**).
**Targets:** Supabase production `vbazzxqyuqcrmjytaboc` (Paris, eu-west-3, PostgreSQL 17.11); Vercel `syntrake` project `prj_JLOTCtdLdHfFDCj7GhUaf9NdVQEC`.
**Release decision:** **NOT AUTHORIZED / NOT READY FOR PRODUCTION**. No production DDL/DML, financial postings, Vercel deployment or Git merge is permitted by this document.

## Verified as-of observations (direct GitHub, Supabase, Vercel reads)

| Fact | Evidence / conclusion |
|---|---|
| Accepted code `main` | `e50670d2123463ece13cab1da74232221fd86025`; no branch divergence at preflight. |
| Vercel production | Most recent READY deployment has older `main@8e0525a4a9916bffdb5f326b433f50ccfc5537f3`; new Investing sources are **not deployed**. |
| Vercel safeguard | Accepted `main/vercel.json`: `git.deploymentEnabled.main=false`; do not remove to publish implicitly. |
| Vercel code delta | Comparing deployed commit against accepted main: 160 commits ahead, 40 changed files, mainly Investing Core, SQL, tests, npm lockfile and tsconfig. **A green Next build is not proof of zero commercial regression**; review Clerk/Stripe compatibility before cutover. |
| Supabase production DB | Active, PG17.11; `investing` schema 0, Investing account/ledger tables absent, contribution-writer/runtime roles absent; existing `public` table count 0 at inspection. |
| Supabase production migration history | **Only** `20261017191056 remote_schema` is registered. No Investing migration is applied. |
| Supabase production security advisor | Returned zero lint findings at inspection, **not** a substitute for future RLS/JWT audit. |
| Supabase Preview DB | Historical foundation/RLS A/C ownership and synthetic journals were independently tested; **Preview is not production truth** and user-facing roles are not production deployment authority. |
| Preview migration history | `20261017191056 remote_schema`, `20261017191352 investing_core_r0a_foundation_f0a9c5c5`, `20261018072636 investing_owner_membership_guard_467bd9b7`, `20261018074500 investing_contribution_writer_capability`, `20261018112500 investing_writer_runtime_login`. These remote versions **do not match** all Git file timestamps and must not be copied/repaired in production history by assumption. |

## Source SQL dependency and proposed minimal read-only subset

The accepted Git repo contains **three** top-level Investing migrations:

1. `supabase/migrations/20261017160000_investing_core_foundation.sql` — 9 financial tables, immutable ledger constraints, auth/RLS, read-only membership grants; creates the `investing` schema, no user accounts.
2. `supabase/migrations/20261018070000_investing_owner_membership_guard.sql` — deferred invariant enforcing canonical owner membership at COMMIT. Must run after (1).
3. `supabase/migrations/20261018074500_investing_contribution_writer_capability.sql` — creates the `investing_contribution_writer` financial INSERT/UPDATE capability (**NOLOGIN**) and grants/policies. **EXCLUDE from a read-only first release**. It is not required for R1 account discovery.

`supabase/rehearsal/migrations/20261018112500_investing_writer_runtime_login.sql` is a **rehearsal-only, externally applied script**. Never include it in production schema rollout. Do not promote Preview memberships/accounts/journals or pretend they represent customer holdings/cash.

**Migration lineage warning:** two accepted migration filenames are **older** than the existing production `20261017191056 remote_schema` entry. Do **not** simply run `supabase db push` against production, backfill history, rename historical files, or mark versions as applied. Before production, generate a **new forward-only, versioned release migration** through the reviewed CLI process, with a canonical SQL body consisting of exactly the source-reviewed foundation and owner-guard SQL in order. Preserve hashes and version lineage for both sources, validate its migration name/order against real remote history in a disposable rehearsal, and avoid duplicated application. Treat any migration-history discrepancy as **BLOCKED**. Do not use the plain `apply_migration` tool on production until that exact artifact and operator authorization are accepted.

**Nonproduction test introduced by this release preflight:** `investing-core/tests/pg17-release-readonly.test.ts` applies exactly (1) and (2) on clean isolated PostgreSQL 17, proves 9 RLS tables, authenticated SELECT but no INSERT/UPDATE permissions, no writer role, owner membership COMMIT invariant and tenant A/C/missing-subject SELECT isolation. It deliberately does **not** run writer capability or the rehearsal LOGIN. This test is a **SQL subset gate**, not proof of configured signed Clerk production JWT or Vercel live traffic.

## What prevents a functional production Investing release

1. **Production JWT + Data API exposure not proved:** signed Clerk production token issuer/audience/third-party integration must match Supabase production, and the `investing` schema must be deliberately exposed only with the required authenticated SELECT + RLS. Preview working does not establish production settings. Confirm the Supabase Data API's *Exposed schemas* setting. Source: Supabase “Using Custom Schemas” and “Clerk third-party auth”.
2. **Existing production Investing API/UI deliberately disabled:** `isR1AccountReadEnabled()` currently requires `VERCEL_ENV=preview`, exact `candidate/investing-r1b-accounts-ui-20261020` ref, and Preview project ref `zkqgpejlkgootkvkebhd`. Production will return **404**, even after schema migration and Vercel deploy. A separate reviewed **production read-only gate** must be built and its default remain **disabled** until independent signed-JWT/RLS A/C negative/positive rehearsal in staging and operator release approval.
3. **No customer account provisioning workflow:** the accepted R1 UI reads already provisioned memberships; installing schema creates **zero** verified customer accounts. A zero-row result is `EMPTY_OR_UNPROVISIONED`, never €0, a broker account or an invested balance. An authenticated, server-owned, transactional, concurrency/idempotency-tested account onboarding/import path (or a separately audited operator provisioning process) is required before claiming a usable customer workflow.
4. **Commercial/site regression not yet proven:** Clerk login, existing pages, Stripe webhook/checkout/subscription and deployed site domain must remain functional at exact release SHA. New Vercel Production build must be staged under separate approval and checked **before** any promotion or DNS/alias change.
5. **Unresolved full-live operating authority:** no production writer connection, service-role authority, broker connection, execution permissions, transaction authority or live account balance are to be enabled. Read-only release cannot silently inherit the optional writer capability.

## Proposed production cutover sequence (independent approvals required)

**Gate P0 — release contract:** fix the exact intended functionality, tenant isolation, migration source SHA/hash, provider/JWT config, site compatibility, fail-closed behavior and rollback/kill-switch policy; stage candidate branch/commit; independently review diff + CI + this isolated PG17 test.

**Gate P1 — schema rehearsal:** on a disposable PG17 database representative of production including `remote_schema` migration history, rehearse the exact future-version migration with only foundation + owner guard; test non-owner/anonymous denied, no DML for browser roles, expected table/grant/RLS shape, no existing data rewritten and no writer role. Obtain explicit authorization before *any* Supabase production DDL.

**Gate P2 — controlled production DB apply:** confirm target ref `vbazzxqyuqcrmjytaboc` and history; apply only explicitly approved migration at the approved SHA, inspect migration history/pg_policies/grants/roles, run read-only reconciliations. Abnormality → halt; no silent drift repair or destructive rollback.

**Gate P3 — production read-only application:** after production JWT and API exposure are independently verified, stage exact-SHA Vercel Production **without assigning customer domains**. With explicit deployment approval, validate Clerk authenticated and unauthenticated access, tenant isolation, no financial values, commercial regression and logs. Promote same exact build to live domain **only after a separate final cutover approval**. `main` auto-deploy remains blocked until a conscious policy decision.

**Gate P4 — postrelease:** monitor read errors, auth/RLS isolation, ledger integrity, user account visibility and site health. Disable new Investing endpoints first on any ambiguity. Historical financial ledger mutations are never an acceptable rollback strategy.

## Gate verdict

**Release preflight can become ACCEPTED FOR PREPARATION after CI; production release remains BLOCKED** until all release-specific authority, schema/JWT, code, readiness and cutover gates are proven. **No progress signal may be interpreted as deployed funds, cash, accounts, broker positions or investment performance.**
