import { open, mkdir, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { NewsBatch, NewsCheckpoint, NewsPublication, NewsProviderObservation } from "./contracts";
import { assertNewsCheckpoint, assertNewsObservation, assertNewsPublication } from "./contracts";
type State = { publications: NewsPublication[]; observations: NewsProviderObservation[]; checkpoints: NewsCheckpoint[] };
const EMPTY: State = { publications: [], observations: [], checkpoints: [] };
const locks = new Map<string, Promise<void>>();
async function atomicWrite(path: string, value: State): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${path.split(/[\\/]/).pop()}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  const handle = await open(temp, "w"); try { await handle.writeFile(JSON.stringify(value, null, 2), "utf8"); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, path);
  try { const directory = await open(dirname(path), "r"); try { await directory.sync(); } finally { await directory.close(); } } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM" && (error as NodeJS.ErrnoException).code !== "EINVAL") throw error;
  }
}
async function exclusive<T>(path: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(path) ?? Promise.resolve(); let release!: () => void; const current = new Promise<void>(resolve => { release = resolve; }); const queued = previous.then(() => current); locks.set(path, queued); await previous;
  try { return await work(); } finally { release(); if (locks.get(path) === queued) locks.delete(path); }
}
export class FileNewsStore {
  constructor(private readonly path: string, private readonly failure: "none" | "before" | "after-durable" = "none") {}
  async read(): Promise<State> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as State;
      parsed.publications.forEach(assertNewsPublication); parsed.observations.forEach(assertNewsObservation); parsed.checkpoints.forEach(assertNewsCheckpoint);
      const publicationIds = new Set(parsed.publications.map(item => item.publicationId)); if (parsed.observations.some(item => !publicationIds.has(item.publicationId))) throw new Error("INVALID_NEWS_REFERENTIAL_INTEGRITY"); return parsed;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY); throw error; }
  }
  async commit(batch: NewsBatch): Promise<{ insertedPublications: number; insertedObservations: number }> {
    return await exclusive(this.path, async () => {
      const state = await this.read(), publications = new Map(state.publications.map(item => [item.originFingerprint, item])), observations = new Map(state.observations.map(item => [item.providerObservationKey, item]));
      let insertedPublications = 0, insertedObservations = 0;
      for (const publication of batch.publications) { assertNewsPublication(publication); if (!publications.has(publication.originFingerprint)) { publications.set(publication.originFingerprint, publication); insertedPublications++; } }
      for (const observation of batch.observations) { assertNewsObservation(observation); if (!observations.has(observation.providerObservationKey)) { observations.set(observation.providerObservationKey, observation); insertedObservations++; } }
      assertNewsCheckpoint(batch.checkpoint); const previousCheckpoint = state.checkpoints.filter(item => item.collectionScopeKey !== batch.checkpoint.collectionScopeKey);
      const prepared: State = { publications: [...publications.values()], observations: [...observations.values()], checkpoints: previousCheckpoint };
      if (this.failure === "before") throw new Error("INJECTED_PRE_COMMIT_FAILURE"); await atomicWrite(this.path, prepared);
      const committedAt = new Date().toISOString(), finalized = prepared.publications.map(item => item.ingestedAt === null || item.asKnownAt === null ? { ...item, ingestedAt: committedAt, asKnownAt: committedAt } : item);
      if (this.failure === "after-durable") throw new Error("INJECTED_POST_DURABLE_FAILURE"); await atomicWrite(this.path, { publications: finalized, observations: prepared.observations, checkpoints: [...previousCheckpoint, { ...batch.checkpoint, updatedAt: committedAt }] });
      return { insertedPublications, insertedObservations };
    });
  }
  async checkpoint(collectionScopeKey: string): Promise<NewsCheckpoint | null> { return (await this.read()).checkpoints.find(item => item.collectionScopeKey === collectionScopeKey) ?? null; }
}
