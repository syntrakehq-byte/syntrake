# Syntrake Investing Product Vision Capability Audit

Date: 2026-08-08
Scope: verify whether the current Syntrake Investing codebase can support the intended non-automatic investing platform vision.

## Product Vision Being Verified

Syntrake Investing should behave like a normal investing platform with guided decisions, not an autonomous trading bot:

- First user action: define the investing plan.
- Then: load existing holdings or ask Syntrake to prepare a portfolio from the plan.
- Today: show exactly what the user should do, how to do it, and why.
- Portfolio: show real holdings, per-holding state, fresh market valuation, and profit/loss.
- Plan: show whether the portfolio is aligned with the selected plan.
- Research: show user-facing opportunities that can improve the plan/portfolio after internal research validation.
- Broker: keep demo/live broker connection isolated in Broker only; execution remains user-controlled/manual.
- Ops Research Lab: raw research cockpit is owner-only.
- Add a guided/tutorial experience explaining the workflow.

## Executive Verdict

Syntrake can support this vision technically, but it is not complete end to end yet.

The core engine is stronger than the current product experience. The code already has plan persistence, portfolio construction, rebalance calculations, market quote ingestion, immutable market snapshots, daily-cycle receipts, manual tracking accounts, internal demo/paper execution, owner-only Ops Research Lab access, and live execution blocking.

The missing work is now mostly integration completeness and deeper reporting: real external demo broker integration, promotion of validated Ops Lab research into the customer Research feed, monthly/quarterly performance attribution from persisted snapshots, and richer guided walkthroughs beyond the first Mission Brief.

## Capability Matrix

| Capability | Current Status | Evidence | Gap |
| --- | --- | --- | --- |
| First-run plan workflow | Partial/Yes | `app/api/investing/plan/route.ts` persists `goalType`, `riskProfile`, `horizon`, `targetValue`, `monthlyContribution`; `PlanPage` can save changes or create a version; the Investing surface now gates users through Plan -> Portfolio -> Today. | Needs a fuller multi-step wizard, but the hard product order is now enforced. |
| Change/create plan | Yes | `save_plan` updates active settings and active plan; `create_plan_version` archives active plan and inserts a new active plan. Tests exist in `tests/investingPlanRoute.test.ts`. | UX can still improve with richer confirmation and comparison between plan versions. |
| Portfolio alignment to plan | Partial | `InvestingDashboardSurface.tsx` derives current vs target allocation, drift and alignment state; `buildRebalancePlan` produces buy/sell/hold actions. | Needs stronger user-facing explanation in Plan and Today, including exact monthly contribution logic. |
| Manual holdings import | Yes | Tracking accounts route opens `simulation` accounts; movement route imports `opening_position`; migrations store append-only opening-position evidence. | UI supports basic symbol/quantity/cost/date, but no CSV/broker import and no edit/reconciliation workflow. |
| Syntrake-generated starter portfolio | Partial | `buildTargetPortfolio` and runtime `starterPackItems` produce target allocations and estimated quantities from price hints. | No explicit user flow: "Do you want Syntrake to prepare a portfolio based on your plan?" Needs approval/review before becoming portfolio intent. |
| Today exact instruction | Partial | Today now has `What To Do Today`, `Do this`, `How to do it`, `Why`, and evidence. | Still not enough: must show exact amount to invest this month, exact buy/sell/no-action logic, and stale/missing data blockers. |
| Daily market snapshot | Partial/Yes | Dashboard and daily cycle build canonical market snapshots; daily cycle persists via `investing_record_market_snapshot_v1`; tests exist in `tests/investingMarketSnapshots.test.ts`. | Read-time dashboard snapshots are not always persisted until the daily cycle is closed. Reporting pipeline is incomplete. |
| Fresh market data via Twelve Data | Partial | `lib/market/quotes.ts` calls `getQuote(symbol, "twelvedata")`; provider and tests exist. Investing dashboard/daily cycle call `getQuotes`. | Needs production env verification, freshness display per holding, fallback warning, and paid-key health surfaced to Ops/Product. |
| Per-holding detail | Partial/Yes | Portfolio rows are clickable and show holding detail with market value, cost basis, unrealized P/L, weight, price source, price time, and fallback warnings. Backend now derives P/L and price provenance. | Still needs richer fundamentals/news/research notes per holding. |
| Research tab for user opportunities | Partial | Investing research scorecards and rationale exist. Ops Lab has promotion/opportunity concepts. | User Research tab is currently scorecards/rationale, not a clean opportunity feed of ETFs/actions proven by lab and fitted to the user's plan. |
| Raw Research Lab owner-only | Yes/Partial | `/ops/lab` uses Clerk auth and owner/local-QA checks before rendering the lab. Ops APIs also check owner/local-QA. | Confirm production owner IDs/env before launch. |
| Broker demo | Not implemented | `/api/investing/broker/connections` now returns `investing_demo_broker_connector_not_configured` until a real broker demo/paper connector exists. | Need one external demo broker connector such as Alpaca paper, with explicit user authorization and account sync. |
| Broker live | Not implemented by design | Live route returns `investing_live_broker_connector_not_configured`; live execution adapters throw blocked errors. | Need regulated broker connector, OAuth/auth flow, account sync, orders, fills, reconciliation, and legal controls. |
| No automatic execution | Yes | Execution plan requires manual approval/review paths; live execution is blocked; paper submit is explicit user action. | UI must consistently call this supervised/manual investing, not bot automation. |
| Reports | Partial | Receipts timeline and daily-cycle state exist. Reports page states full time series is incomplete. | Need monthly/quarterly report generation from saved snapshots and attribution. |
| Tutorial/game-like explanation | Partial | The Investing surface now has Mission Brief v1 with Beginner/Pro modes, hidden/resume state, persistence in `user_settings.investing_ui_state`, and `/api/investing/preferences`. | Needs richer walkthrough steps, progress tracking, and contextual inline coaching. |

