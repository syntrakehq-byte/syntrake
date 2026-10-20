# Syntrake — R1 first Investing production migration / operator terminal

**PREPARED ONLY. Do not run on Production until this operator script PR and its exact SHA pass independent code audit.** User granted approval for the exact database migration on 2026-10-20, but no automated deployment or unrelated changes were authorized.

## Purpose

The Supabase MCP migration action has no exact `version` input. This is a **local PowerShell operator-controlled** alternative that makes Supabase CLI v2.84.2 generate the desired version from the **exact migration filename**. It does **not** run SQL via the generic execute_sql connector, insert/repair history, or silently choose a new timestamp.

The script is `Invoke-R1ProductionMigration.ps1`. It does **not** have access to any user credentials and must be executed locally by the project operator. The script is pinned to:

- GitHub original accepted `main` SHA `d42ecf58ca46c0e33d866cced2cdf14aa36eced0`, `syntrakehq-byte/syntrake`;
- Supabase Production project `vbazzxqyuqcrmjytaboc`;
- release SQL Git blob `f23fadf42d050a7d45f84ef166f94168256eb892`;
- migration filename `20261020180000_investing_first_readonly_release.sql`;
- historical `20261017191056_remote_schema.sql` recovered from Production registry, **already applied**, never replayed;
- CLI 2.84.2, same version used in isolated PostgreSQL 17 GitHub CI.

### Prerequisites

Windows 10/11 PowerShell (5.1 or later), `git` (with access to the private GitHub repo) and Node.js/npm (`npx.cmd` on PATH). The machine must have network access to Supabase/GitHub/npm. The Supabase CLI authenticates **interactively on the operator computer**, never by secrets typed into chat, code, GitHub issues or PR comments. The CLI account must have access to the correct Production project and be able to connect to its database.

The script creates a *separate* isolated work directory under `%LOCALAPPDATA%\Syntrake\R1-first-production-20261020`. It never executes `db reset`, `migration repair`, `db push --include-all`, `config push`, `db push --include-roles` or `db push --include-seed`. Do not run the ordinary repo's `supabase db push`: that directory includes historical Investing migrations, plus an unapproved future financial writer.

### Phase 1 — Plan (read-only to database)

In a PowerShell window, from the directory containing this script, run:

```powershell
.\Invoke-R1ProductionMigration.ps1 -Mode Plan
```

The script checks the exact old Git source commit, candidate SQL bytes, historical registry SQL SHA-256 and the isolated migration directory, authenticates with Supabase, links project ref, checks linked history and runs **CLI dry-run**. If Git, Node, CLI, credentials, history or release SQL differ, it prints `BLOCKED` and stops.

**Do not proceed** unless the dry-run reports exactly `20261020180000_investing_first_readonly_release.sql` as the sole new migration. If the tool asks to repair a history mismatch, **stop**. Do not run any CLI command besides those in this script to fix that situation.

### Phase 2 — Authorized apply (database-only)

After inspecting a successful `PLAN_PASS`, run:

```powershell
.\Invoke-R1ProductionMigration.ps1 -Mode Apply
```

The script re-runs every local check, re-links the Production project, repeats remote history inspection and dry-run, and requires a typed confirmation: `APLICAR vbazzxqyuqcrmjytaboc 20261020180000`. Only then invokes `supabase db push --linked`, **without** seed, role or --include-all. Supabase CLI may ask for its own additional confirmation. Do not skip it.

If the command returns any ambiguity, error or disconnect, **do not run it again**. Supply only sanitized logs (CLI plan, migration version and failure stage), and stop to inspect actual remote SQL objects and migration history independently before proposing a corrective plan.

### Phase 3 — Independent post-apply audit

A green CLI exit code alone is **insufficient**. An auditor must independently query Production to prove:

1. historical registry has exactly baseline `20261017191056` and new `20261020180000`, with expected names, and original historical SHA unchanged;
2. all nine `investing` tables exist and have enabled RLS; owner/member policy and triggers match the audited SQL;
3. `authenticated` can read only intended account summaries and membership under per-user RLS, and can perform **no** DML or private ledger/identity reads;
4. `anon` cannot read any investment account;
5. no financial-writer role, customer account, ledger journal or external broker transaction was created;
6. Supabase Production Data API auto-exposure stays **OFF**, and `investing` remains **not exposed**, so Vercel Investing stays **disabled**.

The real Clerk third-party JWT issuer/role/audience/tenant isolation, future `investing` Data API exposure, commercial Stripe webhooks and Vercel staging/cutover are **separate gates**.

### Security and disaster containment

Production SQL is **forward-only**. No automatic retry, rollback, dropped schema/table, schema_history repair or financial snapshot rewrite. During an ambiguous apply, inspect first; if a fix is required, create a separately audited forward corrective migration. Do not send passwords, GitHub tokens, signed JWTs or env secrets into chat. Avoid `--debug` because some CLI releases reveal connection information.

**No production SQL is executed by this GitHub PR or its Windows CI tests.**
