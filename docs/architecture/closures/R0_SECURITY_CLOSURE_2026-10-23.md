# SYNTRAKE — R0 security foundation: scoped technical closure

**Decision date:** 2026-10-23 (Europe/Paris)  
**Decision:** **R0 BASELINE / TECHNICAL SECURITY FOUNDATION — ACCEPTED IN ITS PROVED SCOPE**.  
**Authority:** owner explicitly requested closure of R0 after recovery of prior R0-A rehearsal evidence. This records the conclusion of the **already merged R0 foundation**, not a new deployment or blanket certification of future financial endpoints.  
**Repository:** `syntrakehq-byte/syntrake`  
**Accepted R0 foundation merge:** PR #9, merge SHA `c7aaa43537ad57eb40b7463e5ce354d6cf107be6`.  
**Current main verified 2026-10-23:** `d42ecf58ca46c0e33d866cced2cdf14aa36eced0`, a descendant of the R0 accepted merge (`64` commits ahead, `0` behind).  
**Canonical documentation status:** this record is a candidate on documentation PR #24 until the exact SHA has passed the document publication gate. No assertion that this document is already deployed to `main`.

## 1. Exact accepted scope

R0 for the **currently accepted foundation** covers Clerk identity binding on the server, account-owner/membership authority and row isolation under PostgreSQL RLS, fail-closed read endpoints, least-privilege roles, authenticated/same-origin rehearsal operations and retirement of temporary Preview writer authority.

It does **not** mean all R1/R2/R3/R4/R5 services are already deployed; R0 is not the UI/portfolio feature roadmap. R0 is not a once-for-all authorization of future API, RPC, worker, broker or execution modes. New surfaces must satisfy the same identity/RLS/security gate as part of **their own release**. Nothing in this closure authorizes Product/Production financial writes.

## 2. Reused evidence — no duplicate rehearsals

| Evidence | Observed result | Scope and limitation |
|---|---|---|
| R0-A operator-driven Preview rehearsal, 2026-10-20, [PR #8 discussion](https://github.com/syntrakehq-byte/syntrake/pull/8) | Two distinct operator-reported Clerk test actors A/C; positive A and C authenticated POST returned HTTP 200; A→C and C→A HTTP 403 | HTTP response itself does not individually prove the rejecting layer; pairing positive own POST with direct PostgreSQL owner attribution substantiates the no-cross-write result |
| Independently re-read Preview PostgreSQL at rehearsal closure | 2 committed **synthetic USER_REPORTED** ledger transactions, 4 balanced entries, 2 idempotency records, 0 integrity findings | No real broker cash, no return, no proof of concurrent **HTTP** race |
| Sequential replay, A and C | Existing same transaction IDs returned; no duplicated transaction or journal | Deterministic concurrency was tested separately in disposable PG17 |
| PostgreSQL 17 under candidate R0-A | 20/20 PG17 tests incl. cross-tenant denied, same-key contention, transaction atomicity, writer ACL; financial-domain tests passed | Isolated PG17 regression, not an unattended live broker/system test |
| R0-A Preview teardown, [PR #8 closure comment](https://github.com/syntrakehq-byte/syntrake/pull/8) | `investing_writer_runtime` NOLOGIN and membership to `investing_contribution_writer` revoked; original ledger retained | Old Preview deployment URLs might still exist, but database writer capability was disabled |
| PR #9 integration, [merged](https://github.com/syntrakehq-byte/syntrake/pull/9) | Temporary rehearsal HTTP/UI routes and writer pool removed; merged as `c7aaa435...` | PR #9 candidate SHA `d4d300df32cd771e706ba7d77721cca98bc34eec` has both `investing-core` and `investing-r0a-quality-gates` GitHub CI **SUCCESS** |
| Supabase Production read-only audit on 2026-10-23, project ref `vbazzxqyuqcrmjytaboc` | 9/9 Investing tables with RLS, 8 FORCE RLS, 0 `anon` SELECT, 0 authenticated INSERT/UPDATE/DELETE table capabilities, 0 exposed-client-executable Investing functions, 0 SECURITY DEFINER Investing functions | Catalogue/ACL evidence, not a real user JWT exercise against Production |
| Supabase Preview read-only audit on 2026-10-23, project ref `zkqgpejlkgootkvkebhd` | `investing_writer_runtime` NOLOGIN, membership to contribution writer absent; 2 tx / 4 entries / 2 idempotency keys / 0 ledger integrity findings | Preview contains other subsequent R2 structures and distinct privileged RPC; those are **outside the accepted R0 baseline** |

**Provenance:** actual PR/CI/GitHub lineage; operator-observed real browser HTTP results; direct database read-only rechecks. Different evidence types are **not** collapsed into one claim of independent third-party certification. The same ChatGPT builder cannot provide an independent external audit of its own work.

## 3. Explicit non-inheritance and held gates

1. **R2-C2 first-portfolio RPC remains BLOCKED for promotion.** Its `SECURITY DEFINER`, JWT claim binding, data-access paths, Clerk A/B and HTTP/RPC negative cases require their own review and real integration rehearsal. Supabase Preview advisor warning `authenticated_security_definer_function_executable` remains a tracked review item. R0 closure does not waive it.
2. **The read-only Clerk A/B harness PR #25 is an R2-C2 add-on**, and its most recent actual run returned `INCONCLUSIVE_MISSING_OWN_ACCOUNTS_OR_PORTFOLIOS`. Do not relabel that R2-specific test as PASS or reinterpret it as failure of the merged R0-A baseline.
3. **Production Clerk JWT integration and API exposure** are separately gated whenever an Investing route is enabled in Production. Supabase RLS catalogue inspection is not a substitute for an effective signed-JWT and negative HTTP check of an activated endpoint.
4. **R2 import, onboarding, first portfolio, and legacy compatibility** remain Draft candidates under PRs #20–#23 and #26; no auto-merge. The R2 schema has 12 registered Preview migrations vs 2 Production, and the two environments must not be silently reconciled.
5. **Trading and Investing authority**, worker identities, brokers and execution mandates are NOT covered or authorized by this R0 foundation closure; each new context has its own fail-closed gate.
6. A separate independent reviewer has **not** been established for this documentation update. This record is evidence reconciliation and owner-scoped technical acceptance, **not independent third-party certification** or unconditional product security sign-off.

## 4. Verdict and sequence

**R0 foundation on accepted `main`: TECHNICAL ACCEPTANCE — CLOSED IN PROVED SCOPE.** Do not restart A/C rehearsals that were completed, independently database-checked and cleaned up in 2026-10-20, absent a changed risk or new defect.

**R0 Production/product-wide release:** NOT asserted. New API/RPC/worker paths are accepted independently at their own slice gate. Technical closure does not change Production configuration or privileges.

**Next phase of ordered work:** **R1 — financial foundation evidence consolidation and rehearsal gate**; reuse prior PG17 and first Production read-only migration/reconciliation evidence before scheduling any **specific unproved** test. Do not advance to R2 until the R1 scope has an explicit documented gate.

## 5. Change control

- No migration/DDL/DML, no financial movement, no R0 endpoint creation, no writer rearming, no Vercel env change, no merge or Production deployment by drafting this record.
- This record does not rewrite the historical 2026-10-23 Roadmap V1 snapshot; the status change is explicitly a later **scoped acceptance decision**.
- Canonical documentation publication requires approved **exact SHA** on PR #24 and explicitly authorized Git merge; the accepted financial/code `main` remains authoritative until then.
