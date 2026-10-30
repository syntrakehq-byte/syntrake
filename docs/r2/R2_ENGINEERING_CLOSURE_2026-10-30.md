# SYNTRAKE Investing — R2 engineering closure (2026-10-30)

> **Status: R2 implementation CLOSED for internal / first-owner use.**
> **Customer-launch security status: NO-GO pending [#47](https://github.com/syntrakehq-byte/syntrake/issues/47).**
> This closure does **not** certify complete signed-Clerk A/B end-to-end security across R2-D, nor authorize live trading or verified balances.

## Baselines and change control

- Production source reviewed and deployed at `main@7dfd8373798a271c312197e9d92adc08f9b91b49`. Vercel Production deployment `dpl_8dEPTiUr2HMzMvZ47h5Jw48aacvG` READY when checked. Production gate pins that **exact SHA**, not any future merge commit.
- Production Supabase `vbazzxqyuqcrmjytaboc` PostgreSQL 17.11. Seven versioned schema migrations, including R2-C3 `20261030173329`. All 19 Investing tables have RLS; 18 FORCE RLS, the global currency lookup excluded.
- `PR #46` test-only candidate SHA `8156373ffb9e76134bfff1c7eeef7255302a39a7`: 12/12 GitHub Actions PASS, including the isolated `investing-r0-r2-cumulative-pg17` workflow, run `41114272149`, job `124264277401`. Reported TAP: 1 test, 1 pass, 0 fail. No Production accounts, migrations, runtime secrets or ledger mutations from this run.
- **Caution after merging this report:** repository `main` advances, but Production is still deployed at the earlier pinned SHA. Do not redeploy `main` without a separate review of the approved-SHA gate and a deliberate release decision; do not set a new SHA speculatively.

## Implemented capabilities and actual proof

| Slice | Accepted evidence | State |
|---|---|---|
| R0/R1 | Read-only Release contract, ledger invariants, role and RLS negative tests under isolated PG17 | PASS in isolated CI; prior R0/R1 operational acceptance stands |
| R2-C | First-owner Production user-reported onboarding persisted under signed Clerk session | PASS |
| R2-C2 | One real empty investment account/portfolio, initial receipt, 6 structural sub-ledgers, zero financial postings | PASS |
| R2-C3 | Owner-only existing account/portfolio read recovered after minimal column-level GRANT; RLS remains forced | PASS |
| BL2/BL3 | First-owner Production revisions: v1 applied → v2/v3 corrections, prior versions SUPERSEDED, objective really changed, all events preserved | PASS |
| R2-D | First-owner Production manual EUR cash declaration persisted, `UNVERIFIED` and `PARTIAL`; owner readback; no financial postings | PASS |
| R2-D/R2-E comparison | Two **synthetic persisted** import snapshots, deterministic BigInt delta, owner readback/list, replay/conflict, A/B denial, no FX/market performance inference | PASS in isolated PG17 CI |
| Cumulative R0→R2 | R0/R1 first read-only SQL + R2 candidates + R2-C3 grant, private role separation, synthetic A/B ACL/RLS/ownership, idempotency, corrections, imports, ledger invariant | PASS in isolated PG17 CI |
| Prior real Clerk A/B | Separate disposable branch real signed Clerk A/B onboarding/first portfolios/BL2/BL3, cross-user denial; older source SHA | PASS within that historical scope; **not** complete R2-D |
| Latest external PG17 A/B | Branch with PostgreSQL `SET LOCAL ROLE authenticated` / simulated JWT context A/B; real RLS isolation and two onboarding declarations; no live signed Clerk E2E | PASS for PG RLS only, **not** a signed Clerk test |

**Production read-only postflight (2026-10-30):** 1 investment account; 1 portfolio; 1 first-portfolio receipt; 3 revisions; 1 projection; 1 finalized import with cash row; **0 ledger transactions and 0 ledger entries**. This is user-declared, **not** brokerage-verified financial truth.

## Explicit exception / non-goals

**[#47 — Security gate before customer launch](https://github.com/syntrakehq-byte/syntrake/issues/47):** the last unproven scenario is a *new* R2-D import under two **distinct, cryptographically signed Clerk sessions** on one external disposable branch, including A/B read/list/write denial and replay. Previous real Clerk A/B proof covered earlier flows; no need to rerun them indiscriminately. The separate latest paid branch was deleted following an integration safety block. Its SQL-simulated actor checks do **not** replace signed Clerk JWT evidence.

Release policy: **internal first-owner R2 use allowed** under existing guards, **NO-GO for new third-party customers** until #47 is PASS. Never claim R2 security fully certified. This is a transparent engineering milestone closure with a tracked security exception, **not** unconditional external security sign-off.

Other exclusions: no verified broker accounts, live trades, payment posting, investment advice, FX conversion, realized profit, customer-facing performance claims or real market-price ingestion is introduced by R2.

## Operational handoff

1. Treat R2's *implemented internal Investing scope* as stable; keep R0–R2 invariant regressions mandatory.
2. Carry forward #47 as a hard pre-customer-launch security gate; prepare branch-bound Preview and signed Clerk A/B before creating another paid branch.
3. Begin R3 Market Data Core separately: instrument identity, provenance, timestamp/quality, historical data, FX, refresh policy, disabled-safe gates; do **not** reinterpret existing `UNVERIFIED` import figures as confirmed holdings.
4. Any future Production deployment must have explicit exact-source SHA review, separate credentials and a cumulative regression record.

**Decision:** `R2_INTERNAL_IMPLEMENTATION_CLOSED_WITH_TRACKED_SECURITY_EXCEPTION`.
