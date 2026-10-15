import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("Investing opening-position imports", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260811160000_investing_opening_positions.sql"),
    "utf8",
  );
  const trackingMigration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260811170000_investing_tracking_accounts.sql"),
    "utf8",
  );

  it("stores imports as append-only owner-readable evidence", () => {
    expect(migration).toContain("create table if not exists public.investing_opening_position_imports");
    expect(migration).toContain("investing_opening_position_imports_append_only");
    expect(migration).toContain("alter table public.investing_opening_position_imports force row level security");
    expect(migration).toContain("create policy investing_opening_position_imports_select_own");
    expect(migration).toContain("unique (account_id, idempotency_key)");
  });

  it("imports Paper positions through a balanced canonical ledger path", () => {
    expect(migration).toContain("create or replace function public.investing_import_opening_position_v1");
    expect(migration).toContain("and environment = 'paper'");
    expect(migration).toContain("and status = 'active'");
    expect(migration).toContain("insert into public.investing_positions");
    expect(migration).toContain("'opening_position_import'");
    expect(migration).toContain("'investment_asset', 'debit'");
    expect(migration).toContain("'paper_funding_equity', 'credit'");
    expect(migration).toContain("investing_idempotency_payload_mismatch");
    expect(migration).toContain("grant execute on function public.investing_import_opening_position_v1");
    expect(migration).toContain("to service_role");
  });

  it("also allows non-executing manual tracking accounts for existing holdings", () => {
    expect(trackingMigration).toContain("create or replace function public.investing_import_opening_position_v1");
    expect(trackingMigration).toContain("environment in ('paper', 'simulation')");
    expect(trackingMigration).toContain("manual_tracking_equity");
    expect(trackingMigration).toContain("manual_opening_position_imported");
    expect(trackingMigration).toContain("paper_opening_position_imported");
    expect(trackingMigration).toContain("grant execute on function public.investing_import_opening_position_v1");
  });
});
