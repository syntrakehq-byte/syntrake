# SYNTRAKE — Post-auth UX v1 (candidate 2026-10-30)

## Product decisions from owner

- One Clerk account may use **both Investing and Trading**. No forced choice after sign-up.
- Progressive onboarding: after normal first sign-up, show a short welcome, then Accueil. No financial questionnaire and no forced account creation.
- Signed-in returning users go straight to Accueil (`/start`) from existing sign-in and landing behavior. **Existing R2 account data is preserved.**
- Accueil is neutral: areas, verifiable account state, next action and honest no-feed placeholder. **No market headlines, overview, fabricated charts or broker valuations here**.
- Investing, Trading, Research Lab and Market Data are separate destinations; prices, news and market overview belong to Market Data.
- Only R2 functional links have working feature routes; Trading/Research/Market Data clearly say they are in development. No simulated live trading or paper results.
- Responsive dark visual language inspired by accepted conceptual artwork: navy, muted gold accents, coherent sidebar, header with account controls, distinct feature cards.

## Routes and semantics

| Route | Access | Behavior |
|---|---|---|
| `/sign-up` | Clerk | Default completed signup goes to `/welcome`; explicit return/checkout redirects preserved. |
| `/sign-in` | Clerk | Default completed sign-in remains `/start`. |
| `/welcome` | Clerk session required | Single introductory screen, link to Accueil; not a mandatory questionnaire or a persisted onboarding status. |
| `/start` | Clerk session required | Neutral Accueil. Optional **signed Clerk JWT + Supabase owner RLS** structural read; fail-closed unknown, never synthetic balance or zero. |
| `/investing` | Clerk session required | Hub: existing accounts, R2 profile, import, initial setup; links shown only when the **same R2 gates** as the underlying pages are open. |
| `/trading` | Clerk session required | Clearly labelled planned experience, not a trading engine. |
| `/research` | Clerk session required | Clearly labelled planned Research Lab, no fake backtests. |
| `/markets` | Clerk session required | Clearly labelled R3 destination for future prices, histories, FX and **market news**. |

## Security and non-regression

1. No Supabase schema/migration, roles, RLS, financial ledger, API, broker data, Clerk auth provider or stripe payment change.
2. No `service_role`, secret, manual JWT or client-owned account ID was introduced.
3. `readInvestingWorkspaceStatus()` calls accepted R2 owner-only structural read; errors report `unavailable`, never `none`. No financial writes and no financial values in homepage.
4. Existing R0–R2 `/investing/start`, `/investing/existing`, `/investing/profile`, `/investing/import` remain unchanged.
5. No persistence flag for 'first signup' is claimed. Clerk's successful signup default redirects to a welcome page; recurring sign-ins use Accueil. Redirect overrides for trial, checkout and explicit return are kept.
6. Deploy gate: Production currently pins exact historical SHA. This UI PR must **not** blindly redeploy Production or change approved SHA; release deployment and a successful logged-in smoke test require separate approval.
7. Full R2-D signed two-real-Clerk-actor external test remains the separate pre-customer security gate #47.

## Acceptance checklist

- `npm run lint`, `npx tsc --noEmit`, `npm run build` on final PR SHA.
- Investing deterministic tests and PG17 cumulative regressions remain green.
- After an authorized Preview/Production release: new signup sees welcome; returning login sees Accueil; all links are correct; real existing owner sees account-present state; denied/unavailable RLS never falsely displays empty account; sign out returns public landing; mobile navigation and language switching work.
- No extra paid Supabase branch is needed to review this UI.