## What Is Already Strong

1. The financial architecture avoids browser-invented Investing state. Portfolio and daily decisions come from server routes and canonical database paths.
2. Live broker execution is correctly blocked rather than faked.
3. Manual tracking is available, so the platform does not need a broker connection just to be useful.
4. The plan/rebalance/research runtime already produces target allocation, drift, scorecards, governance status, and execution state.
5. Market snapshots can be sealed and persisted, which is the correct base for later monthly/quarterly reporting.
6. Ops Research Lab is separated from the customer app and protected as owner/internal tooling.

## Hard Gaps To Close Before The Vision Is Real

1. Build a fuller first-run Investing wizard:
   Plan -> choose existing holdings or prepared portfolio -> Today, with a dedicated multi-step onboarding surface.
2. Add the "prepare my portfolio" flow:
   use the engine starter pack, market quotes, risk settings and cash/monthly contribution, then show a human review screen.
3. Upgrade Today:
   show exact action, exact amount, exact symbols, no-action state, data freshness, and beginner/pro explanation.
4. Upgrade Portfolio:
   clickable holding detail with quantity, cost basis, market value, unrealized P/L, price source, timestamp, missing-data warnings and related research notes.
5. Upgrade Plan:
   make alignment with the selected plan the central view, including drift by asset class and symbol.
6. Wire Research Lab output into user Research:
   customer-safe ETF/opportunity recommendations only after internal lab validation and mandate fit checks.
7. Replace internal demo with a real broker demo connector if that is the requirement:
   current demo is internal paper, not external broker paper.
8. Add monthly/quarterly reports:
   consume persisted daily market snapshots, receipts and attribution.
9. Expand the Investing tutorial:
   guided progress states, richer locked steps, and contextual plain-language explanations.

## Recommended Build Order

1. Product flow gate:
   enforce first-time route into Plan, then Portfolio, then Today.
2. Today v2:
   exact instructions, amount sizing, no-action handling, stale data blockers.
3. Portfolio v2:
   holding detail drawer and P/L from cost basis vs fresh/current market value.
4. Prepared portfolio v1:
   reviewable starter portfolio from plan, quotes and monthly contribution.
5. Research user opportunities:
   promote only validated lab candidates into customer-safe recommendations.
6. Broker connector:
   implement one real external demo broker first, then live only after compliance/reconciliation controls.
7. Reporting:
   monthly/quarterly reports from immutable snapshots.

## Final Answer

Yes, the codebase has the engine foundation to build the Syntrake vision.

No, the current product is not fully there yet. It is currently a partially working supervised investing platform with strong internal architecture, not yet the complete beginner-to-pro guided platform described above.

## Implementation Progress After Audit

Completed in the current recovery pass:

- Added a guided Investing mission in the app shell: Plan -> Portfolio -> Today.
- Moved demo/live broker actions out of Portfolio and kept broker setup/execution in Broker.
- Added a Portfolio prepared-portfolio review path based on target allocations from the saved plan.
- Improved Today instructions with monthly contribution and primary buy/sell review amount when the engine provides an action.
- Added position-level holding detail in Portfolio with market value, cost basis, unrealized P/L, weight, price source, price time, and fallback warning.
- Extended the dashboard payload with holding P/L and price provenance fields.
- Added customer-safe Research opportunities from the Investing runtime, with target value, target weight, fit score, price provenance, warnings, and explicit `labValidation: not_connected` until the Ops Research Lab promotion bridge exists.
- Added Reports v1 with month-to-date and quarter-to-date receipt counts, current total/cash/holdings value, monthly contribution, unrealized P/L, valuation source, data quality, and explicit limitations.
- Added a first-run hard gate in the Investing surface: users are redirected to Plan first, then Portfolio if no holdings/portfolio evidence exists, then the rest of the workflow unlocks.
- Added Mission Brief v1 with Beginner/Pro modes that explains the current step, why it matters, done-when criteria, and the next action across Plan, Portfolio, Today, Research, Reports and Broker.
- Added persisted Mission Brief preferences with `/api/investing/preferences` and `user_settings.investing_ui_state`, including hidden/resume state and Beginner/Pro mode.
- Restricted broker status badges to Broker/Settings so Today, Portfolio, Plan and Research stay focused on the investing workflow instead of account connection state.
- Removed the internal paper path from the customer Broker flow. Demo broker now means a real broker demo/paper connector and is `connector_required` until implemented.

Still open:

- Real external demo broker connector.
- Promotion bridge from Ops Research Lab into user-facing Research opportunities.
- Full historical performance attribution from persisted daily snapshots, including time-weighted return, dividends, realized fees/tax, and benchmark attribution.
- Richer guided walkthroughs with step-level completion history and contextual coaching.
