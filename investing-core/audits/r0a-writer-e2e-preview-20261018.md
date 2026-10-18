# R0-A — Preview-only writer end-to-end rehearsal (CANDIDATE, NOT ACCEPTED)

Accepted technical predecessor **pending gate**: PR #7 head
`7bdf67feb96207039ad69ddbed38cc9cb351ddcf`.
This slice must be separately audited. No merge or production deployment approved.

## Verified precondition (2026-10-18)

- Supabase Preview branch ref: `zkqgpejlkgootkvkebhd`.
- Production parent ref: `vbazzxqyuqcrmjytaboc` (NEVER a test target).
- Preview account A: `f886c954-0a0f-419c-890a-b77ecb0c36cf`.
- Preview account C: `676ae244-9ead-449c-861d-2f34a81285e3`.
- Real distinct Clerk Development identities were verified via server-side
  PostgREST logs; each saw only its own summary in the read rehearsal.
- Writer capability `investing_contribution_writer` is NOLOGIN and
  `investing_writer_runtime` is LOGIN NOINHERIT, NOBYPASSRLS,
  with explicit SET ROLE permission only.
- No cash/clearing subledgers, idempotency keys, journals or ledger entries
  existed on the preview at this time.
- No sensitive connection string is committed to Git or printed in tests.

## HTTP route contract

`POST /api/investing/rehearsal/contribution-smoke`. NO GET mutations.
The entire route is 404 unless **all** conditions pass:

1. `VERCEL_ENV=preview` and exact branch
   `candidate/investing-r0a-writer-e2e-preview-20261018`.
2. Preview-only `INVESTING_R0A_WRITER_HTTP_MODE=rehearsal-armed`.
3. Existing writer's private `INVESTING_WRITER_MODE=rehearsal`,
   `INVESTING_WRITER_PROJECT_REF=zkqgpejlkgootkvkebhd` and
   `INVESTING_WRITER_DATABASE_URL` point exclusively to
   `db.zkqgpejlkgootkvkebhd.supabase.co:5432/postgres`,
   login `investing_writer_runtime`, verified TLS.
4. The application uses **Development Clerk keys** (`pk_test_` and `sk_test_`).
5. Request host equals the exact Vercel deployment host (`VERCEL_URL`),
   HTTPS, same-origin `Origin`, JSON content type, no query string.

The only JSON input is `{"accountId":"<A_or_C_fixture_uuid>"}`.
Strict schema rejects any extra fields, including user ID, actor, session,
bearer token, role, amount, currency, reference or idempotency key. This
application-level allowlist is NOT financial ownership; the server uses
verified Clerk `auth()` and the private writer performs canonical owner and
membership checks under PostgreSQL RLS after `SET LOCAL ROLE`.

The operation is deliberately one-shot, fixed per account:

- 1 **minor currency unit** (EUR cent, not EUR 1) and EUR only;
- fixed reference and fixed idempotency key for each account;
- provenance `USER_REPORTED`, `verifiedByBroker=false`;
- at most one posted journal per fixture account even across retries.

This is **SYNTHETIC rehearsal bookkeeping**, not a real bank transfer,
broker confirmation, real user contribution, profit or investment performance.
Even if one transaction is posted in PREVIEW it must never be promoted into
live state. Do not use this endpoint for actual client financial records.

If Clerk rejects a request, PostgreSQL cannot access the account, the
database cannot open, or the event cannot be posted atomically, the route
returns a generic non-success response without falling back to service_role.
A fixed-amount request C->A must return 403 and produce zero new journals.

## Pre-activation contract (do not shortcut)

- Audit exact PR SHA, code/diff, check suite, Vercel branch and encrypted
  environment scopes; require ALL tests PASS, including real PG17.
- Apply the **separate one-shot fixture**
  `supabase/rehearsal/fixtures/20261018_r0a_writer_subledgers_preview_only.sql`
  only after verifying the current Preview connection host and the baseline.
  It must not run automatically as a migration. The file itself cannot
  independently prove the connection host.
- Reconcile four subledger rows and zero journaling rows; independently
  verify all owner/currency/role constraints before enabling the HTTP route.
- The PostgreSQL login password is known only to the operator. Configure
  `INVESTING_WRITER_DATABASE_URL` as an encrypted **branch-scoped Preview**
  Vercel environment variable, never in chat, GitHub, CI logs, public envs,
  or general Preview or production settings.
- Enforce Vercel Deployment Protection.
- Arm the HTTP route **only** after a reviewed Preview candidate deployment
  and controlled operator test window. Disable it promptly after rehearsal
  and remove this temporary route before any merge.

## Required real end-to-end gates

0. Fully anonymous request: blocked without SQL or side effects.
1. A with Clerk signed in: POST A returns exactly one posted USER_REPORTED
   journal, exactly two balanced EUR entries, one idempotency result.
2. Same A POST again: same transaction ID, no additional entries.
3. Multiple concurrent replays: still exactly one posted journal.
4. C POST A: blocked with zero additional journal and zero cross-tenant
   disclosure; A POST C symmetrically blocked.
5. C POST C: its own single posted USER_REPORTED journal.
6. Missing subledgers, wrong account, forged authority, invalid payload,
   inactive mode, incorrect branch, prod project, runtime failure and
   malformed session: fail closed, without financial writes.
7. Independent SQL reconciliation: journal and entries are balanced,
   posted/immutable, tenant-scoped; all active financial records have
   provenance USER_REPORTED and verifiedByBroker=false.
8. Record exact candidate SHA, preview deployment ID, migration version
   baseline, DML evidence and no production diff.

Until these steps are complete the writer end-to-end and global R0-A gates
are **BLOCKED**. CI fixtures are **not** production/external proof.
