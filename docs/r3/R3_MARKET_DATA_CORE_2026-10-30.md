# SYNTRAKE — R3 Market Data Core (start: 2026-10-30)

**State: R3-A domain/adapter candidate, NOT R3 closed.** No production market data, quotes, news, FX conversion, scheduler, database migrations or billing have been enabled by this slice. This is a separate and deliberately gated code path. The R2 ledger and client import truth remain untouched.

## Architecture goal

**CURRENT PRODUCT SCOPE: INVESTING ONLY.** R3 exists to support the Investing experience: reliable instruments, historical prices, FX, source quality, and eventually context from financial news for analysis of portfolios and long-term investments. Market Data and a future News Intelligence module may later be reused by Trading, **but no Trading functionality is authorized or under development in R3**. Market Data has its own navigation: market preview/news never invade Accueil. The UI must say unavailable until sources and licenses are verified; no simulated prices or artificial performance.

**Hard scope boundary:** no trading strategies, signals, edge discovery, autonomous trading decisions, backtests, paper trading, execution or broker integrations. Research Lab is not part of this R3 delivery. Shared-source compatibility is a future architectural possibility, not a feature requirement or present implementation.

## Binding product architecture — Research Lab is optional

**The SYNTRAKE Investing engine must operate autonomously without the Research Lab.** The Research Lab is an **optional, removable product feature**, not the engine, decision orchestrator, data scheduler, mandatory dependency, or source of truth. Removing, disabling or failing the Research Lab must not interrupt SYNTRAKE's core Investing operation.

- **Autonomous core (future implementation):** server-side scheduled ingestion of licensed market/news data, validation, storage, portfolio tracking and valuation, risk/goal monitoring, and evidence-backed updates/alerts when those capabilities exist. This continues with no user session, browser, or Research Lab.
- **Research Lab (optional):** additional user-facing, on-demand exploration and experiments. It consumes validated core data through stable interfaces; the core must never import or require Lab code or services for normal operation.
- **Graceful degradation:** if the Lab is removed or unavailable, Investing and Market Data keep running. If a market/news provider is unavailable, the core records staleness/unavailability and follows safe retry policy rather than fabricating data or depending on Lab.
- **Acceptance requirement for a later integration:** disable/remove Lab routes and service and verify the Investing core's scheduled jobs, account reads, market updates, monitoring and recovery remain functional. Feature flags must not gate the core on Lab availability.
- **Current R3-A limitation:** the above autonomous background system is **an architectural requirement, not an implemented feature**. The PR currently contains only isolated market-data contracts and an offline-tested provider adapter. No automatic trading decisions, execution, autonomous financial operations or Research Lab implementation are authorized.

## Roadmap and acceptance gates

| Slice | Deliverable | Acceptance/evidence |
|---|---|---|
| **R3-A — contracts / provider boundary** | Instrument identity (MIC, asset class, currency, FX direction); daily OHLC schema; Twelve Data fixed HTTPS endpoint adapter; observable provenance, exchange-local daily date, explicit non-adjustment; strict parse and fail-closed Preview-only SHA gate; pure freshness/credit policy | Deterministic, offline negative/positive tests, strict TypeScript, site/investing regressions. **Current PR.** |
| **R3-B — durable market registry** | PG17 private market schema, instrument registry, raw ingest metadata, immutable/revisable daily candles, quality/rejection reason, dedupe by provider, instrument, interval, exchange date, adjustment and version | New versioned migration and isolated PG17 tests incl. duplicate/conflicting candles, RLS and private schema exposure; no writes to R0–R2 ledger. Do not apply migrations remotely without reviewed release authorization. |
| **R3-C — collection / operations** | Scheduled worker with *durable* per-provider credit reservation, backoff after 429, bounded backfill, queue/idempotence and crash recovery | Tests show no fetch without reserved credit, no double-credit on concurrent workers, retry/backoff, strict host/secret handling, cost review before enabling provider calls. |
| **R3-D — authenticated reads for Investing** | Authoritative instrument data and quality/latency labels on Market Data pages, available to Investing workflows; stale/missing observations explicitly unknown | Signed Clerk authorization and isolation; no fake defaults, no leaking provider keys; commercial redistribution rights cleared before client-facing display. No Trading integration. |
| **R3-E — Investing FX/corporate actions** | Explicit as-of FX direction and provenance, split/dividend adjustment policy, gap handling, historical revision tracking for investment analysis | Deterministic checks across currencies/timezones, stale and missing rates; never infer valuations from insufficient data. No trading signals. |
| **R3-F — release** | R0→R3 cumulative rehearsal and exact Production SHA plan | PG17 + fake provider + one separately approved capped provider integration, evidence of timestamps/quality; **no customer launch** until R2 exception #47 signed Clerk A/B is closed. |

