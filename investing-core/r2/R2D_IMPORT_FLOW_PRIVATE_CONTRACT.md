# R2-D — Investing import → persist → readback (candidate)

**Date:** 2026-10-24. **Status:** DRAFT, not merged/accepted/deployed.  
**Accepted predecessor:** `main@29f1c068769e34a84e87717ac8cc9286dd937938`; Draft stack PR #28 → #30 → #31 → #32 → #33 → #34 (`2fb37140c447b0d82e22d3adf56385d0797c0df0`) → R2-D.  
**Not a Supabase rehearsal:** formal `R2_PHASE` and `R0_TO_R2_CUMULATIVE` must wait until **all** R2 requirements are finished and the user authorizes cost/creation of isolated Supabase resources.

## End-to-end contract

1. User signs in with Clerk; `/api/investing/existing-account` reads owned accounts/portfolios via Supabase RLS. No client-selected ID proves authority. With no portfolio or multiple accounts and no deterministic choice, the UI blocks import rather than inventing or selecting one.
2. `/investing/import` renders manual inputs for up to 5 explicitly reported cash currencies and 5 ISIN/MIC positions in **this UI slice**. Backend normalizer still permits up to 100 cash / 5000 positions and planned contributions where contract allows. Forex/crypto/document parser remain **not supported**; Instrument Master needed before multiasset import.
3. User explicitly declares `reportedCoverage` per domain; `NOT_REPORTED` never means zero. Source reference and `asOf` are sticky to the idempotency key for a retry; edited requests receive a new key. Inputs use strings for money minor units and decimal quantities, with unknown cost basis `null`, no ungrounded FX.
4. Private POST: Clerk session verified server-side; exact Preview branch/ref + explicit env opt-in + **separate** non-superuser `investing_import_preview_runtime` direct PG account + verified TLS certificate → `savePortfolioImport()` → atomic complete finalized unverified snapshot. R2-B1 writer uses NOLOGIN NOBYPASSRLS `investing_import_writer`, server-scoped verified actor, ownership, locks and idempotency. No public SECURITY DEFINER RPC or broker.
5. Private GET: owner-only `?portfolioId=...` returns up to 20 latest own finalized imports, `hasMore` explicitly indicates truncation; `?portfolioId=...&snapshotId=...` reads actual snapshot including cash, positions and planned contributions, preserving bigint as decimal strings. Unknown financial values remain `UNAVAILABLE`. No market valuation, cost-basis reconstruction, cash posting or verified broker fills. **History remains accessible after page reload**.
6. Any invalid Clerk actor, cross-account ID, unsafe Origin, size, wrong env/role, stale/missing data or provider failure fails closed. User attempts to spoof owner fields are rejected by strict Zod schema; data API `authenticated` has no import table grants.
7. First-account creation from R2-C4 remains separately gated. An imported declaration does not create a cash balance or ledger transaction; PostgreSQL A/B tests assert financial journal count remains unchanged.

## Gate prerequisites for real Preview

- Independently review exact diff, signature of Clerk JWT to Supabase API, RLS, schema exposure, credentials, logs, privilege capabilities and abuse/rate limit. PostgreSQL CI **uses synthetic actors** and does not prove actual signed Clerk A/B.
- Check historical migration registry of Preview/Production and PG17, lock/idempotency/role grants, prevent drift; R2-B1 SQL under `supabase/release-candidates` is **not** applied automatically.
- Provision of separate dedicated Preview login and `SET ROLE investing_import_writer` permission is a separate, **explicitly authorized DB administration task**, with TLS CA chain and no connection string exposed to the browser. Never weaken SSL or use service_role as a substitute.
- R2-C4's first-account Preview login is distinct, does **not** inherit import power, and must not share unrestricted credentials. Both are disabled by default.
- No merge, DDL/DML to remote Supabase, production deployment, resource billing or account financial movement without separate authorization.

## CI evidence required before even considering candidate

R0/R1/R2-A/B/C regression, UI lint/typecheck/build, R2-B1 PG17 transaction/ownership, R2-D private HTTP→PG17 with replay/cross-user denial and round-trip readback; strict import constraints; no ledger transactions, no inferred cash and explicit history truncation. All on exact reviewed candidate SHA.

**Known limitations:** imported snapshots are declarations, not financial state reconciliation, market valuations, performance analysis, broker positions or live trades. Genuine financial transaction/ledger linkage must be modeled separately with event provenance and accounting semantics.
