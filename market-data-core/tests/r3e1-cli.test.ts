import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

test("R3-E1 CLI under Node reaches the closed gate without transform failure", () => {
  const tsx = resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
  const script = resolve(process.cwd(), "scripts/twelve-data-real-once.ts");
  const env = { ...process.env };
  for (const key of ["SYNTRAKE_TWELVE_DATA_API_KEY", "SYNTRAKE_R3E1_REAL_CALL_ENABLED", "SYNTRAKE_R3E1_APPROVED_SHA", "SYNTRAKE_R3E1_APPROVED_ENV", "VERCEL_ENV"]) delete env[key];
  const result = spawnSync(process.execPath, [tsx, script], { cwd: process.cwd(), env, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /DISABLED/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Top-level await|ERR_REQUIRE_ASYNC_MODULE/);
});
