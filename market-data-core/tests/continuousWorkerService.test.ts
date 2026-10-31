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

test("heartbeat errors are allowlisted and throwing callbacks are contained", async () => {
  let heartbeatCalls = 0;
  const service = new ContinuousWorkerService({
    workerId: "service-secret", instanceId: "instance-service-secret", capabilityToken: "z".repeat(64),
    clientFactory: async () => client(async sql => {
      if (sql.includes("record_worker_heartbeat")) { heartbeatCalls++; if (heartbeatCalls > 1) throw new Error("api_key=secret-value leaked"); return { rows: [{ record_worker_heartbeat: true }] }; }
      return { rows: [] };
    }), provider: async () => ({}), exchangeTimezone: "UTC", consumedCredits: "1",
    heartbeatIntervalMs: 5, pollIntervalMs: 10, maxTasks: 1, maxPolls: 10, onEvent: () => { throw new Error("callback-secret"); },
  });
  const pending = service.start();
  await new Promise(resolve => setTimeout(resolve, 40));
  service.stop();
  await pending;
  assert.ok(heartbeatCalls >= 1);
  assert.equal(service.heartbeatError, "WORKER_FAILURE");
});

test("shutdown stops a long idle poll without waiting for its configured interval", async () => {
  const service = new ContinuousWorkerService({
    workerId: "service-shutdown", instanceId: "instance-service-shutdown", capabilityToken: "q".repeat(64),
    clientFactory: async () => client(async () => ({ rows: [] })), provider: async () => ({}), exchangeTimezone: "UTC",
    consumedCredits: "1", pollIntervalMs: 60_000, maxTasks: 2, maxPolls: 2,
  });
  const pending = service.start();
  await new Promise(resolve => setTimeout(resolve, 20));
  const started = Date.now();
  await service.shutdown();
  assert.ok(Date.now() - started < 1000);
  assert.equal((await pending).stopped, true);
});

test("failed worker initialization leaves no timer or signal handlers behind", async () => {
  const beforeInt = process.listenerCount("SIGINT");
  const beforeTerm = process.listenerCount("SIGTERM");
  const service = new ContinuousWorkerService({
    workerId: "invalid worker", instanceId: "instance-init-failure", capabilityToken: "r".repeat(64),
    clientFactory: async () => { throw new Error("must not connect"); }, provider: async () => ({}),
    exchangeTimezone: "UTC", consumedCredits: "1", heartbeatIntervalMs: 5, maxTasks: 1, maxPolls: 1,
  });
  await assert.rejects(service.start(), /INVALID_WORKER_IDENTITY/);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(process.listenerCount("SIGINT"), beforeInt);
  assert.equal(process.listenerCount("SIGTERM"), beforeTerm);
});

test("heartbeat ticks are single-flight and drain during stop", async () => {
  let active = 0;
  let maximum = 0;
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const service = new ContinuousWorkerService({
    workerId: "single-flight", instanceId: "instance-single-flight", capabilityToken: "s".repeat(64),
    clientFactory: async () => client(async sql => {
      if (sql.includes("record_worker_heartbeat")) { active++; maximum = Math.max(maximum, active); await blocked; active--; return { rows: [{ record_worker_heartbeat: true }] }; }
      return { rows: [] };
    }), provider: async () => ({}), exchangeTimezone: "UTC", consumedCredits: "1",
    heartbeatIntervalMs: 5, pollIntervalMs: 10, maxTasks: 1, maxPolls: 20,
  });
  const running = service.start();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(maximum, 1);
  const shutdown = service.shutdown();
  release();
  await shutdown;
  await running;
});
