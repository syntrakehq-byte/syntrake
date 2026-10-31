import test from "node:test";
import assert from "node:assert/strict";
import { ContinuousWorkerService } from "../continuousWorkerService";

function client(query: (sql: string) => Promise<unknown>) {
  return { connect: async () => {}, query, end: async () => {} } as never;
}

test("service keeps bounded lifecycle and stops the reused AutonomousWorker", async () => {
  let sessions = 0;
  const service = new ContinuousWorkerService({
    workerId: "service-test", instanceId: "instance-service-test", capabilityToken: "x".repeat(64),
    clientFactory: async () => { sessions++; return client(async sql => sql.includes("record_worker_heartbeat") ? { rows: [{ record_worker_heartbeat: true }] } : { rows: [] }); },
    provider: async () => ({}), exchangeTimezone: "UTC", consumedCredits: "1", pollIntervalMs: 10,
    heartbeatIntervalMs: 5, maxTasks: 5, maxPolls: 100,
  });
  const running = service.start();
  await new Promise(resolve => setTimeout(resolve, 20));
  service.stop();
  const stats = await running;
  assert.equal(stats.stopped, true);
  assert.ok(sessions >= 1);
  assert.equal(service.isRunning, false);
});

test("service rejects a second start and removes signal handlers on shutdown", async () => {
  const service = new ContinuousWorkerService({
    workerId: "service-second", instanceId: "instance-service-second", capabilityToken: "y".repeat(64),
    clientFactory: async () => client(async () => ({ rows: [] })), provider: async () => ({}),
    exchangeTimezone: "UTC", consumedCredits: "1", maxTasks: 1, maxPolls: 1,
  });
  const running = service.start();
  await assert.rejects(service.start(), /WORKER_ALREADY_RUNNING/);
  service.installSignalHandlers();
  service.stop();
  await running;
  await service.shutdown();
  assert.equal(service.isRunning, false);
});
