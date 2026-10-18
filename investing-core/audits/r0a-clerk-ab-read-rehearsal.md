# R0-A — Clerk A/B read-only rehearsal contract

**Candidate only, not deployed.** Stacked on PR #6 at
`8c4320ec48de0c918260b52b34cd1a562a52777e`.

## Scope

A minimal preview-only `GET /api/investing/rehearsal/auth-check` entry
calls the existing `loadOwnInvestingAccountsFromClerk()` server adapter.
It obtains the signed-in actor and bearer token with Clerk `auth()`;
Supabase PostgREST independently verifies the JWT and applies Investing
RLS. The endpoint does not accept a client-supplied identity, SQL
connection string, JWT, account filter, input body, or privileged key.

This returns **account summaries only** (`id`, `name`, `baseCurrency`)
for the logged-in user and a data availability state. It never returns
`userId`, `sessionId`, JWTs, passwords, private keys, cash, balances,
broker confirmations, or trading/execution authority.

## Hard gates

The endpoint returns 404 unless **all** hold:

- Vercel deployment `VERCEL_ENV=preview` (never production);
- `VERCEL_GIT_COMMIT_REF=candidate/investing-r0a-clerk-ab-read-rehearsal-20261018`;
- `INVESTING_R0A_AB_READ_MODE=rehearsal` (server only);
- `INVESTING_R0A_AB_READ_PROJECT_REF=zkqgpejlkgootkvkebhd`;
- `NEXT_PUBLIC_SUPABASE_URL=https://zkqgpejlkgootkvkebhd.supabase.co`;
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is the **preview** project's
  publishable key, never a `service_role` secret.

These deployment checks are not user authorization. Clerk and Supabase
JWT/RLS still have to be exercised and independently verified.

## Required independent gates before preview deployment

1. Verify exact candidate predecessor and diff; all relevant CI PASS.
2. Verify deployment preview project, branch/commit, Clerk **new site**
   instance, Supabase preview ref and JWT issuer/claims/keys. Never copy
   a Clerk secret, DB password or session token into GitHub or chat.
3. Ensure two controlled Clerk test users A and B actually correspond to
   two different `investing.investment_accounts.owner_user_id` records
   in the preview DB, as verified server-side, **not** by client claims.
   Do not print the full user IDs in published logs.
4. Explicitly authorize deployment to an isolated Preview environment
   and its exact allowlisted non-secret configuration. No production
   deployment, production environment variable modifications, merge,
   SQL migrations or new DML are authorized by this PR.

## Rehearsal evidence, after separately approved preview deployment

- Anonymous GET: HTTP 401; no account data.
- Genuine Clerk test user A: HTTP 200, only owner A's account summaries.
- Genuine Clerk test user B: HTTP 200, only owner B's account summaries.
- Account identifier, `userId`, `role`, or token forged as query
  parameters/headers: cannot switch the server-derived actor and
  cannot expose another tenant's account.
- Invalid/expired JWT or Supabase refusal: fail closed (401/503), never
  fallback to privileged API keys or guessed empty data.
- Wrong `VERCEL_ENV`, ref, branch, mode or key: 404.
- No database writes or financial journal activity during the rehearsal.
- Audit DB role grants/RLS, two distinct account owners, and zero ledger
  transactions before and after the read-only session test.

## Explicitly out of scope

No active financial write endpoint, balance assertion, contribution
`USER_REPORTED`, performance data, confirmed cash, paper/live broker,
portfolio mutation, execution or production migration. This candidate
does NOT close the entire Investing R0-A until the real Clerk→PostgreSQL
writer path and associated adverse-case tests are independently proved.

**Warning:** This route compiles into the app bundle if the code is
eventually merged; its production safety depends on its fail-closed
configuration gate. Production deployment of this candidate is
not approved.
