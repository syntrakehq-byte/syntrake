# R2-C4 — Privileged *private* PG bridge for first-account creation (Candidate)

**Date:** 2026-10-24. **Status:** Draft, not independently accepted, not live.  
**Accepted predecessor:** `main@29f1c068769e34a84e87717ac8cc9286dd937938`.  
**Stack:** #28 (R2-A Draft) → #30 (R2-B1 Draft) → #31 (R2-C1 Draft) → #32 (R2-C2 Draft) → #33 (R2-C3 Draft `86d4f521bb21a5850b9c711be3cf168c3a3e98f2`) → this candidate.

## Purpose

Join a server-verified Clerk session and an existing unverified Investing onboarding choice to the **one-time account/portfolio structural constructor** from R2-C2. This enables a genuinely executable `POST /api/investing/portfolio/initialize` *when—and only when—an isolated Preview private database login, TLS CA, and all environment gates are separately configured and approved*. It creates no balance, deposit, holdings, contribution, Trading authority, broker instruction, financial transaction or ledger entry. Its response is `STRUCTURE_CREATED_UNFUNDED`; cash, valuation and broker evidence remain `UNAVAILABLE`.

## Never promote without external gate

1. **Production always 404**, including when secrets are accidentally present. The route requires Vercel `preview` on the **exact candidate Git branch** `candidate/investing-r2c4-private-preview-initialization-20261024`.
2. **Preview branch is still not automatically enabled.** Required settings: `INVESTING_R2C_PREVIEW_MODE=enabled`, `INVESTING_R2C_SUPABASE_PROJECT_REF=zkqgpejlkgootkvkebhd`, matching `NEXT_PUBLIC_SUPABASE_URL` and publishable key, **plus** `INVESTING_R2C4_PRIVATE_WRITE=enabled` and `INVESTING_R2C4_PROJECT_REF=zkqgpejlkgootkvkebhd`.
3. The **only** acceptable server-only PostgreSQL login is `investing_initial_preview_runtime` at the direct host `db.zkqgpejlkgootkvkebhd.supabase.co:5432/postgres`. `INVESTING_R2C4_PG_DSN` cannot contain query flags, alternative project ref, root `postgres` user or other hostname. TLS needs `INVESTING_R2C4_PG_CA_PEM`, verification with `rejectUnauthorized:true`. All variables are **server-only**, never `NEXT_PUBLIC_`.
4. The private login currently **does not exist as enabled runtime in this candidate**. Granting LOGIN/password and narrowly delegated `SET ROLE investing_initial_provisioner` is a **separate authorized Preview-only operation**, never an automatic GitHub PR side effect. The SQL candidate `20261023063000_r2c2_first_portfolio.sql` must pass independent PG17/RLS review before any migration. No public PostgREST `SECURITY DEFINER` RPC from historic PR #23 is imported.
5. Reject missing/forged Clerk identity or session *server-side*; JSON cannot override owner/user/tenant IDs; exact origin, JSON content type, path, method, byte cap and Zod command required. Requests use a private PG Pool with `SET LOCAL ROLE`, tx-local actor, idempotency lock, RLS and atomic COMMIT. Failure rolls back and returns generic errors without secrets.
6. The client checks the existing-account review `GET` before permitting creation. That HTTP read is only a user-interface precaution; the DB itself **independently rejects** attempts to provision a preexisting account. A lost response must be re-read, never blindly retried with another key.
7. This candidate reuses the owner-scope Supabase reader from #33. It provides a separate `/investing/portfolio/initialize` Preview UI and conditional navigation from `/investing/start` only when the private write capability is configured.

## Mandatory security/evidence gates

- Confirm env settings, project refs, password role, migrations, TLS CA trust, PostgREST exposed schema and RLS from real Preview. **None of these are inferred from GitHub CI.**
- Independently audit boundary that a verified Clerk session is not user-controlled. Test actual signed independent Clerk A/B JWTs and negative cross-account request at Preview after separate authorization. A developer-supplied fake userId in tests is **synthetic**.
- Rate limiting and abuse controls require assessment before allowing the POST publicly, even in Preview, beyond structural once-per-actor idempotency.
- CI: unit tests for fake Production/branch/ref/root-credentials, origin and query injection, oversized/forged payloads, no DB connection before authorization; isolated PG17 actor A/B and idempotent HTTP → DB replay; financial tables stay untouched.
- **No formal paid Supabase rehearsal until all R2 is complete**. Then, with cost authorization, execute **R2_PHASE**, followed by **R0_TO_R2_CUMULATIVE**, and verify teardown.
- Do not merge, deploy to Production, alter Vercel variables, perform remote DDL/DML, activate a server DB user, create billed resources or perform financial operations without user authorization and exact-SHA gate.

### Architectural caveat

A direct Supabase Postgres connection may require IPv6 reachability. Production-supported poolers or alternative connection models need a **separate host/account/SSL authority review**; never weaken TLS or swap to `service_role` to bypass connectivity. The code intentionally **fails closed rather than silently selecting a more permissive path**.
