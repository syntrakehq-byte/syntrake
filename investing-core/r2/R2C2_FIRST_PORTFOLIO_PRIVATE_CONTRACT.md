# R2-C2 — Private first-portfolio provisioning (candidate, not release)

**Accepted Git predecessor:** `main@29f1c068769e34a84e87717ac8cc9286dd937938`.  
**Unaccepted Draft dependency:** PR #31 R2-C1 `52f117d35107cb992a26f45dcb15c1d8fb6f8390`, itself on Draft R2-B1 and R2-A.  
**Scope:** only first **structural** Investing account/portfolio with six bookkeeping accounts for one verified Clerk actor. No balances, real cash, holdings, ledger transaction, broker confirmation, return or Trading authority.

## Security decision: do not expose historical privileged RPC

Historical Draft PR #23 proposes `SECURITY DEFINER investing.provision_first_portfolio` callable by PostgREST `authenticated`. That contract has important external prerequisites: correct signed Clerk JWT routing, function owner and ACL, PostgREST exposed schemas and PG17 RLS/role security; CI fixture `request.jwt.claims` alone cannot prove gateway signature enforcement. **This candidate does not import #23's 20261023090000/101500/113000 privileged RPC migrations**. It uses a **private, NOLOGIN, NOBYPASSRLS `investing_initial_provisioner` role**, PostgreSQL RLS and server-verified actor in one transaction. No user-supplied actor ID, tenant ID, portfolio ID, amount, broker instruction or authority is accepted.

`SET LOCAL ROLE` is only possible when a separately provisioned, *server-only* runtime role can use `SET ROLE`; that provisioning is **not included**. **Never expose such credentials** to browser, Supabase Data API or publicly callable SQL. The current candidate has no HTTP write route. A future public route requires a separate explicit proof that Clerk verification, runtime connection, rate limiting, CSRF and tenancy are secure in real Preview before it can be enabled.

## Atomic, idempotent initialisation

1. Fail locally on unauthenticated Clerk actor or unknown fields.
2. Start one database transaction, set constrained role and transaction-local actor; lock by verified actor.
3. Prior receipt with same key+hash returns original IDs. Different key or hash fails.
4. If a **legacy/pre-existing** own investment account exists without a receipt, **BLOCK** rather than create a duplicate. Separate owner-safe reconciliation follows.
5. Require at least one user-reported, non-provisioned Investing onboarding intent (not money truth).
6. Validate currency against SQL supported-currencies registry.
7. Insert identity if missing, first account, canonical owner membership, first portfolio, six single-currency bookkeeping accounts and immutable receipt.
8. R0 owner/membership deferred trigger checks invariants at COMMIT. Failure rolls back all rows; receipt is not a bank movement.

## Required evidence before acceptance

- PG17 real database in isolated CI: actor A vs B, missing actor/intent, forged inputs, replay vs changed key, four-way concurrent same request, wrong-tenant readback, legacy existing-account denial, currency and least-privilege roles; zero ledger transactions/entries, no broker.
- Verify `anon/authenticated` cannot insert accounts or obtain execution as NOLOGIN role; role has no INSERT on ledger transactions or entries. `UPDATE` on account narrowed to the owner identity column for R0 `SELECT FOR UPDATE` trigger needs, with RLS same-owner guard.
- Independent review of current PR code and every SQL policy/GRANT, including R0 base compatibility; CI PASS is not independent acceptance.
- No Supabase formal rehearsal until **all of R2** is complete, then specifically **R2_PHASE** and **R0_TO_R2_CUMULATIVE**, paid branch cost approved by owner and isolated from Production. Real Clerk A/B and Preview→Production migration reconciliation must be explicitly proven before R2 final gate.
- No merge, Prod/Preview DDL or DML, Production deploy, financial state or broker actions without separate authorization.
