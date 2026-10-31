import test from "node:test";
import assert from "node:assert/strict";
import { AutonomousWorker, safeError } from "../autonomousWorker";

test("worker stops cleanly and emits redacted operational events", async () => {
  const events: string[] = [];
  const worker = new AutonomousWorker({ workerId: "test-worker", clientFactory: async () => ({ connect: async () => { throw new Error("postgres://secret"); }, end: async () => {} } as never), provider: async () => { throw new Error("provider secret should not be logged"); }, exchangeTimezone: "UTC", maxTasks: 1, consumedCredits: "1", onEvent: event => events.push(JSON.stringify(event)) });
  const stats = await worker.run();
  assert.equal(stats.failed, 1);
  assert.ok(events.every(event => !event.includes("secret")));
  assert.equal(safeError(new Error("OFFLINE_private_api_key_ABC123")), "WORKER_FAILURE");
});

test("stop is observable before another polling cycle", async () => {
  const worker = new AutonomousWorker({ workerId: "stop-worker", clientFactory: async () => ({ connect: async () => {}, end: async () => {}, query: async () => ({ rows: [] }) } as never), provider: async () => ({}), exchangeTimezone: "UTC", maxTasks: 2, consumedCredits: "1" });
  worker.stop();
  const stats = await worker.run();
  assert.equal(stats.stopped, true);
});

test("bounded idle polling checks again instead of exiting on the first empty queue", async () => {
  let sessions = 0;
  const events: string[] = [];
  const worker = new AutonomousWorker({ workerId: "idle-worker", clientFactory: async () => { sessions++; return { connect: async () => {}, end: async () => {}, query: async () => ({ rows: [] }) } as never; }, provider: async () => ({}), exchangeTimezone: "UTC", pollIntervalMs: 1, maxTasks: 1, maxPolls: 2, consumedCredits: "1", onEvent: event => events.push(event.kind) });
  const stats = await worker.run();
  assert.equal(sessions, 2);
  assert.equal(stats.noWork, 2);
  assert.deepEqual(events.filter(event => event === "NO_WORK").length, 2);
});

test("stop wakes an active idle poll immediately", async () => {
  const worker = new AutonomousWorker({ workerId: "wake-worker", clientFactory: async () => ({ connect: async () => {}, end: async () => {}, query: async () => ({ rows: [] }) } as never), provider: async () => ({}), exchangeTimezone: "UTC", pollIntervalMs: 10000, maxPolls: 5, consumedCredits: "1" });
  const pending = worker.run();
  await new Promise(resolve => setTimeout(resolve, 20));
  const started = Date.now(); worker.stop(); const stats = await pending;
  assert.ok(Date.now() - started < 1000); assert.equal(stats.stopped, true);
});
