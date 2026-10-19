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
3. Existing writer's private `INVESTING_WRITER_MODE=rehearsal` and
   `INVESTING_WRITER_PROJECT_REF=zkqgpejlkgootkvkebhd`. With
   `INVESTING_WRITER_CONNECTION_MODE=session-pooler`, the private
   `INVESTING_WRITER_DATABASE_URL` uses only an independently verified
   `aws-0-eu-west-3.pooler.supabase.com:5432` or
   `aws-1-eu-west-3.pooler.supabase.com:5432` **session-mode** host,
   username `investing_writer_runtime.zkqgpejlkgootkvkebhd` and verified TLS.
   The exact host and username must be copied from the Preview's Supabase
   **Connect** panel; neither gateway index is presumed correct. Direct
   `db.zkqgpejlkgootkvkebhd.supabase.co:5432` with username
   `investing_writer_runtime` remains available only if the deployment has
   supported IPv6 or a separately approved IPv4 ingress add-on.
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
  `INVESTING_WRITER_DATABASE_URL` and `INVESTING_WRITER_CONNECTION_MODE`
  as encrypted **branch-scoped Preview** Vercel environment variables, never in chat, GitHub, CI logs, public envs,
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

## Network gate — Vercel IPv4

Supabase's default direct database host is IPv6-only, and Vercel does not
support outbound IPv6. Therefore the direct host from the earlier writer
adapter is **not assumed usable** in Vercel. The candidate now supports
only the IPv4 Supavisor **session** mode on port 5432 with a dedicated login
qualified by the preview project ref. Transaction mode (6543), arbitrary
regions, other users, and arbitrary poolers are rejected. An actual Supabase
Connect-panel screenshot / independent connection proof is required before
configuring secrets or arming this path. Do not purchase IPv4 ingress or
weaken TLS settings as a shortcut. Pooler support is pending actual login,
SET LOCAL ROLE, transaction consistency and reconciliation proof.

## Database connection verification after credential entry (2026-10-19)

The operator added an encrypted, branch-scoped `INVESTING_WRITER_DATABASE_URL`
in Vercel. Its *presence* and branch scope were verified using undecrypted
Vercel metadata only. Password validity, TLS handshake and SQL login were
**not** inferred from mere environment variable presence.

A separate read-only `GET /api/investing/rehearsal/writer-connection-check`
is now available in the candidate. It requires all Preview gates and a
server-verified Clerk session, uses the private writer LOGIN, starts a
`BEGIN READ ONLY` transaction, verifies PG17, executes
`SET LOCAL ROLE investing_contribution_writer`, and checks that the
server-derived actor can read exactly one of A/C fixture accounts and its
two EUR subledgers under RLS. Its finalizer always issues `ROLLBACK`,
then releases and closes the private pool; no SQL insert/update/delete,
cash movement, transaction, or idempotency record may be created.

This probe **does not use** the independent writer-HTTP arming flag.
`INVESTING_R0A_WRITER_HTTP_MODE` must remain ABSENT, leaving the separate
contribution POST and UI 404. It must not expose the password, token,
actor identifier, account UUID or raw Postgres errors. Successful completion
returns boolean verdicts only. A successful server response must still be
reconciled against the SQL database (all journal tables unchanged).

Once the actual connection probe is proven, REMOVE this temporary GET
before any production merge or deployment. Its existence and CI passing
alone are not evidence that a real database connection succeeded.

### Supabase Root 2021 TLS trust remediation (2026-10-19)

Real Clerk Preview `writer-connection-check` returned
`{"error":"CONNECTION_UNAVAILABLE","failureStage":"CONNECT","failureKind":"TLS_REJECTED"}`.
This means CA/hostname/TLS validation failed at connect; it did **not**
validate PostgreSQL authentication, permissions or writer RLS.

The operator downloaded `prod-ca-2021 (1).crt` from the Supabase
Preview SSL settings. Inspection with OpenSSL verifies a PEM X.509
self-signed CA, `Supabase Root 2021 CA`, certificate signing enabled,
valid 2021-04-28 until 2031-04-26, fingerprint
`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.
This is a PUBLIC trust anchor, **not** a private key or broker authority.

Supabase official PSQL documentation recommends downloading the server
root and `sslmode=verify-full` over the Session pooler. The candidate
pins the fingerprint in `investing-core/server/supabaseRoot2021Ca.ts`;
the writer pool checks the certificate type and validity, and injects
`ssl: { rejectUnauthorized: true, ca: <pinned public CA>, servername: <allowlisted pooler host> }`
only for session-pooler. Disabling Node TLS verification is blocked.
No connection string, actor, TLS CA or hostname is taken from HTTP input.

CERTIFICATE PARSING AND UNIT TESTS ARE NOT EXTERNAL TLS PROOF.
A new *real* GET on an exact approved Vercel Preview SHA must validate
the Supavisor server certificate chain and hostname and then the
PostgreSQL authenticated role and RLS reads. Certificate mismatch must
remain a failure; do not override it, disable SSL, or weaken verification.
Containerized assistant test environment cannot resolve the public
Supavisor hostname, so no independent external handshake is claimed.

Do not merge this temporary Preview diagnostic, or ship the fixture
IDs to production. R0-A and write E2E remain BLOCKED until further gates.
