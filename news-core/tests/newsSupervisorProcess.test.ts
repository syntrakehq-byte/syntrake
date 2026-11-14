import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

test("News supervisor restarts an exited child and stops cooperatively", async () => {
  const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/news-supervisor.ts"], {
    cwd: process.cwd(), env: { ...process.env, NEWS_SUPERVISOR_TEST_EXITING: "1", NEWS_SUPERVISOR_STOP_TIMEOUT_MS: "300" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let started = 0;
  const waitFor = (predicate: () => boolean, timeoutMs: number) => new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`SUPERVISOR_TIMEOUT output=${output}`)), timeoutMs);
    const timer = setInterval(() => { if (predicate()) { clearTimeout(deadline); clearInterval(timer); resolve(); } }, 50);
  });
  child.stdout.on("data", chunk => { output += String(chunk); started = (output.match(/NEWS_SUPERVISOR_STARTED/g) ?? []).length; });
  child.stderr.on("data", chunk => { output += String(chunk); });
  try {
    await waitFor(() => started >= 2, 15_000);
    child.kill("SIGTERM");
    const exit = await new Promise<{ code: number | null }>(resolve => child.once("close", code => resolve({ code })));
    assert.equal(exit.code, 0, output);
    assert.match(output, /NEWS_SUPERVISOR_EXIT/);
    assert.match(output, /NEWS_SUPERVISOR_STOP/);
  } finally {
    if (!child.killed) child.kill("SIGTERM");
  }
});

test("News supervisor escalates a non-cooperative child without leaving it orphaned", { skip: process.platform === "win32" && "POSIX SIGTERM/SIGKILL semantics required" }, async () => {
  const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/news-supervisor.ts"], {
    cwd: process.cwd(), env: { ...process.env, NEWS_SUPERVISOR_TEST_NONCOOPERATIVE: "1", NEWS_SUPERVISOR_STOP_TIMEOUT_MS: "300" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", chunk => { output += String(chunk); });
  child.stderr.on("data", chunk => { output += String(chunk); });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`SUPERVISOR_NONCOOPERATIVE_TIMEOUT output=${output}`)), 15_000);
    const check = setInterval(() => { if (/NEWS_SUPERVISOR_STARTED/.test(output)) { clearTimeout(timer); clearInterval(check); resolve(); } }, 50);
  });
  child.kill("SIGTERM");
  const exit = await new Promise<{ code: number | null }>(resolve => child.once("close", code => resolve({ code })));
  assert.equal(exit.code, 0, output);
  assert.match(output, /NEWS_SUPERVISOR_EXIT/);
});
