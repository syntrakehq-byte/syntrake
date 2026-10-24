# SYNTRAKE — R2 Preview/Production read-only drift audit

**Observed:** 2026-10-24, Supabase connector live metadata and read-only SQL catalog inspection.  
**Git candidate:** PR #35 `409fc016c95dd93eb41ca9c6c5d4f1087a3ccc3b` as seen at discovery; **do not treat this SHA as final after this document**.  
**Accepted predecessor:** `main@29f1c068769e34a84e87717ac8cc9286dd937938`.  
**Nature:** independent data-source *readback*, not a completed independent code audit or paid Supabase rehearsal. No DDL, DML, billing or branch changes.

## Critical verified environment identity

| Field | Production | Existing historical Preview |
|---|---|---|
| Supabase ref | `vbazzxqyuqcrmjytaboc` | `zkqgpejlkgootkvkebhd` |
| Parent | Main / production | Branch `investing-r0a-rehearsal`, parent `vbazzxqyuqcrmjytaboc` |
| PostgreSQL | 17.11 | 17.11 |
| Latest migration registry | `20261020180000 investing_first_readonly_release` | `20261023050846 investing_r2c2_verified_claims_rpc_preview_20261023` |
| R2 import tables | **ABSENT** | PRESENT |
| R2 onboarding | **ABSENT** | PRESENT |
| R2 initial portfolio receipts | **ABSENT** | PRESENT |
| R2 import writer role | **ABSENT** | `NOLOGIN NOBYPASSRLS` |
| R2 private import runtime login | **ABSENT** | **ABSENT** |
| R2 first-account runtime role | **ABSENT** | **PRESENT but NOLOGIN** |

## Blocking incompatibilities observed on live Preview

**P0 — Financial completeness unknown for historical imports.** `investing.portfolio_import_snapshots` in Preview has **no** `reported_cash_coverage` or `reported_position_coverage` columns. Git PR #35 and Draft R2-B1 code require these two mandatory user-asserted coverage values. The Preview schema is **not compatible** with the current candidate. There are **2** existing import snapshots (aggregate count only); 3 child cash rows, 1 child position row. **Never backfill `NOT_REPORTED`, `PARTIAL`, `ASSERTED_COMPLETE`, zero or any other financial assertion automatically.** Any historical imported data without completeness proof must remain `UNVERIFIED_LEGACY_COVERAGE_UNKNOWN` / `UNAVAILABLE`, not silently upgraded.

**P0 — Old R2-C2 privileged RPC exists.** Preview has `investing.provision_first_portfolio(uuid,text,text,text)` defined as **SECURITY DEFINER** and `authenticated` retains **EXECUTE**, while `anon` does not. Its body checks signed-request GUC `sub` and `role` and applies its own owner/intent/legacy/account gate; this observation **does not prove an exploitation**, but **does contradict** the new R2-C2/R2-C4 contract that explicitly excludes exposing that RPC. There are 3 historical initial portfolio receipts and 5 onboarding intents (aggregate counts). It must be independently audited for role ownership, signature validation at gateway, search_path, RLS, request context and functions ACL **before** any R2-C4 Preview release. Removing/revoking it is a **separate authorized Preview operation**, not an automatic change.

**P0 — R2-D runtime cannot connect as specified.** `investing_import_preview_runtime` does not exist. `investing_initial_preview_runtime` exists but **rolcanlogin=false** (and has SET role membership to `investing_initial_provisioner`); R2-C4's direct-connection runtime DSN likewise is **not operable** via that role as observed. This is intentional fail-closed and must not be worked around using `postgres`, `service_role`, disabling TLS or impersonating a user.

**P1 — Migration lineage divergence.** Preview registry contains historical R2-B/R2-C/C2 migrations from 2026-10-22/23, whereas Production only has R0/R1 lineage. Git PR #35 is stacked over Draft PR #28/#30/#31/#32/#33/#34; CI PG17 spins up clean schema from `release-candidates`. **A green fresh PG17 suite does not prove the historical Preview DB is ready for the current SHA**. Never `db push` the newer whole R2 release-candidate SQL on top of Preview as though clean, or rewrite migration history to claim equivalence.

## Required remedial sequence (not executed)

1. Preserve current Git accepted predecessor and Preview historical snapshots, record catalog hashes and registry. Do not delete historical database state or rewrite old migrations.
2. Version a forward **Preview-only compatibility migration** that **adds nullable** coverage columns, explicitly preserves existing NULLs as `LEGACY_COVERAGE_UNKNOWN` and requires coverage for all **future** inserts, with check constraints `NOT VALID` where necessary. Use dedicated PG17 tests with old-style historical snapshots and no fabricated completeness; do not add a default that retroactively fabricates evidence.
3. Update the reader/history contracts to return `UNAVAILABLE` or a safe legacy coverage status on existing NULL rows; no silent declaration and no casting NULL to 0. Use a new version tag/evidence where appropriate. An authorized manual provenance-based correction can create a **new append-only** declared snapshot; never overwrite old.
4. Independently audit the older `SECURITY DEFINER` RPC and confirm its exact Preview PostgREST public exposure, signature gate and ACL; document whether to decommission or retain under an explicit security gate. Do not silently revoke because a separate historical test or deployment may depend on it.
5. Design narrowly privileged server-only Preview runtime login/SET ROLE and prove audit, actor A/B and least privilege. Decide IPv6/direct pooler behavior and TLS trust/CA separately. **No creation of login/password or Vercel env without authorization.**
6. Only after these readiness blockers are cleared, run **actual** signed Clerk A/B Preview integration for read/write/readback (not counted as the two final rehearsals), with separate external-operation approval and nonfinancial synthetic data.
7. Keep **both formal Supabase rehearsals reserved exclusively for when the complete R2 is built**: `R2_PHASE`, followed by `R0_TO_R2_CUMULATIVE`; obtain cost authorization first.

### Gate conclusion

**CURRENT R2 DEPLOYABILITY: BLOCKED (PREVIEW SCHEMA DRIFT + PRIVILEGED RPC CONFLICT + NO PRIVATE LOGIN).**  
**Production:** R0/R1 baseline only; **do not** infer R2 production deployment.  
**R2 candidate implementation:** CI evidence scoped to isolated synthetic PostgreSQL 17; no signed real Clerk A/B or remote write tested.

Source of audit: direct Supabase connector `list_projects`, `list_branches`, `list_migrations`, read-only `execute_sql` against the exact refs above. All numbers are as of this observation and must be reconfirmed before changes.
