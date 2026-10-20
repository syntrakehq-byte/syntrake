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
