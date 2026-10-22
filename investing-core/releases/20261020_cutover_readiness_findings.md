# Investing R1 first release — production cutover audit / implementation gates

**Accepted predecessor**: `main@d3a95935b6c0d9c6ff25af789a234cbee1b48224`.
**Status**: **NONPRODUCTION CANDIDATE / NOT AUTHORIZED TO CUT OVER**. No production SQL changes or deployment is implied.

## 1. State observed directly on 2026-10-20

| System | Verified evidence | Status |
| --- | --- | --- |
| GitHub | Accepted `main` identical to stated predecessor | REAL |
| Supabase Production | `vbazzxqyuqcrmjytaboc`, PG17.11, 0 Investing schema/tables, 0 financial-writer role, `public` has 0 tables | REAL, NOT PROVISIONED |
| Migration history | `supabase_migrations.schema_migrations` contains **one** version `20261017191056`, name `remote_schema`, with columns `version text`, `statements text[]`, `name text` | REAL |
| Release SQL | Candidate `supabase/release-candidates/20261020180000_investing_first_readonly_release.sql` in Git, not `supabase/migrations`; source copies and least-privilege account SELECT restrictions | CODE CANDIDATE / NOT APPLIED |
| Vercel | New project's Production latest READY is old source `8e0525a4a9916bffdb5f326b433f50ccfc5537f3`; domains include `www.syntrake.com`; accepted main auto-deploy remains disabled | REAL, NOT UPDATED |
| Vercel Investing Production ENV | Production-scoped `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `INVESTING_R1_SUPABASE_PROJECT_REF`, `INVESTING_R1_PRODUCTION_READ_MODE`, `INVESTING_R1_PRODUCTION_APPROVED_SHA` are **absent** in the current project env inventory | VERIFIED MISSING |
| Production Clerk environment | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` entries exist for Vercel Production; no secret values disclosed | EXISTS ONLY; COHERENCE/ISSUER/JWT **UNVERIFIED** |
| Supabase Third-Party Clerk JWT integration | No connected read action exposing production Third-Party Auth provider verification or signing/JWKS config; successful earlier *Preview* A/C JWT cannot validate Production | UNAVAILABLE / BLOCKED |
| Supabase `investing` Data API exposure | `pg_settings` does not expose a usable `pgrst.db_schemas` record in queried Production PostgreSQL settings; dashboard Data API `Exposed schemas` remains unverified | UNAVAILABLE / BLOCKED |
| Stripe Live (separate payment integration) | Connected Stripe Live account `Syntrake`, webhook enabled, event set includes checkout/subscription/invoice events; webhook URL is `https://signalcore.vercel.app/api/stripe/webhook` — **NOT** `www.syntrake.com` | REAL EXTERNAL DEPENDENCY / CUTOVER RISK |
| Stripe Live prices | Two enabled recurring EUR monthly price objects exist | REAL, but checkout price-ID env linkage NOT VERIFIED |

## 2. Commercial regression comparison (deployed SHA vs accepted main)

Direct GitHub blob-level comparison of **old deployed** `8e0525a4a9916bffdb5f326b433f50ccfc5537f3` to **accepted** `d3a95935b6c0d9c6ff25af789a234cbee1b48224`:

- **Unchanged**: `app/api/stripe/webhook/route.ts`, `app/api/stripe/checkout/route.ts`, `proxy.ts`, `app/sign-in/[[...sign-in]]/page.tsx`, `lib/server/stripePriceCatalog.ts`, `next.config.ts`.
- **Changed**: `package.json` and dependency lockfile, `vercel.json` (safely disables `main` Git auto-deploy), plus isolated Investing Core files. Latest GitHub lint/typecheck/site production build pass but **no real Stripe webhook delivery, Checkout session or subscription payment was executed** and no live production Clerk login/JWT integration was independently proven.
- **Important:** the enabled **Stripe Live webhook still targets the old `signalcore.vercel.app` endpoint**. Before changing production aliases/projects, prove that old endpoint is still functioning or prepare a separately authorized exact-event/secret/safe-idempotency migration. Never automatically redirect/change Live Stripe webhooks on a code merge.

