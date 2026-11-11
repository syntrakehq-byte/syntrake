import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { NewsBatch, NewsCheckpoint, NewsPublication, NewsProviderObservation } from "./contracts";
import { assertNewsPublication } from "./contracts";

type State = { publications: NewsPublication[]; observations: NewsProviderObservation[]; checkpoints: NewsCheckpoint[] };
const EMPTY: State = { publications: [], observations: [], checkpoints: [] };

export class FileNewsStore {
  constructor(private readonly path: string, private readonly failBeforeCommit = false) {}
  async read(): Promise<State> {
    try { const parsed = JSON.parse(await readFile(this.path, "utf8")) as State; parsed.publications.forEach(assertNewsPublication); return parsed; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY); throw error; }
  }
  async commit(batch: NewsBatch): Promise<void> {
    const state = await this.read();
    const publications = new Map(state.publications.map(item => [item.originFingerprint, item]));
    const observations = new Map(state.observations.map(item => [item.providerObservationKey, item]));
    for (const publication of batch.publications) { assertNewsPublication(publication); if (!publications.has(publication.originFingerprint)) publications.set(publication.originFingerprint, publication); }
    for (const observation of batch.observations) if (!observations.has(observation.providerObservationKey)) observations.set(observation.providerObservationKey, observation);
    const checkpoints = state.checkpoints.filter(item => item.sourceId !== batch.checkpoint.sourceId); checkpoints.push(batch.checkpoint);
    const next: State = { publications: [...publications.values()], observations: [...observations.values()], checkpoints };
    if (this.failBeforeCommit) throw new Error("INJECTED_PRE_COMMIT_FAILURE");
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp-${process.pid}`;
    await writeFile(temporary, JSON.stringify(next, null, 2), { encoding: "utf8" });
    await rename(temporary, this.path);
  }
  async checkpoint(sourceId: string): Promise<NewsCheckpoint | null> { return (await this.read()).checkpoints.find(item => item.sourceId === sourceId) ?? null; }
}
