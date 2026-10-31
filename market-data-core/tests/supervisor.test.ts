import test from "node:test";
import assert from "node:assert/strict";
import { heartbeat, inspect } from "../supervisor";
test("supervisor maps server-backed heartbeat state without exposing tokens", async () => {
  const calls: unknown[][] = [];
  const db = { query: async (sql: string, params: unknown[]) => { calls.push([sql, params]); return sql.includes("heartbeat") ? { rows: [{ record_worker_heartbeat: true }] } : { rows: [{ worker_id: "w", instance_id: "i", worker_active: true, lease_count: "1", pending_count: "2", fetching_count: "0", uncertain_count: "0" }] }; } } as never;
  assert.equal(await heartbeat(db, "w", "i"), true);
  assert.deepEqual(await inspect(db), [{ workerId: "w", instanceId: "i", active: true, leases: 1, pending: 2, fetching: 0, uncertain: 0 }]);
  assert.ok(!JSON.stringify(calls).includes("token"));
});
