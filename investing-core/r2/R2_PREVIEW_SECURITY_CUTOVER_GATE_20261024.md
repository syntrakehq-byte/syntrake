# R2 Preview security cutover — operational gate, NOT a rehearsal

**Observed 2026-10-24.** Read-only Supabase inspection: Preview `zkqgpejlkgootkvkebhd`, PostgreSQL 17.11, historical R2 import records and exposed historical `investing.provision_first_portfolio(uuid,text,text,text)`. Production `vbazzxqyuqcrmjytaboc` remains the R0/R1 database, with no verified R2 promotion.

## Exact real-world risk — not automatically an exploit

The historical Preview function was **actually verified** to be owned by `investing_initial_provisioner`, `SECURITY DEFINER`, `search_path=pg_catalog, investing`, executable by `authenticated` but **not** by `anon` or `PUBLIC`. Its body derives a Clerk-looking actor from PostgreSQL's `request.jwt.claims`, rejects missing role/sub, verifies onboarding and rejects duplicate accounts. The real PostgREST gateway must cryptographically verify tokens; our isolated PG17 tests **cannot** prove that. Supabase Security Advisor reports a `authenticated_security_definer_function_executable` warning. That is a **privileged capability exposure and contract conflict**, not evidence of bypass or data theft.

The function definition fingerprint was read live from PostgreSQL 17 via:
`encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')`
→ `563ca89cf9cde2b75530de84d9ef60655f842e83ad78dc784ca34747651889b7`.

## Candidate response: implementation, no external side effects

**1. Read-only executable Preview import gate.** Before any R2-D/R2-E import HTTP read/write, a server-only connection checks the real PostgreSQL catalog for 2 coverage columns of type TEXT, 4 import tables with `ENABLE/FORCE ROW LEVEL SECURITY`, constrained `NOLOGIN NOBYPASSRLS` writer role with INSERT on import snapshots but no journal posting, no `authenticated` INSERT to import snapshots, and **no** publicly executable legacy provisioner. Any missing, incompatible or unverifiable property yields generic `IMPORT_UNAVAILABLE`, no results presented as current financial truth. The existing account/Clerk ownership check still happens independently inside read/write operations. The preflight is defense in depth and **not** authorization by itself.

**2. Versioned, SHA-locked Preview-only revocation proposal.** `supabase/release-candidates/20261024194500_r2_preview_revoke_legacy_provision_rpc.sql` will, **only after a separate explicitly authorized release gate**, verify the exact historical function hash, owner, search_path, public grant state, authenticated grant, and already-applied coverage migration, then `REVOKE EXECUTE ... FROM authenticated`. It doesn't delete functions, accounts, historical snapshots or ledger records. Any mismatch aborts. This would **disable** the older public Preview onboarding-to-portfolio route; first confirm a replacement route works before authorizing execution. Never include this script in generic Production `db push`.

**3. Isolated PostgreSQL 17 negative tests.** Reproduce exact live historical function source as a test-only fixture, check its SHA, ensure the import preflight blocks while authenticated can execute it, ensure tampered search_path makes revocation fail without changing grants, and ensure a *successful authorized-like CI simulation* revokes the grant and restores read-only readiness. The CI database is synthetic/disposable; it **does not mutate Preview**, does not use signed real Clerk sessions and is **not** the formal Supabase rehearsal.

## External release sequence — permission required at every material gate

1. Independently audit real current Preview migration hashes, historical RPC dependencies, account fixtures, RLS membership and signed JWT gateway. Resolve the two missing `reported_*_coverage` columns via the **separate forward-only** candidate from PR #35, keeping historical NULLs unknown, not zero.
2. Prove a narrowly scoped separate server-only dedicated Preview runtime account (not service_role/root), TLS/ownership and correct PostgREST signed Clerk A/B. This candidate does **not** create login roles, passwords, provider settings or migrations remotely.
3. Decide a measured handover from old RPC to the new private route. `REVOKE` **only after** validating replacement and obtaining the owner's explicit authorization for this exact SHA and environment.
4. Independently audit real Git diff and PG17, then accept candidate lineage. No merge, Production or Preview release automatically follows CI.
5. **Exactly two formal paid Supabase rehearsals only when the entire R2 is done:** `R2_PHASE`, then `R0_TO_R2_CUMULATIVE`; cost approval, isolated DB, evidence and cleanup. No formal rehearsal for this sub-slice.

**Current deployment decision: BLOCKED.** Green CI is useful engineering evidence, not proof of operational readiness.
