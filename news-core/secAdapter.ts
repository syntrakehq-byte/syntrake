import { createHash } from "node:crypto";
import type { NewsPublication, NewsProviderObservation } from "./contracts";

const SEC_SOURCE_ID = "sec-edgar";
const SEC_PROVIDER = "sec";
const FORMS = new Set(["10-K", "10-Q", "8-K", "20-F", "6-K"]);

type SecPayload = { name?: unknown; cik?: unknown; filings?: { recent?: Record<string, unknown> } };
type SecResult = { publications: NewsPublication[]; observations: NewsProviderObservation[]; nextCursor: string | null };

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`INVALID_SEC_RESPONSE:${field}`);
  return value;
}
function isoDate(value: unknown): string {
  const raw = text(value, "date");
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) throw new Error("INVALID_SEC_RESPONSE:date");
  return parsed.toISOString();
}

export async function fetchSecFilings(options: Readonly<{ cik: string; userAgent: string; now?: Date; fetchImpl?: typeof fetch; cursor?: string | null }>): Promise<SecResult> {
  if (!/^\d{10}$/.test(options.cik) || !options.userAgent.trim()) throw new Error("INVALID_SEC_CONFIG");
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`https://data.sec.gov/submissions/CIK${options.cik}.json`, {
    headers: { "User-Agent": options.userAgent, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`SEC_UNAVAILABLE:${response.status}`);
  let payload: SecPayload;
  try { payload = await response.json() as SecPayload; } catch { throw new Error("INVALID_SEC_RESPONSE:json"); }
  const recent = payload.filings?.recent;
  if (!recent || !Array.isArray(recent.form) || !Array.isArray(recent.accessionNumber) || !Array.isArray(recent.filingDate) || !Array.isArray(recent.primaryDocument) || !Array.isArray(recent.primaryDocDescription)) throw new Error("INVALID_SEC_RESPONSE:recent");
  const now = options.now ?? new Date();
  if (Number.isNaN(now.valueOf())) throw new Error("INVALID_SEC_CONFIG");
  const forms = recent.form as unknown[];
  const accessions = recent.accessionNumber as unknown[];
  const filingDates = recent.filingDate as unknown[];
  const documents = recent.primaryDocument as unknown[];
  const descriptions = recent.primaryDocDescription as unknown[];
  const publications: NewsPublication[] = [], observations: NewsProviderObservation[] = [];
  let nextCursor = options.cursor ?? null;
  for (let i = 0; i < recent.form.length; i++) {
    const form = text(forms[i], "form");
    const accession = text(accessions[i], "accession");
    const filingDate = isoDate(filingDates[i]);
    const document = text(documents[i], "document");
    const descriptionValue = descriptions[i];
    const description = typeof descriptionValue === "string" && descriptionValue.length > 0 ? descriptionValue : `${form} filing`;
    const key = `${filingDate.slice(0, 10)}:${accession}`;
    if (!nextCursor || key > nextCursor) nextCursor = key;
    if (!FORMS.has(form) || (options.cursor && key <= options.cursor)) continue;
    const cik = options.cik.replace(/^0+/, "") || "0";
    const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replaceAll("-", "")}/${document}`;
    const originFingerprint = `${SEC_PROVIDER}:${accession}:${document}`;
    const publicationId = createHash("sha256").update(originFingerprint).digest("hex").slice(0, 32);
    const observedAt = now.toISOString();
    const publication: NewsPublication = { publicationId, sourceId: SEC_SOURCE_ID, originFingerprint, externalId: accession, originalUrl: url, title: description, publishedAt: filingDate, firstSeenAt: observedAt, ingestedAt: observedAt, asKnownAt: observedAt, form };
    publications.push(publication);
    observations.push({ observationId: createHash("sha256").update(`${SEC_PROVIDER}:${accession}`).digest("hex").slice(0, 32), providerKey: SEC_PROVIDER, providerObservationKey: accession, publicationId, observedAt, retrievedAt: observedAt, publisherKey: "sec-edgar" });
  }
  return { publications, observations, nextCursor };
}
