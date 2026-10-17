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

## Read-only Clerk → Supabase transport candidate

- The server-only entry **loadOwnInvestingAccountsFromClerk** obtains `userId`, `sessionId`, and `getToken()` exclusively from Clerk's server-side `auth()` context. It has **no public route** in R0-A.
- **readOwnInvestingAccounts** uses an auditable, narrowly scoped PostgREST GET for investment account summaries, setting `Accept-Profile: investing`, a **publishable** key and the session's bearer token. No dynamic user/account filter, privileged fallback, client-supplied JWT, cash balance, or trading authority.
- Production callers MUST never construct the lower-level transport's session argument from client data. A valid-looking JWT is not verified by regex: verification is done by the Supabase gateway. The simulated transport tests CANNOT establish real Clerk/Supabase JWT signature validation.
- Unit tests cover missing session/token, wrong hosts, secret keys, synthetic gateway 401/403, network errors, malformed responses and two isolated **synthetic** sessions. PostgreSQL 17 tests additionally exercise mocked RLS A/B, unauthorized anon, missing `sub` and read-only access.
- The live tenant-isolation gate remains **BLOCKED** until the candidate migration is approved and deployed in a controlled manner, the `investing` schema is explicitly enabled in the Supabase REST API, and real signed Clerk tokens from two test identities are used for read-only, negative, and cross-tenant evidence. Neither provider activation alone nor an isolated DB fixture proves the live gate.
