# G3-E acceptance matrix

This rehearsal uses an explicitly labelled offline provider fixture and a disposable PostgreSQL 17 service. It does not validate Twelve Data, Production, Vercel deployment, or real Clerk authentication.

| Requirement | Evidence | Result | Limitation |
|---|---|---|---|
| Coordinator creates the demand | `g3e-integrated-pg17.test.ts`: `planDemand()` followed by persisted `ingest_jobs` row | PASS | Fixture database only |
| LOGIN worker claims and commits | Same test: `ContinuousWorkerService`, worker LOGIN, `COMMITTED` job | PASS | Offline provider |
| One run, observation and revision | Same test: one `ingestion_runs` row, one observation revision, `result_revision_id` equals persisted revision | PASS | Disposable PG17 |
| API consumes the worker revision | Same test: HTTP `revisionId` equals `ingestion_runs.result_revision_id` | PASS | Clerk actor is injected |
| Rights redaction and retention | Same test: `LICENSE_BLOCKED` for display denial and expired retention | PASS | Fixture rights policy |
| PIT before knowledge | Same test: cutoff before `as_known_at` has no public values | PASS | Deterministic fixture dates |
| Quality insufficiency | `g3c-authenticated-pg17.test.ts` and `g3a-operational.test.ts` | PASS | Covered by prior approved workflows |
| Provider/listing mismatch | `g3a-operational.test.ts`, `r3c-offline-e2e-pg17.test.ts` | PASS | Covered by prior approved workflows |
| Provider failure and no invented prices | `r3c-offline-e2e-pg17.test.ts` | PASS | Covered by prior approved workflow |
| Reader has no write privilege | Same G3-E test and G3-C restricted LOGIN test | PASS | Fixture role only |
| Rendered browser E2E | No browser runner is configured in this workflow | BLOCKED | HTTP and G3-D component logic are tested; rendered browser was not executed |
| Twelve Data / Production | Explicitly excluded | BLOCKED | No external calls or deployment permitted |