## 2A. Independent provider configuration reconciliation (subsequent read-only audit)

- Vercel Production credentials **exist and have Live prefixes**: `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` are both `*_live_*`; `STRIPE_WEBHOOK_SECRET` has expected `whsec_*` syntax. Vercel Production `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` also have Live prefixes. **No secret values were included in the audit evidence.** String-prefix validation does not prove functional connectivity, account matching, webhook delivery, tenant isolation or JWKS trust.
- Connected Stripe **Live** account lists exactly two currently active monthly EUR price objects. Vercel Production `STRIPE_PRICE_ID_EARLY` and `STRIPE_PRICE_ID_STANDARD` both **match those active Live objects**. The legacy generic `STRIPE_PRICE_ID` does not match an active listed price, but direct source inspection of `app/api/stripe/checkout/route.ts` and `lib/server/stripePriceCatalog.ts` shows Checkout selects `*_EARLY` or `*_STANDARD`, **not the unused generic field**. Annual prices are not confirmed configured; annual checkout must fail closed when missing. This is a static+control-plane compatibility check, not a real charge.
- Stripe Live event inventory currently returns two `checkout.session.expired` events and zero pending_webhooks on those **specific** events; these events do **not** prove the enabled webhook processes subscription events, because `checkout.session.expired` is not in its subscribed event set. No non-destructive control-plane query can establish historical delivery/HTTP acknowledgements for the older `signalcore.vercel.app` host. Keep commercial release **BLOCKED** for verified webhook deliveries.
- Supabase **Production** `vbazzxqyuqcrmjytaboc` has an active modern `sb_publishable_*` key and a legacy anon key, as does Preview. Production Investing Vercel env values still have **not** been provisioned. No production Supabase third-party Clerk provider/JWT issuer verification is available through the current read-only connector tools. Follow the official Clerk third-party integration instructions and separately verify `role=authenticated`, trusted asymmetric signing/JWKS and the Data API's custom `investing` exposed schema; do not grant ALL privileges from generic tutorials. R1 production SQL grants are deliberately narrower.
- The current Vercel project `syntrake` **does** own verified domain `www.syntrake.com`, and its latest Production READY SHA remains older. The connected Vercel accounts **cannot locate** `signalcore` or `signalcore-site`; this does not prove the Stripe webhook host is offline. Treat old webhook continuity as an explicit independent final gate.

**Proven:** configured Live key *formats*, active Live monthly price selections, Supabase modern publishable key existence, canonical domain association, unchanged Checkout/webhook source. **Not proven:** live payment acceptance, signed webhook acknowledgements, Clerk↔Supabase production JWT trust, Data API configuration or financial customer data.

## 3. Migration registry lineage contract

The actual target remote registry has:
`[{ version: "20261017191056", name: "remote_schema" }]`.

The version `20261020180000` is later than the remote baseline and than the historical Investing source files. However, **`supabase db push` reads every file in `supabase/migrations`**, including historical original Investing migrations that are absent in remote migration history; blindly pushing the whole repo can duplicate objects and/or activate the unapproved `investing_contribution_writer` capability. The existing `supabase/release-candidates/` file alone is *not* discoverable by `supabase db push`.

The separate `releaseHistoryGate.ts` **fails closed** unless remote version/name rows match the exact known one-row baseline and refuses a replayed/reordered/extra registry. The isolated PostgreSQL 17 rehearsal reproduces the current remote registry shape, uses a transaction to execute the exact candidate SQL + append its migration version, verifies original baseline remains unchanged, then proves any subsequent replay is rejected. This is a **PRODUCTION-LIKE SIMULATION**, not actual Supabase CLI migration-history reconciliation.

**Canonical deployment tooling choice still requires an independent review:** decide and rehearse an authorized, forward-only migration deployment mechanism that registers precisely `20261020180000` without executing skipped historical Git migrations; do not edit/repair remote migration history to conceal drift or turn off version enforcement. When an exact tool contract is accepted, freeze the release SQL and tool invocation under a new audited SHA. Never create historical registry records for migrations that were not actually executed.

## 4. Explicit cutover gates and their truth states

