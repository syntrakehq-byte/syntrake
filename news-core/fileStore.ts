import { open, mkdir, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { NewsBatch, NewsCheckpoint, NewsPublication, NewsProviderObservation } from "./contracts";
import { assertNewsCheckpoint, assertNewsObservation, assertNewsPublication } from "./contracts";

type State = { publications: NewsPublication[]; observations: NewsProviderObservation[]; checkpoints: NewsCheckpoint[] };
const EMPTY: State = { publications: [], observations: [], checkpoints: [] };
const locks = new Map<string, Promise<void>>();

async function atomicWrite(path: string, value: State): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${path.split(/[\\/]/).pop()}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  const handle = await open(temp, "w");
  try { await handle.writeFile(JSON.stringify(value, null, 2), "utf8"); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, path);
  try { const directory = await open(dirname(path), "r"); try { await directory.sync(); } finally { await directory.close(); } } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM" && (error as NodeJS.ErrnoException).code !== "EINVAL") throw error;
  }
}

async function exclusive<T>(path: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(path) ?? Promise.resolve(); let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; }); const queued = previous.then(() => current); locks.set(path, queued); await previous;
  try { return await work(); } finally { release(); if (locks.get(path) === queued) locks.delete(path); }
}

async function readState(path: string, allowPending: boolean): Promise<State> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as State;
    parsed.publications.forEach(item => { assertNewsPublication(item); if (!allowPending && (item.ingestedAt === null || item.asKnownAt === null)) throw new Error("UNCOMMITTED_NEWS_STATE"); });
    parsed.observations.forEach(assertNewsObservation); parsed.checkpoints.forEach(assertNewsCheckpoint);
    const publicationIds = new Set(parsed.publications.map(item => item.publicationId));
    if (parsed.observations.some(item => !publicationIds.has(item.publicationId))) throw new Error("INVALID_NEWS_REFERENTIAL_INTEGRITY");
    return parsed;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY); throw error; }
}

export class FileNewsStore {
  private readonly stagingPath: string;
  constructor(private readonly path: string, private readonly failure: "none" | "before-staging" | "after-staging" = "none") { this.stagingPath = `${path}.staging`; }

  /** Public readers see only the committed main file; staging is never part of this read path. */
  async read(): Promise<State> { return readState(this.path, false); }

  private async recoverStaging(): Promise<void> {
    try {
      const candidate = JSON.parse(await readFile(this.stagingPath, "utf8")) as State;
      candidate.publications.forEach(assertNewsPublication); candidate.observations.forEach(assertNewsObservation); candidate.checkpoints.forEach(assertNewsCheckpoint);
      const committedAt = new Date().toISOString();
      const finalized: State = { publications: candidate.publications.map(item => item.ingestedAt === null || item.asKnownAt === null ? { ...item, ingestedAt: committedAt, asKnownAt: committedAt } : item), observations: candidate.observations, checkpoints: candidate.checkpoints.map(item => ({ ...item, updatedAt: committedAt })) };
      await atomicWrite(this.path, finalized); await unlink(this.stagingPath);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }

  async commit(batch: NewsBatch): Promise<{ insertedPublications: number; insertedObservations: number }> {
    return await exclusive(this.path, async () => {
      await this.recoverStaging();
      const state = await this.read(), publications = new Map(state.publications.map(item => [item.originFingerprint, item])), observations = new Map(state.observations.map(item => [item.providerObservationKey, item]));
      let insertedPublications = 0, insertedObservations = 0;
      for (const publication of batch.publications) { assertNewsPublication(publication); if (!publications.has(publication.originFingerprint)) { publications.set(publication.originFingerprint, publication); insertedPublications++; } }
      for (const observation of batch.observations) { assertNewsObservation(observation); if (!observations.has(observation.providerObservationKey)) { observations.set(observation.providerObservationKey, observation); insertedObservations++; } }
      assertNewsCheckpoint(batch.checkpoint);
      const previous = state.checkpoints.filter(item => item.collectionScopeKey !== batch.checkpoint.collectionScopeKey);
      const candidate: State = { publications: [...publications.values()], observations: [...observations.values()], checkpoints: [...previous, batch.checkpoint] };
      if (this.failure === "before-staging") throw new Error("INJECTED_PRE_COMMIT_FAILURE");
      await atomicWrite(this.stagingPath, candidate);
      if (this.failure === "after-staging") throw new Error("INJECTED_POST_STAGING_FAILURE");
      const committedAt = new Date().toISOString();
      const finalized: State = { publications: candidate.publications.map(item => item.ingestedAt === null || item.asKnownAt === null ? { ...item, ingestedAt: committedAt, asKnownAt: committedAt } : item), observations: candidate.observations, checkpoints: candidate.checkpoints.map(item => ({ ...item, updatedAt: committedAt })) };
      await atomicWrite(this.path, finalized); await unlink(this.stagingPath);
      return { insertedPublications, insertedObservations };
    });
  }

  async checkpoint(collectionScopeKey: string): Promise<NewsCheckpoint | null> { return (await this.read()).checkpoints.find(item => item.collectionScopeKey === collectionScopeKey) ?? null; }
}
