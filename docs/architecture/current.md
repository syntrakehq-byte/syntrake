# SYNTRAKE — current architecture / state pointer

**Status rule:** this is the architecture entry point **only when it belongs to an explicitly accepted `main` SHA**; copies in PR branches remain candidates.  
**Snapshot:** 2026-10-23  
**Repository:** `syntrakehq-byte/syntrake`  
**Accepted predecessor at snapshot (2026-10-23):** `d42ecf58ca46c0e33d866cced2cdf14aa36eced0` (historical; re-check live `main`).  
**Supersedes:** no historical code, migrations, audits, or accepted financial state.

> **Publishing rule:** on a PR branch this is a candidate index. It becomes the canonical entry point **only** when incorporated into a reviewed, explicitly authorized `main` SHA. The gate is verified from GitHub history and PR reviews, never inferred from this file alone. The information below is a dated snapshot, **not live state**; check GitHub/Supabase/Vercel before decisions.

## 1. Architecture decision

The project owner explicitly approved architecture decisions **D1–D7 on 2026-10-23** and authorized creation of documentation PR #24 **without merge**. That architectural decision **by itself** does not approve any commit, functional PR, database migration, production deployment or broker/live operation. Publication must be verified separately by the accepted `main` SHA.

- **D1:** modular monorepo; operational workers independent of Web.
- **D2:** platform may share identity verification, market data and operations; Investing/Trading financial state, mandates, risk, decision history and execution authority are isolated.
- **D3:** R0–R7 dependency graph; R3-A operations and R3-B Market Data independent; R6/R7 gated by domain.
- **D4:** longitudinal financial truth; user-reported/unverified positions must never become broker-confirmed cash or performance by assumption.
- **D5:** first prove safe, durable worker operation; financial automation only through separately authorized mandates/gates.
- **D6:** audit trail, accepted predecessor→candidate SHA, independent review and separate Production gate.
- **D7:** first-portfolio privileged RPC warning and real Clerk A/B isolation require dedicated security checks before promotion.

For detailed contracts, state transitions and roadmap: [Architecture & Roadmap V1](./SYNTRAKE_ARCHITECTURE_ROADMAP_V1_2026-10-23.md).  
For dated original inspection and limitations, preserved unedited: [Architecture Audit V0](./audits/SYNTRAKE_ARCHITECTURE_AUDIT_V0_2026-10-23.md).

## 2. Observed snapshot — NOT a live status endpoint

| System/capability | Snapshot evidence | Gate |
|---|---|---|
| GitHub `main` at 2026-10-23 snapshot | `d42ecf58ca46c0e33d866cced2cdf14aa36eced0` | historical accepted baseline; verify current SHA and new approvals |
| PR #20 (R2-A import normalizer) | Draft `ed8c30a3a25d03fbba1f27009f21c4772034b549` | audit exact diff against main |
| PR #21 (R2-B1 snapshots) | Draft `d3cc2022b5ee9acd3012888cc85c2627f1ce0a9d` | audit stacked diff against #20 |
| PR #22 (R2-C onboarding) | Draft `2f6467065a854ff90c08783a347b01eb0b81672a` | audit stacked diff against #21 |
| PR #23 (R2-C2 first portfolio) | Draft `26170947e4a126ef898de857f6ee2e13ae657f22`, 7/7 CI success observed | BLOCKED for promotion pending RPC security, real A/B and migrations |
| Supabase Production | `vbazzxqyuqcrmjytaboc`, two registered migrations at snapshot | no candidate migrations approved |
| Supabase Preview | `zkqgpejlkgootkvkebhd`, 12 migrations at snapshot | differs from Production; explicit reconciliation needed |
| Security Advisor Preview | WARN: `authenticated_security_definer_function_executable` on `investing.provision_first_portfolio` | privilege/JWT/owner/ACL/RLS/Data API audit |
| Vercel Production | `dpl_2Lh5ZP2iEViPtb3ikjdoVFTTpbV3`, READY, SHA `d42ecf58ca46c0e33d866cced2cdf14aa36eced0` | READY ≠ autonomous operation |
| Vercel Preview | `dpl_3VhuWt4yQvu7RZkRewqVzcvy1Vuo`, READY, SHA `26170947e4a126ef898de857f6ee2e13ae657f22` | not an approved financial release |
| R0 basic sign-in | accepted only for observed UI/login scope | two genuine identity A≠B integrated negative tests still required |
| R1 financial foundation | accepted only for narrow ledger/read-only scope | not a reconciled living portfolio |
| R2 living portfolio | partial / draft candidates | financial truth, end-to-end flow, security and release gates |
| R3-A/R3-B, R4/R5, R6 | not identified as implemented in inspected new stack | implement/test each slice when authorized |
| R7 Live | BLOCKED by design | mandates, security, evidence, legal and explicit approval |

**Financial truth:** Preview synthetic ledger entries are not broker confirmations. Production zero observed rows do not mean user cash = €0 or no invested capital.

## 2.1 R0 closure decision — 2026-10-23 (later than the above snapshot)

**R0 foundation security baseline — ACCEPTED, CLOSED IN PROVED TECHNICAL SCOPE**. This decision records the completed 2026-10-20 real A/C Preview rehearsal, the clean R0-A integration through merged PR #9 (`c7aaa43537ad57eb40b7463e5ce354d6cf107be6`), successful exact-SHA CI and fresh 2026-10-23 read-only Supabase Production/Preview privilege and teardown checks. The current accepted `main` (`d42ecf58ca46c0e33d866cced2cdf14aa36eced0`) retains that R0 merge in its ancestry.

