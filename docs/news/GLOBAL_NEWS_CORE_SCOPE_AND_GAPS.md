# SYNTRAKE News Core — Global Multisource Expansion (DRAFT)

## Product contract

News Core is a **global financial/economic news ingestion and factual evidence system**, not an SEC-only reader. SEC/EDGAR is one provider; other providers will include official corporate releases, central bank publications, government macroeconomic releases, exchanges/regulators, and permitted editorial feeds. News Core must preserve publication/source/rights/temporal evidence independently of whether a structured fact is extracted. Investment decisions belong exclusively to Investing/Trading.

## Verified baseline

- Existing News N0–N5 on parent PR #102: SEC ingestion, PostgreSQL state, autonomous supervision, factual classification, PIT and source security.
- The local AUT-001 experiment collected 147 SEC publications for one CIK; 12 factual revisions, 90 rule-nonmatches, 45 unsupported factual form entries. These numbers do not measure total SEC coverage or world news coverage.
- No autonomous global providers, publisher entitlements or end-to-end editorial ingestion are proven.
- Do not erase the prior audit/tests because the product scope expands.

## First increment in this branch

- Pure normalized JSON Feed v1/v1.1 adapter and explicit source configuration type.
- Enforces HTTPS, approved publisher article hosts, deterministic identity/fingerprints, strict ISO timestamps, explicit unknown dates, duplicate detection and whole-batch failure.
- No network calls, persisted data, checkpoints, licensing assumptions, production toggles or external costs. Security against DNS rebinding and SSRF remains the responsibility of an explicitly designed future source-specific fetch path; never pass unverified remote URLs to generic fetch.
- This is NOT an operational global news collector.

## Required implementation sequence

1. **N-G1 Source registry and contracts:** versioned registry with provider type, approved hosts, domain validation, source rights, rate policies, provenance, publisher identity, disabled-by-default sources; distinguish content retention from metadata.
2. **N-G2 Fetch/parse adapters:** real source-specific RSS/Atom, JSON Feed, official API and accessible document feeds; safe pinned TLS/redirect policies, bounded response, canonical URLs, immutable raw evidence where permitted, per-source retry/backoff; allow no arbitrary browser-supplied endpoints.
3. **N-G3 Durable ingestion:** per-source/scope checkpoints, leases, fencing, replay/idempotency, publication versioning, corrections, publisher time versus ingest time, outage backfill, PIT.
4. **N-G4 Contextual evidence:** structured claim linked to complete context, entity, document, revision and source passages; reject vague statements such as "This proposal was approved" when the antecedent cannot be resolved; do not invent event dates.
5. **N-G5 Coverage and monitoring:** per-source availability, volume, delay, unparsed/rejected rates, stale feeds, source diversity, correction propagation, source rights, data quality and coverage gaps.
6. **N-G6 Integration and live acceptance:** source-diverse official/editorial fixtures with provenance, end-to-end PostgreSQL17 tests, autonomous multi-day supervision, security review; expand to real source connections one by one according to available rights and technical conditions.

## Acceptance gates

- A registered source can be discovered, fetched safely, normalized, stored and replayed without duplicates.
- An unsupported document is retained as a publication (where permitted), not silently discarded as a lost news item.
- Unknown times remain unknown; PIT reads never reveal post-cutoff evidence.
- A broken or revoked source cannot prevent unrelated sources' checkpoints from advancing.
- Source rights must govern storage, display and retention.
- Live operation must demonstrate independent scheduler/worker functionality without browser sessions.
- Coverage reports count *sources monitored, publications observed, parse failures, factual matches, editorial relationships* separately.

## Current state

This branch only implements the **first pure adapter**, not the above runtime, nor global source activation. Remain Draft. No merge, no deploy, no remote migrations and no runtime changes until independent review and explicit authorization.
