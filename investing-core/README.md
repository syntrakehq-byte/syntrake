# SYNTRAKE Investing Core — R0-A candidate (BLOCKED)

This bounded context is independent from Trading, Research Lab and Billing. It is not a functioning investing product or broker integration.

- Clerk is the identity provider. An authorized Supabase integration must verify Clerk third-party JWTs before PostgreSQL RLS reads the subject with auth.jwt(). The real external configuration, server-side financial authorization and operational writer are NOT present.
- Accounting uses exact bigint minor units and an explicit supported subset of ISO 4217 currencies, including JPY (0 minor digits) and KWD (3 minor digits). The SQL currency registry must remain in sync with the domain registry. A three-letter pattern alone does not validate ISO currencies.
- Double-entry journals post between different internal ledger accounts (cash, external clearing, etc.) within ONE investment account. Every currency group must independently balance. The journal must transition from draft to posted before COMMIT and cannot subsequently be altered; corrections require new, compensating journals.
- All domain journals and cash movements in tests are synthetic fixtures, not real-world contributions. Broker ingestion, reconciliation with external cash truth, cost basis, investment positions and FX processing are NOT implemented.
- The SQL migration is candidate-only and has not been applied remotely; revisions before first deployment do NOT authorize rewriting it afterward. PostgreSQL tests execute with privileged fixture setup and simulation of JWT claims at database level, NOT proof of a verified Clerk JWT.
- The idempotency record, scoped unique keys, and concurrency tests are storage prerequisites, not an authorized idempotent financial operation. Authenticated clients are read-only.
- Supabase service_role is not authority to act for a user. Any eventual privileged server writer must verify the Clerk actor and ownership before opening its transaction.

Gates still BLOCKED: genuine Clerk/Supabase integration, transaction-scoped authorized server-side writer, end-to-end financial event provenance and idempotency, broker/financial-truth reconciliation, site regression build, dependency vulnerability review and independent audit.
