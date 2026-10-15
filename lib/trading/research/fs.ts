import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ATOMIC_TEMP_STALE_MS = 60_000;

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortValue(nested)]),
    );
  }

  return value;
}

export async function ensureDirectory(targetPath: string): Promise<void> {
  await mkdir(targetPath, { recursive: true });
}

export async function readJsonFile<T>(targetPath: string): Promise<T> {
  return JSON.parse(await readFile(targetPath, "utf8")) as T;
}

export async function readJsonIfExists<T>(targetPath: string): Promise<T | null> {
  try {
    return await readJsonFile<T>(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeJsonAtomic(targetPath: string, value: unknown): Promise<void> {
  const maxAttempts = 6;
  const serialized = `${JSON.stringify(value, null, 2)}\n`;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await ensureDirectory(path.dirname(targetPath));
    await cleanupStaleAtomicTemps(targetPath);
    const tempPath = `${targetPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;

    try {
      await writeFile(tempPath, serialized, "utf8");
      await rename(tempPath, targetPath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const isLastAttempt = attempt === maxAttempts - 1;
      const retryable =
        code === "EBUSY" ||
        code === "EPERM" ||
        code === "EACCES" ||
        code === "ENOENT";

      await removeFileIfExists(tempPath);

      if (!retryable || isLastAttempt) {
        throw error;
      }

      if (code === "ENOENT") {
        await delay(25 * (attempt + 1));
        continue;
      }

      await delay(100 * (attempt + 1));
    }
  }
}

async function cleanupStaleAtomicTemps(targetPath: string): Promise<void> {
  const directory = path.dirname(targetPath);
  const prefix = `${path.basename(targetPath)}.`;
  const now = Date.now();

  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }

  await Promise.all(
    names.map(async (name) => {
      if (!name.startsWith(prefix) || !name.endsWith(".tmp")) {
        return;
      }

      const tempPath = path.join(directory, name);

      try {
        const details = await stat(tempPath);
        if (now - details.mtimeMs < ATOMIC_TEMP_STALE_MS) {
          return;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return;
        }
        throw error;
      }

      await removeFileIfExists(tempPath);
    }),
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export async function appendJsonLine(targetPath: string, value: unknown): Promise<void> {
  await ensureDirectory(path.dirname(targetPath));
  const line = `${JSON.stringify(value)}\n`;
  await writeFile(targetPath, line, { encoding: "utf8", flag: "a" });
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function sha256File(targetPath: string): Promise<string> {
  return sha256Text(await readFile(targetPath, "utf8"));
}

export function sha256Json(value: unknown): string {
  return sha256Text(stableStringify(value));
}

export async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function removeFileIfExists(targetPath: string): Promise<void> {
  try {
    await rm(targetPath, { force: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "EBUSY" && code !== "EPERM" && code !== "EACCES") {
      throw error;
    }
  }
}

export function sanitizeFileSegment(value: string): string {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/[ .]+$/g, "");
  return sanitized || "_";
}
