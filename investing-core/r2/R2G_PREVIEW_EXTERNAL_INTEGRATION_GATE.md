# R2-G — Supabase historical Preview reconciliation & dormant import runtime

**Date:** 2026-10-24. **State:** DRAFT / BLOCKED for remote change; this is an executable **candidate**, not an applied migration or a sub-R rehearsal.  
**Accepted source:** `main@29f1c068769e34a84e87717ac8cc9286dd937938`.  
**Unaccepted stacked predecessor:** R2-F / PR #38 `2839d2f619604f8e1f0f79df7ec68fa3a70a0c4b`.

## Independent read-only live environment evidence

Exact historical Supabase Preview project `zkqgpejlkgootkvkebhd`: PostgreSQL **17.11**. Catalog confirms:

| Verified item | Real value |
|---|---|
| Import snapshots | **2** (historical, evidence status remains `UNVERIFIED`) |
| Initial-portfolio receipts | **3** |
| Snapshot `reported_cash_coverage`, `reported_position_coverage` | **Both ABSENT** (columns must not be backfilled with false claims) |
| Four import tables | `ENABLE RLS` and `FORCE RLS` |
| `investing_import_writer` | `NOLOGIN`, `NOBYPASSRLS`; snapshot `SELECT`, `INSERT`, only `snapshot_status` **column-level UPDATE**; no table-level UPDATE, no immutable field UPDATE, no DELETE or ledger INSERT |
| `investing_import_preview_runtime` | **Absent** |
| `investing_initial_preview_runtime` | Exists, **NOLOGIN**, member of `investing_initial_provisioner` with `SET=true`, `INHERIT=false`, `ADMIN=false` |
| Historical `SECURITY DEFINER` `investing.provision_first_portfolio` | `authenticated` EXECUTE **TRUE**; contract conflict is confirmed, exploit **not** proven |

The historical Preview contains R2 migration versions `20261022194511`, `20261022201133`, `20261023042737`, `20261023043222`, `20261023045926`, `20261023050318`, `20261023050846`. The accepted Production migration lineage stops at R1. These histories are **different**; do not replay new clean-slate R2 release-candidate SQL onto old Preview or silently repair registry.

Live Vercel Production deployment reported READY at `main@29f1c068...`; examined recent R2 Preview deployments were CANCELED and therefore do not evidence a working remote candidate. The real signed Clerk A/B tool in R2-F remains **not run**.

## R2-G executable candidate

`supabase/release-candidates/20261024205500_r2_preview_import_runtime_nologin.sql` is a carefully gated **forward-only dormant role** blueprint. It refuses incompatible missing-coverage columns, absent/overpowered import writer, incomplete forced RLS, absent necessary snapshot finalize-only grant, unauthorized immutable-field UPDATE/DELETE, ledger posting privilege or an existing runtime name. It then creates a **NOLOGIN NOINHERIT NOBYPASSRLS** `investing_import_preview_runtime` and grants **only** `SET ROLE investing_import_writer` with `INHERIT=false, ADMIN=false`.

**It cannot authenticate or connect** after application. It has no embedded password, no financial posting ability, no right to change declared import values and no authority from client-submitted IDs. Enabling LOGIN and furnishing secrets are **separate security operations** requiring explicit authorization and independent evidence that a Clerk-verified server identity is bound transaction-locally.

Candidate `assertPreviewImportCatalogReady` now additionally checks the `snapshot_status` column-only UPDATE grant. This fixes a subtle PostgreSQL privilege nuance: **table-level UPDATE=false is expected** even when narrowly scoped `UPDATE(snapshot_status)` is granted. Broad UPDATE/DELETE of reported facts remains forbidden.

Isolated PostgreSQL 17 CI exercises: missing historical coverage BLOCKED; overbroad immutable-field UPDATE BLOCKED atomically; exact dormant role with sole SET-only membership; local-CI-only synthetic LOGIN / SET ROLE demonstration; no inherited import/ledger privileges; rollback to NOLOGIN; duplicate execution BLOCKED; zero ledger transactions.

## Required order for any real external integration (NOT executed)

1. Review current Preview migrations, exact catalogue / versioned source hashes and affected historical data. Reconfirm actual project ref. Get **explicit** user authorization of Preview DDL, impact, exact candidate SHA and external cost before changing anything.
2. Independently audit and (only after separate approval) apply the earlier `20261024190500` coverage compatibility delta from PR #35. Historical imported rows must keep **NULL → LEGACY_COVERAGE_UNKNOWN**, not zero, not claimed complete. Read back the real two previous records without changing them.
3. Verify/authorize the R2-G **dormant** import runtime role. Never use `postgres`, `service_role` or disable TLS as shortcuts. If the remote administrator cannot grant role membership cleanly, stop, do not weaken privilege isolation.
4. With operator approval for **read-only** external checks, validate signed Clerk A and B against real Preview PostgREST using the R2-F five-GET test with two existing owned accounts, true provider JWTs and a tampered-signature denial. No synthetic token may be treated as real evidence.
5. Separately authorize secure activation of `investing_initial_preview_runtime` (currently NOLOGIN) with a secret injected via private credentials and TLS. Verify first-account creation **only within a permitted test fixture and explicit Preview permission**. Prior historical privileged RPC remains accessible until its replacement is verified.
6. After the private replacement is demonstrably safe and separately authorized, retire the historical authenticated `SECURITY DEFINER` RPC via the exact-fingerprint **unapplied** revocation candidate in PR #37. Its deactivation is a potential breaking change. Verify no forgotten route depends on it. Re-run Security Advisor.
7. Only then, and after separate secret/role permission, activate import login and SHA-approved Vercel Preview. Verify import → durable readback → actor B denial against authorized **synthetic nonfinancial** user declarations. Do not invent ledger transactions, performance or broker proof.
8. Independent code, financial and authority audit of full R2 stack, merge/release acceptance by approved SHA only. **Formal paid Supabase rehearsals occur only after the *entire* R2 has been built**, in the user's specified order: **R2 complete**, then **R0→R2 cumulative**, cost confirmation and teardown between stages when applicable.

**Do not perform remote migration, SQL role activation, Vercel env change, merge, Production deploy, financial writes or paid rehearsal without explicit authorization.** A CI PASS is not proof of step 2–7; each requires real external readback/evidence.
