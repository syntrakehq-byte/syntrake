# SYNTRAKE — R0→R2: release preflight / migration plan (2026-10-29)

**Verdict: NO-GO Production.** This is an operator plan, *not* a migration, CI acceptance, approval to deploy or a claim of end-to-end cumulative PASS.

## Immutable evidence / scope

- Production Git baseline: `main@29f1c068769e34a84e87717ac8cc9286dd937938`. Last observed READY Production Vercel deployment points to this SHA.
- BL2/BL3 source accepted for targeted rehearsal: `feat/bl2bl3-canonical-draft@e826e7627bed4b38a2cbd0ae498f64b0c0b25780`, PR #43 Draft; 12/12 CI workflows PASS.
- Release PR #44 targets `main`; original comparison contains **185 commits / 87 changed files**. Review the full stack, not just PR #43's 25 files.
- Production Supabase: `vbazzxqyuqcrmjytaboc`, PostgreSQL **17.11**, existing migration registry versions **20261017191056 remote_schema** and **20261020180000 investing_first_readonly_release**. There are no R2 migration records in Production.
- Production schema contains `investing.portfolios` but NOT `investing.onboarding_intents`, `investing.initial_portfolio_receipts` or `investing.onboarding_revisions`. Current Production Investing financial tables inspected were empty; never infer that will remain true at release time.
- Repository `supabase/migrations/` has three older baseline SQL files whose names/versions are **not the Production migration registry**. **NEVER run an unreviewed `supabase db push` or repair migration registry to force compatibility.**
- One disposable Supabase branch already proved real Clerk A/B → onboarding → R2-C2 first portfolios → BL2/BL3 revisions/correction/idempotency → A/B denial both ways. Two distinct owners and portfolios, no ledger transactions/entries. Branch **deleted** and Vercel rehearsal flags/DSNs deactivated afterward. That is *not* full-R2 or cumulative-R0→R2 coverage.

## Source candidates for a *future* production-compatible migration bundle

Candidate SQL from the verified source lineage, **in dependency order**:

1. `supabase/release-candidates/20261022200000_r2b_unverified_portfolio_imports.sql`: 4 immutable import tables, NOLOGIN `investing_import_writer` and owner-scoped RLS.
2. `supabase/release-candidates/20261022210000_r2c_onboarding_intents.sql`: append-only self-owned Clerk JWT declarations.
3. `supabase/release-candidates/20261023063000_r2c2_first_portfolio.sql`: canonical empty account/portfolio receipt and NOLOGIN `investing_initial_provisioner`.
4. `docs/r2/bl2bl3-candidate.sql`: private revision/projection/event tables, constrained `investing_bl2bl3_runtime` and `investing_bl2bl3_owner`, immutable lifecycle. This is currently **review SQL**, not a versioned migration. CLI version generated at 20261029201005, now pinned at `supabase/release-candidates/20261029201005_r2_bl2bl3_canonical.sql` with exact matching Git blob. It is STILL candidate-only and must be formally reviewed before any Production DDL.

The first three and BL2/BL3 candidate **did apply to a disposable branch cloned from Production** during the real A/B test. Do **not** treat that as proof of production deployment, data-preserving upgrades or full R2. Validate exact SQL hashes / role ownership / grants / migration naming again against the Production baseline.

**Hard exclusion:** NEVER include these historical Preview-specific release candidates in a generic Production migration push:

- `20261024190500_r2_preview_import_coverage_forward_compat.sql` — refuses a clean baseline where new R2-B1 already has coverage columns; for historical Preview lacking them only.
- `20261024194500_r2_preview_revoke_legacy_provision_rpc.sql` — SHA-gated revocation of a historical Preview-only privileged function, not a Production migration.
- `20261024205500_r2_preview_import_runtime_nologin.sql` — historical dormant Preview runtime role, not a Production runtime/credential plan.

**Proposed artifact preparation:** generate new canonical sequential migration files using `supabase migration new` with the actual installed CLI, preserving the four independently auditable SQL boundaries. Never embed passwords or production user fixture data, and never rewrite existing Production migration history. Create an explicit rollback/compensation plan for schema deployment; do not assume role/table DROP is a safe reversible migration once data exists.

## Confirmed blocker before full R2 cumulative rehearsal

