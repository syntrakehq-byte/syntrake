# SYNTRAKE — R1 Investing financial foundation: scoped technical closure

**Decision date:** 2026-10-24 (Europe/Paris)  
**Decision:** **R1 INVESTING TECHNICAL FOUNDATION — ACCEPTED / CLOSED IN PROVED SCOPE.**  
**Authority:** project owner requested formal R1 Investing technical closure and progression, sequentially, to R2; explicitly **excluded Stripe from further work**. This is not approval for financial writes, production migration, official-domain promotion, commercial changes, subscription operations or R2 merge.  
**Repository:** `syntrakehq-byte/syntrake`  
**Accepted functional source:** `main@29f1c068769e34a84e87717ac8cc9286dd937938` (merged PR #27); original R1 release foundation is merged through PRs #10–#17, with PR #17 merge SHA `d42ecf58ca46c0e33d866cced2cdf14aa36eced0`.  
**Documentation publication:** this file is a candidate in existing **docs PR #24** until separately reviewed and explicitly merged. No accepted main documentation state is inferred from an unmerged PR.

## 1. What R1 does, and does not, mean

R1 provides the **financial infrastructure baseline**: account/portfolio/ledger relational foundation, double-entry and idempotency invariants proven in PostgreSQL 17 and controlled synthetic Preview rehearsal, Clerk actor-to-own-account read path with PostgreSQL RLS, fail-closed least-privilege authorizations, Production read-only migration and the user-facing **read-only account discovery** route.

R1 **does not** supply a live longitudinal portfolio, holdings, broker-confirmed balances, imported transactions, market value, financial performance, automated investment recommendations, or actual broker operations. Those belong to later, separately gated Investing slices. `NO DATA` is not `€0`.

**Technical close is distinct from official web release:** R1's exact merged SHA has been exercised at `r1.syntrake.com`, **not promoted** to `www.syntrake.com`. This technical closure does not claim the newest UI is published on the official domain.

## 2. Evidence reused and independently checked; no repeat rehearsals

| Boundary | Evidence | Result / limitation |
|---|---|---|
| Financial ledger and RLS baseline | Prior R0-A/R1 Preview A/C real operator HTTP rehearsal on 2026-10-20, backed by PostgreSQL queries and isolated PG17 tests; merged R0 foundation PR #9 | Own authorized writes 200, cross-actor A→C and C→A rejected 403, 2 **synthetic USER_REPORTED** journal transactions, 4 balanced entries, 2 idempotency records and 0 integrity findings; no broker-confirmed funds |
| Deterministic financial proofs | PostgreSQL 17 isolation, atomicity, single-write/replay/concurrent same-key and ledger invariants; GitHub workflows for exact PR #27 candidate `eae8c4b26137889d88561bd70ad45769e94eb0a2` | 3/3 workflows successful including real disposable PostgreSQL 17 checks; CI is not a substitute for browser/operational rehearsals |
| Production foundation applied | Supabase Production `vbazzxqyuqcrmjytaboc` read-only migration list checked 2026-10-24 | Exactly two registered versions: `20261017191056 remote_schema`, `20261020180000 investing_first_readonly_release`. No R2 candidate migrations approved for Production |
| Actual Production financial state | Read-only Production SQL checked 2026-10-24 | `investment_accounts=0`, `portfolios=0`, `ledger_transactions=0`, `ledger_integrity_issues=0`. No records is **not** a statement about external cash, holdings or market value |
| R1 functional UI and auth | Owner-observed browser on supported origin `https://r1.syntrake.com/investing/accounts`; reviewed merged `AccountDiscoveryClient` and account-response validator | Clerk-authenticated page and **`EMPTY_OR_UNPROVISIONED`** state; source requires a signed-in Clerk actor and valid `200` response with `source=SUPABASE_RLS_READ`, `financialState=NOT_INCLUDED`, empty account list. This is operator screenshot + direct code trace, not a separately captured HTTP packet |
| R1 unauthenticated API deny | Owner-observed independent Windows PowerShell no-cookie/no-query GET rehearsal on 2026-10-24; see PR #27 evidence comment | `/api/investing/accounts` returned `401 UNAUTHENTICATED` on both staging and the previously published official domain. This is actual operator HTTP evidence, not a Vercel bypass-url result |
| Exact staged code | Live Vercel read 2026-10-24 | `r1.syntrake.com` → immutable READY deployment `dpl_FkMG3sVQyAspj7bSpeVsrj5zG8xD`, merged SHA `29f1c068769e34a84e87717ac8cc9286dd937938`. Start CTA, pricing endpoint, signed-out redirect and guarded account display proven in stage |
| Official-domain non-promotion | Live Vercel read 2026-10-24 | `www.syntrake.com` → READY `dpl_2Lh5ZP2iEViPtb3ikjdoVFTTpbV3`, earlier SHA `d42ecf58ca46c0e33d866cced2cdf14aa36eced0`. Official site has not been switched to the new R1 code |
| Release lineage | GitHub PR #27 verified merged, and `main` rechecked on 2026-10-24 | `main=29f1c068769e34a84e87717ac8cc9286dd937938`, no unexpected movement |

**Evidence provenance:** provider catalog and actual code/commit read; historical PG17/Preview evidence; operator browser and HTTP screenshots; signed-out HTTPS flow. Claims are scoped by their evidence. No third-party external security certification is claimed.

## 3. Explicit exclusions — not technical R1 blockers

The **commercial Stripe system and webhook** are separate from the Investing financial-foundation technical closure. The owner explicitly directed the project to **stop Stripe work**. Its webhook delivery, billing entitlement semantics, deployment/credential history and commercial Production rollout remain **UNVERIFIED / SEPARATE HOLD**, and must **not** be silently described as safe or completed. No action on Stripe is authorized by this document.

The latest R1 UI is not on `www.syntrake.com` as of the last provider check. Official-domain production promotion is a **distinct release gate** and has not been authorized by this scoped technical closure. Existing Production R1 read-only infrastructure remains usable only to the extent independently demonstrated.

This closure does **not** inherit onto R2 privileged RPCs or future routes. All new R2 data writes, imports, provisions, auth/tenant rules and migrations require their own candidate→rehearsal→audit→SHA→gate.

## 4. Gate result and next sequential phase

| Gate | Decision |
|---|---|
| R0 Investing security baseline | ACCEPTED in previously documented foundation scope |
| **R1 financial technical foundation** | **ACCEPTED / CLOSED in proved scope** |
| R1 UI on staged supported-origin domain | PASS for signed-in empty-read and signed-out 401 rehearsal |
| R1 official-domain product promotion | NOT PERFORMED; separate release gate |
| Stripe/webhook/commercial release | OUT OF SCOPE and unresolved, on owner's instruction |
| **NEXT phase: R2 living Investing portfolio** | **ACTIVE FOR AUDIT AND IMPLEMENTATION PLANNING**, not accepted or released |

**R2 starting line (current accepted predecessor):** `main@29f1c068769e34a84e87717ac8cc9286dd937938`. Do not infer that Draft PRs #20–#26 can be merged without a fresh lineage/diff/dependency audit against this base.

Current Draft dependencies as-of 2026-10-24:
- PR #20 R2-A pure import normalization; Draft candidate `ed8c30a3a25d03fbba1f27009f21c4772034b549`, based on historical `d42ecf58...`.
- PR #21 R2-B1 append-only unverified import snapshots; Draft `d3cc2022b5ee9acd3012888cc85c2627f1ce0a9d`, stacked on #20.
- PR #22 R2-C onboarding; Draft `2f6467065a854ff90c08783a347b01eb0b81672a`, stacked on #21.
- PR #23 R2-C2 first portfolio RPC; Draft `26170947e4a126ef898de857f6ee2e13ae657f22`, stacked on #22.
- PR #25 R2-C2 A/B RLS harness; Draft `26bb08fdbe1e45255f01d3ce3e6719a5c874b997`, branch off #23; prior rehearsal `INCONCLUSIVE_MISSING_OWN_ACCOUNTS_OR_PORTFOLIOS`.
- PR #26 legacy owned-account reconciliation; Draft `9ad8706c5d25fe2fdad903db6e3f12f3f6e6c701`, separate branch off #23.

**R2 blockers:** Proof of server-derived identity/tenant ownership and RLS on new routes; `SECURITY DEFINER` RPC privileges, real A/B and idempotency; preservation of unverified vs reconciled financial truth; exact Preview-vs-Production migration chain (12 registered Preview migrations vs 2 Production); correct Preview gating across candidate branches. No automatic Production promotion or migrations.

## 5. Change-control invariants

This documentation record changes no source code, ledger, financial state, migration, grant, config, credentials, webhook, broker or Vercel deployment. Document updates in PR #24 require independent diff review and explicit exact-SHA merge authorization before canonical publication. Historical R0/R1 evidence remains unchanged.

**Decision summary:** Close **R1 Investing technical foundation** now without duplicating its rehearsals; proceed sequentially to **R2 candidate audit**. Keep Stripe and official-domain promotion outside this phase until explicitly reauthorized.
