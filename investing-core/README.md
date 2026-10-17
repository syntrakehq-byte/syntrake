# SYNTRAKE Investing Core — R0-A candidate (BLOCKED)

This bounded context is independent from Trading, Research Lab and Billing. It is not a functioning investing product or broker integration.

- Clerk is the identity provider. An authorized Supabase integration must verify Clerk third-party JWTs before PostgreSQL RLS reads auth.jwt()->>'sub'. The real external Supabase/Clerk integration has NOT been verified. The isolated server actor adapter calls Clerk auth() but is NOT exposed on an HTTP route.
- Accounting uses exact bigint minor units and an explicit supported subset of ISO 4217 currencies, including JPY (0 minor digits) and KWD (3 minor digits). The SQL currency registry must match the domain registry. Three uppercase letters alone do not validate ISO currencies.
- Double-entry journals post between different internal ledger accounts within one investment account. Every currency independently balances. Journal state moves from draft to posted before COMMIT and cannot subsequently be changed. Corrections require compensating journals.
- The server-side recordUserReportedContribution service checks ownership and the owner membership in PostgreSQL, serializes writes using a locked investment-account row, hashes normalized input, rejects idempotency-key conflicts and prevents duplicate external references. Reservation, journal and replay result are committed atomically. The service takes a private server DB pool; it has NO runtime wiring or public HTTP route.
- USER_REPORTED is a NON-VERIFIED financial declaration. Its journal is internal bookkeeping only; it is NOT proof of a deposit, broker-confirmed cash, performance, investable balance or available trading authority. Future investment/execution logic MUST NOT promote this evidence to broker-confirmed truth without independent reconciliation.
- PostgreSQL tests use synthetic fixtures, admin setup, and simulation of JWT claims at database level, NOT genuine signed Clerk JWT verification.
- The migration is candidate-only and has not been applied remotely. Rewriting a migration after applying it to any persistent environment is forbidden.
- Supabase service_role is capability, never user authorization. A future constrained privileged DB writer, real external auth validation and operational auditing must be separately gated.

Outstanding BLOCKED gates: verified Clerk/Supabase deployment, authorized backend database configuration with least privilege and operational safeguards, real ledger reconciliation, broker adapter (Paper before Live), site build regression and vulnerability triage. No service in this slice may move real money.
