import test from "node:test";
import assert from "node:assert/strict";
import { AutonomousWorker } from "../autonomousWorker";

test("worker stops cleanly and emits redacted operational events", async () => {
  const events: string[] = [];
  const worker = new AutonomousWorker({ workerId: "test-worker", clientFactory: async () => ({ connect: async () => {}, end: async () => {} } as never), provider: async () => { throw new Error("provider secret should not be logged"); }, exchangeTimezone: "UTC", maxTasks: 1, onEvent: event => events.push(JSON.stringify(event)) });
  const stats = await worker.run();
  assert.equal(stats.failed, 1);
  assert.ok(events.every(event => !event.includes("secret")));
});

test("stop is observable before another polling cycle", async () => {
  const worker = new AutonomousWorker({ workerId: "stop-worker", clientFactory: async () => ({ connect: async () => {}, end: async () => {}, query: async () => ({ rows: [] }) } as never), provider: async () => ({}), exchangeTimezone: "UTC", maxTasks: 2 });
  worker.stop();
  const stats = await worker.run();
  assert.equal(stats.stopped, true);
});
