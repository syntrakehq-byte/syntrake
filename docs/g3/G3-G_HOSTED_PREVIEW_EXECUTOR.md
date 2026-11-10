# G3-G — Bounded hosted Preview executor (Draft)

Scope: Supabase Preview only, project ref gehlmcjctcfdbtzlyswm; the Next.js route is POST /api/internal/g3-worker. No Production migration, financial write, persistent worker, external market-data request or Cron job is authorized by this change.

## Gates and operational procedure

- Node.js route accepts a POST only on branch feat/g3g-preview-hosted-worker-20261108, with exact SHA match G3G_APPROVED_SHA = VERCEL_GIT_COMMIT_SHA, and a constant-time-verified Authorization Bearer token against G3G_EXECUTOR_TOKEN (at least 48 URL-safe characters).
- X-G3-Operation: readiness is independent of the provider and opens only the existing reader LOGIN with SET ROLE market_core_reader and verified server version. It requires G3G_READINESS_MODE=enabled. It never writes and never accesses Twelve Data.
- X-G3-Operation: run is separately guarded by G3G_WORKER_MODE=enabled, the existing Twelve Data gate, independently reviewed G3G_STORAGE_ATTESTATION_JSON, the existing bounded worker, and exact Preview-only TLS connections.
- Real run requires approved rights, explicit deadline, physical retention/purge test (purgeVerified=true), one canonical provider policy, registered worker capability, budget, alias and a task. Without them it must fail closed. The route never receives arbitrary job/provider input.
- All database connections use the official CA in MARKET_DATA_READER_CA_PEM, hostname verification and exact Preview host db.gehlmcjctcfdbtzlyswm.supabase.co. Role usernames must be syntrake_g3_preview_reader or syntrake_g3_preview_ingest.
- New secret names in Vercel Preview only: G3G_EXECUTOR_TOKEN, G3G_APPROVED_SHA, G3G_READINESS_MODE; when authorised later, G3G_INGEST_DATABASE_URL, G3G_WORKER_MODE, G3G_INSTANCE_CAPABILITY_TOKEN, and G3G_STORAGE_ATTESTATION_JSON. Existing MARKET_DATA_READER_DATABASE_URL, MARKET_DATA_READER_CA_PEM, and license/provider variables stay restricted.
- Set G3G_WORKER_MODE=disabled and SYNTRAKE_G3_PROVIDER_ENABLED=disabled while the Twelve Data retention right and physical-deletion rehearsal remain unproved.
- Vercel Deployment Protection may reject external HTTP from Supabase Cron before this route sees it. If so, use an independent, protected automation-bypass header, not an unprotected public deployment; maintain the app-level bearer check. No bypass secret is created by this change.
- pg_cron can be present with zero scheduled jobs. Schedule only after the hosted readiness probe succeeds, the license gates pass and a distinct live-provider operation is explicitly approved. Never schedule a disabled endpoint as a fake success.
- Never display prices received under non-display rights. Investing and Trading must use the private shared PIT reader; no direct browser price exposure.

## Acceptance evidence

The G3-G CI workflow must pass the new unauthorized/readiness/disabled/aggregate-response/TLS-target tests, previous G3-F gates, TypeScript, lint, the G3-E offline PostgreSQL 17 rehearsal and Next.js build. This proves compilation and offline execution; it does not establish a successful HTTP invocation on a protected hosted Preview or a live market-data license.

## Rollback

Disable G3G_READINESS_MODE and G3G_WORKER_MODE; clear the exact SHA approval for this branch. No Cron job is created here, so there is no recurring task to cancel. The G3-G branch and PR may be abandoned without altering the G3-E baseline.

## Protected HTTP readiness verification — operator procedure

The checked-in script scripts/g3g-readiness-once.mjs uses the authenticated Vercel CLI with 'vercel curl'. It sends exactly one POST with X-G3-Operation: readiness and the application Bearer token. It is read-only; it refuses Production, unpinned Preview deployments, an enabled worker or an enabled Twelve Data provider.

Use an authorized Vercel CLI session for the SYNTRAKE project. Load the G3-G branch-scoped Preview secrets with the documented 'vercel env run' workflow without printing credentials. Set G3G_PREVIEW_URL to the exact READY Preview deployment URL and G3G_EXPECTED_DEPLOYMENT_HOST to its hostname. Set VERCEL_ENV=preview and VERCEL_GIT_COMMIT_REF=feat/g3g-preview-hosted-worker-20261108. Confirm VERCEL_GIT_COMMIT_SHA and G3G_APPROVED_SHA both match the deployment. Run: node scripts/g3g-readiness-once.mjs.

A valid result is JSON status READY_READONLY with providerCalls=0 and marketWrites=0. A Vercel SSO error, refused credential, failed TLS, non-JSON response, invalid deployment or connection failure means BLOCKED. Unit tests use a fake Vercel command and do not prove the real HTTP call. Record deployment ID, exact SHA, HTTP status and timestamp without recording tokens or database URLs. Never pass a Bearer token as a query parameter.

## Supervisor identity

Supabase Preview has a dedicated LOGIN syntrake_g3_preview_supervisor with password in Vault. It inherits market_core_supervisor, without SET ROLE. It may execute market_core.register_worker_instance; ingest LOGIN cannot. A fixed login binding to g3-preview-bounded exists, but no active worker instance or capability token has been registered. Register using a real supervisor LOGIN, store capability securely, then validate a heartbeat as the ingestion LOGIN. Do not impersonate the supervisor through a PostgreSQL administrator connection.

## Autonomous rehearsal acceptance

Until authenticated readiness and supervisor capability registration pass, do not install active Cron jobs. The Market Data Core rehearsal must use an explicitly synthetic provider and separate short-lived fixture rights. Prove exactly-once claim/ACK, append-only historical revision, cache reuse, PIT, budget reservation and recovery, license masking, and private shared historical reads for Investing and Trading. Synthetic fixtures do not grant Twelve Data storage, retention or display rights.
