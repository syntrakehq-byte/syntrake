# SYNTRAKE Market Data Core — consumer-neutral on-demand release

The Market Core is an independent service, not an Investing or Trading module.
Neither Investing nor Trading is modified by this release. Future consumer
services send market-data demands through the same authenticated interface.

The browser's market endpoints accept **any verified Clerk user and session**.
No founder ID is hard-coded, and no `SYNTRAKE_MARKET_OWNER_USER_ID` is used.
The internal service endpoint authenticates through a separate server-only
capability token, without depending on browser sessions.

**Short-lived shared cache:** Vercel Runtime Cache may be enabled through
`SYNTRAKE_MARKET_SHARED_CACHE=enabled`. It reuses validated daily prices and
history among function instances in a single Vercel region for at most
**30 seconds**. No SQL table, scheduled job or additional paid subscription
is required. The cache is explicitly gated, includes provider/instrument,
time range, policy, and exact deployment SHA in its key, rejects stale
entries and falls back to the provider on cache failure. The region-specific
Runtime Cache consumes the existing Vercel plan's usage allowance/credits;
the system does not promise unmetered use. Database persistence stays disabled.

Market provider lookups are dynamic; daily OHLCV, daily closes, and FX use
the same Market Core. Each request has provider data validation, no Ledger
writes, no fake prices, and short-lived read-through caching.

Current private development configuration (server-side Vercel environment):
- SYNTRAKE_MARKET_MODE=on-demand
- SYNTRAKE_MARKET_VISIBILITY=authenticated
- SYNTRAKE_MARKET_PERSISTENCE=disabled
- SYNTRAKE_MARKET_APPROVED_SHA=<exact deployed SHA>
- SYNTRAKE_TWELVE_DATA_API_KEY=<existing server-only credential>
- SYNTRAKE_MARKET_INTERNAL_MODE=enabled
- SYNTRAKE_MARKET_INTERNAL_TOKEN=<separate private service capability>

This configuration is **multi-account capable**, not a single-owner gate.
It does not implement payment/subscription-based entitlement or a per-account
credit quota. Those policies need separate implementation before offering
third-party access using a commercial data license; ordinary authentication
alone is not a subscription check. The separate PostgreSQL market-data warehouse and corporate-action pipelines
remain out of scope for the on-demand daily-price release; no SQL migration
is required. Shared 30-second reuse is not a multi-year historical database.

Deployment: validate TypeScript, lint, build, provider and FX tests,
authentication tests, and preview HTTP smoke tests. Production must be pinned
to the exact merged SHA. Never disclose the provider or service credentials.
