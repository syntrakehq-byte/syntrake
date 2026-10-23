# SYNTRAKE — current architecture / state pointer

**Status:** DOCUMENTARY PR CANDIDATE; **NOT YET CANONICAL ON `main`**  
**Snapshot:** 2026-10-23  
**Repository:** `syntrakehq-byte/syntrake`  
**Accepted predecessor (verified):** `d42ecf58ca46c0e33d866cced2cdf14aa36eced0`  
**Supersedes:** no historical code, migrations, audits, or accepted financial state.

> This index is a proposed *single entry point* for the roadmap and release evidence. It will not become the canonical published pointer before independent PR review, explicit authorization and merge. At every subsequent use, recheck live GitHub/Supabase/Vercel state instead of treating this dated snapshot as live.

## 1. Architecture decision

The project owner explicitly approved architecture decisions **D1–D7 on 2026-10-23**. Scope: architectural direction and permission to create this documentation-only PR **without merge**. This is **not** acceptance of the Git commit or approval of any functional PR, database migration, production deployment or broker/live operation.

- **D1:** modular monorepo; operational workers independent of Web.
- **D2:** platform may share identity verification, market data and operations; Investing/Trading financial state, mandates, risk, decision history and execution authority are isolated.
- **D3:** R0–R7 dependency graph; R3-A operations and R3-B Market Data independent; R6/R7 gated by domain.
- **D4:** longitudinal financial truth; user-reported/unverified positions must never become broker-confirmed cash or performance by assumption.
- **D5:** first prove safe, durable worker operation; financial automation only through separately authorized mandates/gates.
- **D6:** audit trail, accepted predecessor→candidate SHA, independent review and separate Production gate.
- **D7:** first-portfolio privileged RPC warning and real Clerk A/B isolation require dedicated security checks before promotion.

For detailed contracts, state transitions and roadmap: [Architecture & Roadmap V1 candidate](./SYNTRAKE_ARCHITECTURE_ROADMAP_V1_2026-10-23.md).  
For dated original inspection and limitations, preserved unedited: [Architecture Audit V0](./audits/SYNTRAKE_ARCHITECTURE_AUDIT_V0_2026-10-23.md).

## 2. Observed snapshot — NOT a live status endpoint

| System/capability | Snapshot evidence | Gate |
|---|---|---|
| GitHub accepted `main` | `d42ecf58ca46c0e33d866cced2cdf14aa36eced0` | remains accepted predecessor until candidate independently accepted |
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

## 3. Process for next work

1. Independent review of this documentation-only PR against accepted predecessor and original V0; verify no code, SQL, config or workflow changes.
2. Explicit authorization before merging the exact approved SHA. **Do not infer approval from D1–D7.**
3. Security audit: `investing.provision_first_portfolio`; two genuinely separate Clerk sessions A≠B, including negative UI/API/RPC/DB checks.
4. Audit PRs #20–#23 by exact stacked lineage and compare Preview vs Production migration histories, grants and RLS before any release.
5. Prepare R3-A harmless durable worker and independently R3-B market-data adapter; no premature financial execution.

## 4. Update rules

- `current.md` is a mutable **pointer** with timestamp, reviewer, accepted predecessor, candidate SHA, blockers and evidence, not an immutable historical audit.
- Preserve V0 and past reports unchanged. Use explicit version/supersedes for future revisions.
- Update this pointer only in a reviewed, Git-versioned candidate. Never invent verification, cash, prices, risk or authority.
- The PR head SHA, CI state, Supabase migrations and Vercel deployment must be re-read from their actual providers before promotion.
- A documentation PR grants **no** authority to merge functional code, change financial tables, enable a writer, send orders or deploy.

**Gate:** `REVIEW_REQUIRED`. No merge, migrations, production deployment or financial operations authorized.