1. **GATE M — Migration history + exact SQL:** current local/release candidate PG17 transaction simulation must PASS. Actual Supabase CLI/application mechanism and target history/rehearsal must be approved. Current: **simulated only**.
2. **GATE A — Auth + tenant isolation:** production Clerk third-party JWT signature/issuer/audience/Supabase Data API exposure and `authenticated` grants/RLS must be verified and 2-person isolation validated in a controlled real signed-token test. Current: **UNAVAILABLE / NOT VERIFIED**.
3. **GATE C — Customer-account provisioning:** the release SQL creates 0 verified customer accounts, and does not define an authorized onboarding/import write path. The read-only UI may legitimately show unprovisioned accounts; cannot claim portfolio functionality or broker balances. Current: **NOT IMPLEMENTED**.
4. **GATE S — Site safety:** preserve Stripe Checkout/live webhook delivery, Clerk login, domains, subscriptions, price selection and existing commercial route behavior on a separately staged exact SHA. Old deployed vs new source has unchanged handlers, **not real end-to-end regression PASS**. Current: **PARTIAL**; Live webhook old-host risk remains.
5. **GATE D — Deployment:** stage exact accepted source under Vercel without production alias/domain promotion, with source SHA and configuration proof. Controlled Production rollout or any alias/Stripe target change **requires explicit separate authorization**. Current: **NOT STAGED**.
6. **GATE W — Financial execution:** no service-role-based authorization, ledger writer, brokerage data, deposits or trades in this slice. Current: **BLOCKED by design**.

## 5. Required next approvals — independent

- **A:** apply an exact audited migration to Supabase Production `vbazzxqyuqcrmjytaboc` after history/JWT/RLS gate, no writer. Requires explicit user authorization naming target and release.
- **B:** create a particular Vercel Production staging deployment for an exact SHA. Requires separate authorization. No domain cutover implied.
- **C:** promote staged deployment and enable account-read runtime for the approved SHA, and any separately approved Stripe webhook change. Requires separate cutover authorization after smoke, no automatic approval.

**Decision:** RELEASE CUTOVER `BLOCKED`, even if offline lineage and CI pass. Preserve existing site & data and continue nonproduction contract implementation and validation.


## 6. Live revalidation 2026-10-22 — supersedes stale 2026-10-20 status, not historical evidence

This section is a **later, immutable-scope evidence update**, not a claim that the 2026-10-20 snapshot was wrong at its as-of time. No production deployment/alias changes, account provisioning, financial operations or Stripe changes are authorized by this note.

### Production database + Clerk/Data API current-state proof
- Operator applied production migration `20261020180000_investing_first_readonly_release`, separately verified in the Supabase migrations registry alongside `20261017191056_remote_schema`. PG17 now has 9 `investing` tables, all RLS enabled, with **0 production identities, accounts, memberships, journals or ledger entries**. The old section 3 one-row migration registry is no longer current.
- Clerk Live dashboard (operator screenshots) reports integration with Supabase **Enabled** and exact issuer `https://clerk.auth.syntrake.com`; Supabase Production Third-Party Authentication dashboard (operator screenshot) reports Clerk **Enabled** with the identical domain.
- Supabase Production Data API dashboard: `investing` is one of 3 exposed schemas; automatic new table exposure **OFF**; 0/7 RPC functions exposed. The individual `investment_accounts` table switch **must not be used**: enabling it widened PostgreSQL grants to `anon` SELECT/INSERT/UPDATE/DELETE and `authenticated` write, even with automatic new-table exposure switched off.
- After that accidental grant widening, a targeted corrective transaction restored `investing.investment_accounts` to `authenticated: SELECT` only, `anon: no privileges`, and `service_role: no table privileges`; follow-up connector query confirmed nine-table ACL matrix with RLS and **no browser DML grants**. Dashboard subsequently reported 0/9 individual tables exposed. This is a **platform presentation/grants interaction**, NOT evidence that role-scoped REST SELECT is unavailable.
- Operator ran browser-origin **real Clerk Live session** read-only proof against Production Supabase PostgREST with the publishable key, `Accept-Profile: investing`, and a server-issued session JWT. Reported `role=authenticated`, `iss=https://clerk.auth.syntrake.com`, signed bearer GET `investment_accounts?select=id&limit=1` **HTTP 200** (empty array), and anonymous GET **HTTP 401**. Independent SQL confirms only `authenticated` has SELECT, and the 0 rows in DB are consistent with the response. This is **real signed-token acceptance and negative anonymous refusal**, not a 2-account tenant-isolation test, not a financial zero, and not evidence of the Investing application route working in Production.
- **Do not make the Data API dashboard show 1/9 by re-selecting the table.** The SQL grants+RLS remain the canonical least-privilege controls. Re-audit them if other settings change.