At the original BL2/BL3 SHA, `investing-core/server/importPreviewRuntime.ts` was **hardcoded to a deleted historical project** (`zkqgpejlkgootkvkebhd`), `db.<ref>.supabase.co` IPv6 direct PG and a `NOLOGIN` import runtime role. It could not operate with the new single disposable A/B branch from Vercel. This invalidates any claim that the full R2 import slice was remotely proven.

The PR #44 release branch introduces an isolated **candidate fix** to use the same explicitly authorized Preview ref, TLS-verified **Session pooler 5432**, and a distinct `investing_import_preview_login.<branch_ref>` (NOINHERIT/NOBYPASSRLS) with `SET LOCAL ROLE investing_import_writer`. This change and its tests **require new CI plus real branch proof**; do not copy this login into Production or enable the feature simply because an env gate returns true. Maintain independent separate credentials for R2-C2 and BL2/BL3.

## Release stages / proof matrix

1. **Schema/lineage audit (read-only):** exact Production migration registry, existing objects, default privileges, RLS, functions, user rows, compatibility and code SHA. Fail closed on any unexpected drift.
2. **Code/SQL review:** 185-commit cumulative diff, all new changes, import runtime restriction, read-only security checks, routes, and separate authenticated proof probe removed from release artefacts. All tests (investing, PG17 imports, RLS, historical upgrade, coverage, security, R0/R1) must pass on one final candidate SHA.
3. **Local PG17 release rehearsal:** import the actual Production baseline/registry into an isolated PG17 instance; apply proposed versioned migrations in order; verify no unrelated schema/ledger changes, RLS/role memberships, idempotency and deliberate failure rollback. Preserve a before/after SQL catalogue diff.
4. **Paid Supabase `R2_PHASE` rehearsal (independent cost approval):** create **one fresh disposable branch cloned from Production** after the release package is ready; apply four audited migrations; create three distinct least-privilege LOGINs for initial portfolio, BL2/BL3 and import. Configure branch-scoped Vercel Preview on exact SHA only with issuer/CA/pooler. Real signed Clerk A/B → onboarding → first accounts → revisions/corrections/replay/denials → **import write, durable owner readback, comparison, replay and cross-user rejection**. Verify all data in PG, no journal postings. Remove secrets/branch on completion. Do not use public privileged RPCs.
5. **Separate `R0_TO_R2_CUMULATIVE` rehearsal:** start again from a fresh clone of Production (no reuse of test data), prove R0 foundational ledger/RLS invariants and R1 read-only login then complete every R2 phase above. Include proof of rejecting forged/expired identities, readonly operation denial, finance ledger unchanged except explicitly authorized test-only operations. Reconcile migration history and exact inputs/outputs, teardown.
6. **Production GO/NO-GO (separate authorization):** only after cumulative PASS, staged Production-compatible migration plan and backup/restore/rollback, least-privilege permanent production runtimes, rollout guards, signed Release SHA, green CI and manual owner approval may production DDL / Vercel Production staging or merge occur. Preview-only gates as coded do not make Production R2 operational by merging.

## Stop conditions

- Any new paid branch before code and SQL full-release gates are ready.
- `main` or the Production Supabase project targeted in a Preview operation.
- Any unaudited `CREATE ROLE LOGIN`, `BYPASSRLS`, `service_role` credential or browser-accessible privileged writer.
- Changing old Production migration registry to hide drift.
- Treating 12/12 CI or BL2/BL3 targeted HTTP 200 as a completed full R2 or cumulative rehearsal.
- Import runtime remains bound to the old project or cannot authenticate through TLS-verified session pooler.
- Deploying or merging on the assumption that Production has the R2 database schema.

**This document authorizes no Production write, merge or new paid resource.**

## 2026-10-29 CLI cumulative PG17 release rehearsal

Supabase CLI v2.84.2 generated the fourth candidate version `20261029201005_r2_bl2bl3_canonical.sql` in disposable GitHub Action run `40946314406`; the exact SQL is now frozen under `supabase/release-candidates/` (NOT `supabase/migrations/`). This is the same SQL as `docs/r2/bl2bl3-candidate.sql`, pinned by source Git blob.

The dry-run planned precisely four R2 migrations after the two accepted Production-history versions. The CLI applied them to **loopback-only PG17** and confirmed database registry order, 19 RLS-enabled tables, 18 FORCE RLS, four NOLOGIN capabilities, no user-callable privileged SECURITY DEFINER function, and zero financial journals. A second dry-run did not propose migration replay. This is not a Production deploy nor a signed Clerk full import A/B.
