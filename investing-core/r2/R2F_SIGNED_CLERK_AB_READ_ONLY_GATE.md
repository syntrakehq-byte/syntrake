# R2-F — Real signed Clerk A/B → Supabase PostgREST RLS read-only gate

**State:** Draft implementation only. **No remote endpoint called**, no Supabase rehearsal, no account/financial write, no paid resource, no Vercel config changes.

**Accepted predecessor:** `main@29f1c068769e34a84e87717ac8cc9286dd937938`.  
**Stacked unaccepted parent:** PR #37 `ad4054d93901c69850fe17a2f7600b67e33086ed`. R2-A→E Drafts remain unaccepted.

## What is proved by this tool (when manually executed with real sessions)

A *real* black-box test of the existing **Preview** `zkqgpejlkgootkvkebhd` through HTTPS Supabase PostgREST, using exactly two **distinct** server-signed Clerk session JWTs (`A` and `B`) and two corresponding **existing owned Investing account UUIDs**. These accounts MUST already exist; no fixture is created by this probe. It will **fail** rather than claim success if A or B has no account, the configured Clerk third-party JWT provider is missing, the role claim is incorrect, the PostgREST schema isn't exposed, an account is unreadable, or the RLS policy is wrong.

Exactly five HTTPS `GET` requests: A reads A, B reads B, A queries the exact B account UUID, B queries the exact A account UUID, then a tampered A signature must be rejected with HTTP 401/403. The negative cross-account lookups deliberately omit `owner_user_id` filters so **only server-side RLS can prevent access**; they must return an empty list. The positives must each return exactly one account matching its expected owner. No scalar cash/balance is requested. Requests use `Accept-Profile: investing`, a publishable key and `Authorization: Bearer <real Clerk token>`.

A locally decoded `sub`, `role`, expiry and issuer is **untrusted preflight only** — not signature verification. Only the actual HTTPS gateway decides signature validity; requiring an explicit tampered-signature rejection provides negative evidence. The output contains only `SIGNED_CLERK_AB_RLS_READ_ONLY_PASS` and aggregate counts, never JWTs, user IDs, account IDs or financial state.

This is **not** an end-to-end Next.js Clerk auth test or permission to provision a private PostgreSQL runtime. It does **not** prove Postgres `SET ROLE` writer operations, financial reconciliation, historical coverage compatibility, app session cookies, Next.js POST CSRF or broker integration.

## Operator-only run, after separate explicit authorization

The source is `scripts/investing-r2/check-signed-clerk-ab-readonly.ts`. It rejects GitHub Actions CI and is not linked to any Vercel route. It must remain **unrun until the owner authorizes external Preview testing**. When authorized, execute locally with a short-lived environment populated from each user's own authenticated Clerk session (never paste tokens into chat, documentation, screenshots, source, CI variables or GitHub PR comments). Required runtime settings:

| Environment variable | Purpose |
| --- | --- |
| `INVESTING_R2F_MANUAL_READ_ONLY=explicitly_enabled` | Explicit opt-in |
| `INVESTING_R2F_SUPABASE_URL` | **Exactly** `https://zkqgpejlkgootkvkebhd.supabase.co` |
| `INVESTING_R2F_SUPABASE_PUBLISHABLE_KEY` | Existing Preview publishable key, not privileged |
| `INVESTING_R2F_CLERK_USER_A`, `INVESTING_R2F_CLERK_USER_B` | Two different verified Clerk IDs |
| `INVESTING_R2F_OWN_ACCOUNT_A`, `INVESTING_R2F_OWN_ACCOUNT_B` | One existing owned account UUID per actor, different |
| `INVESTING_R2F_SIGNED_JWT_A`, `INVESTING_R2F_SIGNED_JWT_B` | Two current signed Clerk session JWTs containing `role=authenticated` |

Command (with environment already supplied through a private, non-logged secret facility):
`npx tsx scripts/investing-r2/check-signed-clerk-ab-readonly.ts`.

The probe fails closed on expired/incorrect/forged payload, production/other host, invalid key, same user/account, errors, 200 on invalid signature, missing own row, unexpected owner, cross-account leakage or response schema mismatch. Negative unit tests use **synthetic strings and a mock gateway**; CI must not receive real tokens or contact Supabase.

## R2 mandatory follow-up beyond this probe

- Independent review and acceptance of exact Git SHA, CI and historical Preview SQL lineage.
- Resolve migration mismatch: legacy import coverage stays `LEGACY_COVERAGE_UNKNOWN`, never silently backfilled.
- Audit historical `SECURITY DEFINER` RPC, authenticated permissions and impact before *separately authorized* deactivation. No privilege changes from this PR.
- Provide and verify restricted private writer/first-provisioner login only under explicit mandate; do not equate `service_role` with ownership.
- Full browser two-session Clerk flow and live Preview read/write/readback remains outstanding, with user consent for any external operations.
- **Formal paid Supabase rehearsals only after all of R2 is complete**: R2 phase and then cumulative R0→R2. This read-only probe is NOT either rehearsal.