## R3-A contract

- **Identity:** Not ticker alone. Equity/ETF require exact 4-character MIC, ticker and currency. FX requires ordered `BASE/QUOTE` and quote currency. No implicit exchange selection or conversion. Explicit deterministic canonical key.
- **Transport:** One-symbol `1day` `/time_series`, `adjust=none`, bounded `outputsize=1..1000`. Fixed host `https://api.twelvedata.com`; no caller URL, redirects, raw provider exceptions or automatic retries. The secret is server-only.
- **Truth:** `PROVIDER_RESPONSE` evidence, **exchange-local market date** distinct from UTC ingestion time. Latency `NOT_VERIFIED` until plan/contract supports a verified claim. These candles do **not** assert a live/usable execution quote, broker verification, price freshness, cash balance or portfolio performance.
- **Precision:** Decimal prices/volumes stay strings; OHLC validation compares exact scaled `bigint` values, not IEEE-754 floating-point money. Reject mismatched MIC/currency/type/interval, duplicate or unordered dates, invalid dates, impossible OHLC, malformed price, empty result and excess rows. Never convert read failure into a fake zero.
- **Errors:** HTTP 429 and 200-encoded vendor errors represented explicitly, optional bounded `Retry-After`. No leaked URL, provider body or API key. Retrying requires a later durable scheduler.
- **Gate:** Requires `VERCEL_ENV=preview`, branch `feat/r3-market-data-core-20261030`, exact `SYNTRAKE_R3_PREVIEW_APPROVED_SHA`, `SYNTRAKE_R3_PROVIDER_ENABLED=enabled` and server `SYNTRAKE_TWELVE_DATA_API_KEY`. **Production is always disabled in R3-A.** CI only injects fake HTTP; the real provider is never contacted. No credentials or new Vercel environment flags are provisioned by this PR.
- **Credits:** `decideRefresh` is pure preflight, **not** a credit allocator. An atomic durable reservation and per-plan quota policy must be developed before scheduling. Do not hardcode a presumed provider plan or burn paid/free credits to show example prices.

## Why no Supabase migration yet?

Before storing vendor prices, the schema must define adjustment, corrected candles, MIC ambiguity, timezone, retention, credits/licensing and read policies. A premature Production migration could contaminate accepted R0–R2 or introduce unexpected provider costs. The adapter can first be proved offline at zero external expense.

## External references checked 2026-10-30

- https://twelvedata.com/docs — `/time_series`, metadata, adjustment, timezone, MIC.
- https://support.twelvedata.com/en/articles/5615854-credits — HTTP 429 and credit quotas by subscription.
- https://supabase.com/changelog?types=breaking-change — new table Data API opt-in behavior, PG17 and TLS changes. Future market registry will be private and not exposed to `anon`/clients by default.

## Non-goals

No paid Twelve Data plan or live key. No schedule, cron, public market endpoint, Supabase schema change, portfolio valuation, market news source, broker positions, trading strategies/signals, backtesting, paper/live execution, or fictitious market data. News monitoring/analysis is an **Investing-supporting future R3 component** requiring its own licensed sources and evidence policy; it is not implemented in R3-A. Language/i18n cleanup deferred until after the Market Data Core, per owner decision.
