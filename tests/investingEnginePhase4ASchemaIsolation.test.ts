import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  INVESTING_ENGINE_ARTIFACT_TYPES_V1,
  INVESTING_ENGINE_CANONICAL_PAYLOAD_MAX_BYTES,
  INVESTING_ENGINE_PERSISTENCE_PHASES_V1,
  INVESTING_ENGINE_PERSISTENCE_SCHEMA_VERSION,
  INVESTING_ENGINE_PERSISTENCE_TABLES,
} from "@/lib/investing/engine/v1/persistence/contracts";

const MIGRATION = path.resolve(
  process.cwd(),
  "supabase/migrations/20260720100000_investing_engine_v1_persistence.sql",
);
const PERSISTENCE_ROOT = path.resolve(process.cwd(), "lib/investing/engine/v1/persistence");

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const target = path.join(directory, name);
    return statSync(target).isDirectory() ? sourceFiles(target) : /\.(?:ts|tsx|mjs)$/u.test(target) ? [target] : [];
  });
}

describe("FASE 4A persistence schema isolation", () => {
  it("keeps migration order unique and the destructive rollback outside the forward chain", () => {
    const migrationRoot = path.resolve(process.cwd(), "supabase/migrations");
    const migrations = readdirSync(migrationRoot).filter((name) => name.endsWith(".sql"));
    expect(new Set(migrations).size).toBe(migrations.length);
    expect([...migrations].sort()).toEqual(migrations);
    expect(migrations).toContain("20260720100000_investing_engine_v1_persistence.sql");
    expect(migrations.indexOf("20260722090000_investing_engine_phase4b_r5_empty_state_transition_gate.sql")).toBeGreaterThan(
      migrations.indexOf("20260720100000_investing_engine_v1_persistence.sql"),
    );
    expect(existsSync(path.resolve(
      process.cwd(),
      "supabase/rollbacks/20260720100000_investing_engine_v1_persistence.down.sql",
    ))).toBe(true);
    expect(existsSync(path.resolve(
      process.cwd(),
      "supabase/rollbacks/20260721120000_investing_engine_v1_authorization_shape_guard.down.sql",
    ))).toBe(true);
    expect(existsSync(path.resolve(
      process.cwd(),
      "supabase/rollbacks/20260721180000_investing_engine_phase4b_r2_root_sealing.down.sql",
    ))).toBe(true);
    expect(existsSync(path.resolve(
      process.cwd(),
      "supabase/rollbacks/20260721220000_investing_engine_phase4b_r3_boundary_hardening.down.sql",
    ))).toBe(true);
    expect(existsSync(path.resolve(
      process.cwd(),
      "supabase/rollbacks/20260721230000_investing_engine_phase4b_r4_final_conditions_closure.down.sql",
    ))).toBe(true);
    expect(existsSync(path.resolve(
      process.cwd(),
      "supabase/rollbacks/20260722090000_investing_engine_phase4b_r5_empty_state_transition_gate.down.sql",
    ))).toBe(true);
  });

  it("publishes the explicit complete R1 persistence vocabulary", () => {
    expect(INVESTING_ENGINE_PERSISTENCE_SCHEMA_VERSION).toBe("investing-engine-persistence/v2");
    expect(INVESTING_ENGINE_CANONICAL_PAYLOAD_MAX_BYTES).toBe(16_777_216);
    expect(INVESTING_ENGINE_PERSISTENCE_TABLES).toHaveLength(6);
    expect(INVESTING_ENGINE_ARTIFACT_TYPES_V1).toHaveLength(12);
    expect(INVESTING_ENGINE_PERSISTENCE_PHASES_V1).toEqual(["phase3c", "phase3d", "phase3e", "phase3f"]);
  });

  it("depends only on the canonical Investing account boundary", () => {
    const sql = readFileSync(MIGRATION, "utf8").toLowerCase();
    const referencedTables = [...sql.matchAll(/references\s+public\.([a-z0-9_]+)/gu)].map((match) => match[1]);
    expect(new Set(referencedTables)).toEqual(new Set(["investing_accounts", "investing_engine_runs"]));

    const forbiddenDataDependencies = [
      "portfolio_items",
      "portfolios",
      "daily_snapshots",
      "journal_entries",
      "investing_orders",
      "investing_fills",
      "investing_execution_queue",
      "investing_ledger_entries",
      "investing_reconciliation_runs",
      "trading_",
    ];
    for (const table of forbiddenDataDependencies) {
      expect(sql, `migration depends on ${table}`).not.toMatch(
        new RegExp(`(?:from|join|references|insert\\s+into|update|delete\\s+from)\\s+(?:public\\.)?${table}`, "u"),
      );
    }
  });

  it("contains no runtime adapter or operational caller", () => {
    const roots = ["app", "components", "scripts", "lib"]
      .map((entry) => path.resolve(process.cwd(), entry))
      .filter(existsSync);
    const consumers = roots.flatMap(sourceFiles).filter((file) => {
      if (file.startsWith(PERSISTENCE_ROOT)) return false;
      return readFileSync(file, "utf8").includes("investing/engine/v1/persistence");
    });
    expect(consumers).toEqual([]);
  });

  it("does not import or mutate a frozen phase implementation", () => {
    for (const file of sourceFiles(PERSISTENCE_ROOT)) {
      expect(readFileSync(file, "utf8")).not.toMatch(/(?:from|import\()\s*["'][^"']*\/phase3[abcdef]/iu);
    }
  });
});