**Evidence + exact scope:** [R0 foundation security closure](./closures/R0_SECURITY_CLOSURE_2026-10-23.md). The historical row above (“R0 basic sign-in ...”) is the original snapshot and **is superseded for the merged foundation scope only**, not deleted. No need to rerun completed A/C rehearsal without a specific new risk.

**Not covered:** Production effective Clerk JWT for newly enabled Investing routes; R2-C2 privileged first-portfolio RPC and separate real A/B integration; unmerged R2/R3 features. Those have their own fail-closed release gates. No R2 authorization, migration, writer, or deploy is implied. The scoped R0 technical acceptance is not an independent third-party security certification.

**Next sequential phase:** R1 evidence reconciliation/closure before R2. This index addendum itself is **candidate documentation** until PR #24 is reviewed and explicitly authorized for merge to accepted `main`.

## 2.2 R1 Investing technical closure — 2026-10-24 (later decision)

**R1 INVESTING FINANCIAL FOUNDATION — ACCEPTED / CLOSED IN PROVED TECHNICAL SCOPE.** The merged canonical Investing implementation now includes PR #27 at `main@29f1c068769e34a84e87717ac8cc9286dd937938`. The R1 code has been subjected to real PG17/synthetic-A/C evidence, Production read-only migration validation, real Clerk authenticated empty-account discovery in `r1.syntrake.com`, and no-cookie/no-query `401 UNAUTHENTICATED` API rehearsal. The original dated R1 snapshot above is preserved as historical context, not an up-to-date gate decision.

**Full scope, limitations and provenance:** [R1 Investing technical closure](./closures/R1_INVESTING_TECHNICAL_CLOSURE_2026-10-24.md). This technical acceptance does **not** say the latest R1 UI is published on `www.syntrake.com`; the official-domain promotion is a separate, unperformed release gate. The user explicitly directed **no further Stripe work**, so commercial billing/webhook state is **out of scope and unverified**, not silently passed or deleted.

**NEXT ACTIVE PHASE: R2 — Investing living portfolio, starting with existing-candidate audit.** All R2 PRs #20–#23, #25 and #26 remain Draft and unmerged as of this 2026-10-24 verification, stacked on an older accepted baseline. They require a fresh main-relative lineage/diff, auth/tenant/SECURITY DEFINER, financial truth and Preview/Production migration audit before implementing, merging or releasing. No automatic reuse of expired Preview evidence as Production authority.

**Documentation status:** this addendum exists in **PR #24 only** until its exact SHA is independently reviewed and explicitly authorized for integration into `main`. Functional R1 code acceptance in `main` is already real; documentation publishing is separate.

## 2.3 R1 official Production promotion — 2026-10-24 (later than §2.2)

**DEPLOYED:** `www.syntrake.com` now serves the exact previously approved merged R1 build `main@29f1c068769e34a84e87717ac8cc9286dd937938` through Vercel READY deployment `dpl_FkMG3sVQyAspj7bSpeVsrj5zG8xD`. This replaces the prior official alias `dpl_2Lh5ZP2iEViPtb3ikjdoVFTTpbV3` (SHA `d42ecf58...`), which is retained. Official read-back, site routes `200`, unauthenticated protected redirect `307`, account API denial `401`, forged selector `400`, registered Production R1 migration and table ACL/RLS audits passed after promotion. No new SQL/financial writes or Stripe work.

**AUTHENTICATED POST-RELEASE USER REHEARSAL: PENDING.** A live Clerk session and owner-scoped R1 API returned correct empty-state on `r1.syntrake.com` before promotion. The same authenticated end-to-end flow on official `www.syntrake.com` must still be observed by an actual signed-in user; `GET /sign-in = 200` alone does not prove it. See [R1 closure §6](./closures/R1_INVESTING_TECHNICAL_CLOSURE_2026-10-24.md#6-official-production-promotion-and-read-only-postflight--2026-10-24-after-original-closure) and merged PR #27 release audit note.

**Publication and acceptance remain separate.** R1 is deployed on www; technical scope accepted. R2 Draft stack still unmerged; PR #24 remains documentation-only candidate pending exact-SHA review and separate merge approval.

## 3. Process for next work

1. For each architecture revision, independently review the candidate diff against the accepted predecessor and preserved V0. Verify scope, lineage and absence of unintended code, SQL, config or workflow changes.
2. Require explicit authorization before merging the exact reviewed SHA. **Do not infer merge authorization from D1–D7**; check [the documentary PR #24](https://github.com/syntrakehq-byte/syntrake/pull/24) for this V1.
3. **R2-C2-specific security audit:** `investing.provision_first_portfolio`, Clerk session A≠B and negative UI/API/RPC/DB tests are release gates of that new privileged financial surface, **not a reason to invalidate previously accepted R0-A**.
4. Audit PRs #20–#23 by exact stacked lineage and compare Preview vs Production migration histories, grants and RLS before any release.
5. Prepare R3-A harmless durable worker and independently R3-B market-data adapter; no premature financial execution.

## 4. Update rules

- `current.md` is a mutable **pointer** with timestamp, reviewer, accepted predecessor, candidate SHA, blockers and evidence, not an immutable historical audit.
- Preserve V0 and past reports unchanged. Use explicit version/supersedes for future revisions.
- Update this pointer only in a reviewed, Git-versioned candidate. Never invent verification, cash, prices, risk or authority.
- The PR head SHA, CI state, Supabase migrations and Vercel deployment must be re-read from their actual providers before promotion.
- A documentation PR grants **no** authority to merge functional code, change financial tables, enable a writer, send orders or deploy.

**Permanent gate:** this index does not grant authority for any merge, migration, production deployment or financial operation. Review/acceptance of each exact SHA and the remaining Investing/Trading security gates are separate.
