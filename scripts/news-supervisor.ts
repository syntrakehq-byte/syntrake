import { spawn, type ChildProcess } from "node:child_process";

const root = process.cwd();
const workerArgs = ["node_modules/tsx/dist/cli.mjs", "scripts/news-postgres-worker.ts"];
let stopping = false;
let child: ChildProcess | undefined;
let childExited = true;
let restartCount = 0;
let restartTimer: NodeJS.Timeout | undefined;

const stop = (reason: string) => {
  if (stopping) return;
  stopping = true;
  if (restartTimer) clearTimeout(restartTimer);
  console.log(`NEWS_SUPERVISOR_STOP reason=${reason} restarts=${restartCount}`);
  const target = child;
  if (!target || childExited) { process.exit(0); return; }
  target.kill("SIGTERM");
  setTimeout(() => { if (!childExited && child === target) target.kill("SIGKILL"); }, Number(process.env.NEWS_SUPERVISOR_STOP_TIMEOUT_MS ?? 10_000)).unref();
};

const start = () => {
  if (stopping) return;
  child = spawn(process.execPath, workerArgs, { cwd: root, env: process.env, stdio: "inherit" });
  childExited = false;
  const pid = child.pid ?? -1;
  console.log(`NEWS_SUPERVISOR_STARTED pid=${pid} restart=${restartCount}`);
  child.once("exit", (code, signal) => {
    childExited = true;
    console.log(`NEWS_SUPERVISOR_EXIT pid=${pid} code=${code ?? "null"} signal=${signal ?? "null"}`);
    child = undefined;
    if (stopping) { process.exit(0); return; }
    restartCount += 1;
    const delay = Math.min(30_000, 250 * 2 ** Math.min(restartCount - 1, 7));
    console.log(`NEWS_SUPERVISOR_RESTART_IN_MS delay=${delay}`);
    restartTimer = setTimeout(start, delay);
  });
};

process.once("SIGTERM", () => stop("SIGTERM"));
process.once("SIGINT", () => stop("SIGINT"));
start();
