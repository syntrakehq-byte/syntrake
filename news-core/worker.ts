import { fetchSecFilings } from "./secAdapter";
import { FileNewsStore } from "./fileStore";

export async function runSecPoll(options: Readonly<{ store: FileNewsStore; cik: string; userAgent: string; now?: Date; fetchImpl?: typeof fetch }>): Promise<{ ingested: number; checkpoint: string | null }> {
  const current = await options.store.checkpoint("sec-edgar");
  const result = await fetchSecFilings({ cik: options.cik, userAgent: options.userAgent, now: options.now, fetchImpl: options.fetchImpl, cursor: current?.cursor });
  const updatedAt = (options.now ?? new Date()).toISOString();
  await options.store.commit({ publications: result.publications, observations: result.observations, checkpoint: { sourceId: "sec-edgar", cursor: result.nextCursor, updatedAt } });
  return { ingested: result.publications.length, checkpoint: result.nextCursor };
}

if (process.argv[1]?.endsWith("news-poll.ts")) {
  const file = process.env.NEWS_STORE_PATH ?? ".local/news-store.json";
  const cik = process.env.SEC_CIK ?? "0000320193";
  const userAgent = process.env.SEC_USER_AGENT;
  if (!userAgent) throw new Error("SEC_USER_AGENT is required; identify the application and operator");
  runSecPoll({ store: new FileNewsStore(file), cik, userAgent }).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error instanceof Error ? error.message : "NEWS_POLL_FAILED"); process.exitCode = 1; });
}