### Exact source, build and commercial integration
- Accepted Git predecessor `main@d42ecf58ca46c0e33d866cced2cdf14aa36eced0`. R1-C Draft PR #19 originally has test-only commit `8ee3927dece4de4976aca52699a10e8b15079d43`; this document update produces a **new PR candidate SHA to be separately checked**.
- Vercel Preview rehearsal **READY** at `f020ef621cb13de0f986b6ce3be4cea52ab6d198`, which is the earlier test candidate plus a **Preview-only vercel.json ignore-build override**. This does **not** prove that a new doc-commit SHA or a real Production build is deployed. GitHub Investing CI for previous R1-C test-only commit passed 3/3 in earlier checks.
- Old deployed Production SHA `8e0525a4a9916bffdb5f326b433f50ccfc5537f3` still serves the real domains. Vercel `main` Git auto-deploy disabled. The 197-commit source delta contained 55 changed paths; independent old/new **blob hash equality** verified for commercial homepage/layout, Clerk middleware proxy, Next.js config, pricing API, and Stripe checkout/webhook/portal/sync handlers. Dependencies / lockfile and `vercel.json` **did** change; code equivalence is not end-to-end regression proof.
- Stripe **Live** connected account `Syntrake` (`acct_1St6xgFtGPEjO86B`) still reports **one enabled webhook** targeting `https://signalcore.vercel.app/api/stripe/webhook`, not the public `www.syntrake.com`; subscribed checkout/subscription/invoice events. This is a **material continuity risk** until webhook destination delivery and signing-secret correspondence are verified. No automatic webhook migration is authorized.
- Stripe Live listed two active monthly EUR recurring prices (1900 and 2900 minor units, from API, **not a portfolio value**), one active product, no subscriptions; two `checkout.session.expired` events with 0 pending delivery and none proving a paid-subscription webhook callback. Vercel Production Stripe secret/price settings are present but encrypted values were not revalidated in this audit; older verification of price matching is historical, not fresh end-to-end proof.
- Vercel **Production** has Clerk Live variables, but no `INVESTING_R1_PRODUCTION_READ_MODE`, `INVESTING_R1_SUPABASE_PROJECT_REF`, Production `NEXT_PUBLIC_SUPABASE_URL`, Production publishable Supabase key or `INVESTING_R1_PRODUCTION_APPROVED_SHA`. This is correct **fail closed**. Deploying new code without flags should keep Investing 404.

### Gate verdict and authorized next actions
- **PASS:** real Clerk Live JWT accepted by Production Supabase, deny anonymous, schema exposed, Postgres least-privilege read-only/RLS restored, Preview compiled, same commercial route code blobs, zero financial writes.
- **NOT PROVEN:** production A/B positive ownership isolation (no accounts), Stripe **successful signed webhook delivery**, production-equivalent runtime smoke with checkout and Clerk login for the exact approved source SHA, any official account-onboarding workflow. Do not fabricate accounts to make tests pass.
- **BLOCKED:** Production candidate deploy, alias promotion, Production Investing enable flags, Stripe webhook target/secret mutation, production account provisioning. Those require separate specific authorizations, and the CI/preview checks must be associated with the final candidate SHA rather than carried over from another SHA.
- **Next safe step:** exact new Git candidate SHA + CI/diff review, then a scoped separately authorized **staged Production build without domain assignment and with Investing disabled**; run non-financial commercial smoke and validate old webhook continuity; approve alias promotion only in a further independent gate.

The read-only Data API/Clerk milestone is now **PASS**; the functional Investing R1 public cutover remains **BLOCKED**.
