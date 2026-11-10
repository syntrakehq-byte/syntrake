# Market Core — isolated personal release candidate

Parent: main, not the 379-commit stacked R3/G3 Draft branch.
Scope: owner-only dynamic discovery, daily close, daily OHLCV history,
directed FX and one private service-to-service HTTP endpoint. No Investing
or Trading code changes; no autonomous workers, financial writes or cron.

The first personal deployment uses short-lived in-process cache only.
No PostgreSQL shared cache, PIT historical registry or corporate-action
ingestion is claimed ready by this release. SQL production remains unchanged.

Required server-side Vercel environment:
- SYNTRAKE_MARKET_MODE=personal
- SYNTRAKE_MARKET_VISIBILITY=owner-only
- SYNTRAKE_MARKET_PERSISTENCE=disabled
- SYNTRAKE_MARKET_OWNER_USER_ID=<existing verified production Clerk owner>
- SYNTRAKE_MARKET_APPROVED_SHA=<exact deployed commit SHA>
- SYNTRAKE_TWELVE_DATA_API_KEY=<existing server-only provider credential>
- SYNTRAKE_MARKET_INTERNAL_MODE=enabled
- SYNTRAKE_MARKET_INTERNAL_TOKEN=<independent secret not sent to clients>

Gate promotion on CI, an isolated Preview deployment, verified owner access,
unauthorized account rejection, service-to-service smoke tests, and
post-production read-only checks. Do not merge the Draft stack.
