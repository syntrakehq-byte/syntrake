# R2-A — Portfolio import draft contract (candidate)

Status: Git-only executable candidate; NOT approved for merge, production execution, DB migration or financial writes.
Accepted predecessor: main at 29f1c068769e34a84e87717ac8cc9286dd937938.
Recovered source: original unmerged Draft PR #20 at ed8c30a3a25d03fbba1f27009f21c4772034b549; this new standalone candidate supersedes its stale base but does not rewrite or merge PR #20.

## Purpose and boundary

An Investing user may already own a portfolio. Before persistence, balances, valuations or decisions, R2-A accepts a strict, versioned, **user-declared** snapshot containing cash by currency, instrument positions with precise quantities and explicitly known or unknown cost basis, and **planned** contributions. It produces an immutable deterministic **unverified draft** only.

- Source is always USER_REPORTED or DOCUMENT_IMPORTED_UNVERIFIED, never broker-confirmed.
- No user, tenant, investment-account, broker account, ownership, session or execution authority is accepted in the imported payload. Future HTTP requests must bind these server-side.
- Instrument identity is ISIN with valid check digit + MIC + quote currency. Ticker alone is forbidden. Corporate actions, actual custodial ownership, broker reconciliation and point-in-time accuracy are **not** claimed.
- Monetary values are **decimal strings of integer minor units** with existing explicit ISO-4217 support, converted to bigint. Quantities are exact decimal strings, max 12 fractional digits, converted to 10^12 atoms using bigint; no JavaScript floating-point financial arithmetic.
- A missing cost basis is null, not zero. Import time represents a user claim, not data-provider provenance. Foreign-currency cash must not be summed into the base currency without verified FX evidence.
- Planned contributions are separate from cash and **never** count as realized contributions, returns, or account performance.
- Duplicate cash currencies / ISIN+MIC+quote currencies, extra authority fields, unknown currencies, malformed dates or quantities and invalid identifiers fail closed.
- Preview output reports valuation/performance/verified cash as UNAVAILABLE. It never books a ledger movement, creates a position, invents market data, grants access or changes a Production feature flag.
- The import reference is just an unverified source reference; it is NOT a persisted idempotency reservation or authorization token.

## Executable acceptance gate

Pure deterministic parser/projection with tests for precision >2^53, stable ordering, multi-currency, unknown cost basis, planned-vs-realized, duplicate and forged fields, ISIN checksum and malformed data. `npm run test:investing` and dedicated strict `tsc -p tsconfig.investing.json --noEmit`, followed by independent Git diff and CI review.

## Next after R2-A (separately gated)

R2-B: persistence/financial truth design using actual existing Investing ledger, instrument master and custody/account ownership, importer idempotency, corrections and RLS. Migration in Git -> isolated PG17 rehearsal -> security audit -> separately authorized Production. R2-C: point-in-time positions, performance/risk and decision engines with real market/FX provenance.

No product claim that an unverified import is a real financed brokerage portfolio.
