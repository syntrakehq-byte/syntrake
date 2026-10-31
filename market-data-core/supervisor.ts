import type { Client } from "pg";
export type SupervisorSnapshot = Readonly<{ workerId: string; instanceId: string; active: boolean; leases: number; pending: number; fetching: number; uncertain: number }>;
export async function heartbeat(db: Client, workerId: string, instanceId: string, capabilityToken: string): Promise<boolean> {
  const result = await db.query<{ record_worker_heartbeat: boolean }>("SELECT market_core.record_worker_heartbeat($1,$2,$3) AS record_worker_heartbeat", [workerId, instanceId, capabilityToken]);
  return result.rows[0]?.record_worker_heartbeat === true;
}
export async function inspect(db: Client, staleAfter = "2 minutes"): Promise<SupervisorSnapshot[]> {
  const result = await db.query<{ worker_id: string; instance_id: string; worker_active: boolean; lease_count: string; pending_count: string; fetching_count: string; uncertain_count: string }>("SELECT * FROM market_core.supervisor_snapshot($1::interval)", [staleAfter]);
  return result.rows.map(row => ({ workerId: row.worker_id, instanceId: row.instance_id, active: row.worker_active, leases: Number(row.lease_count), pending: Number(row.pending_count), fetching: Number(row.fetching_count), uncertain: Number(row.uncertain_count) }));
}
export async function recoverExpired(db: Client): Promise<number> {
  const result = await db.query<{ supervisor_recover_expired: number }>("SELECT market_core.supervisor_recover_expired() AS supervisor_recover_expired");
  return Number(result.rows[0]?.supervisor_recover_expired ?? 0);
}
