import { createHash } from "node:crypto";
import type { NewsPublication, NewsProviderObservation } from "./contracts";
import { fetchSafeExternal } from "./sourceSecurity";
const SEC_SOURCE_ID = "sec-edgar", SEC_PROVIDER = "sec", FORMS = new Set(["10-K", "10-Q", "8-K", "20-F", "6-K"]), MAX_ROWS = 10_000;
const ACCESSION = /^\d{10}-\d{2}-\d{6}$/, DOCUMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,255})*$/;
type SecPayload = { cik?: unknown; filings?: { recent?: Record<string, unknown> } };
export type SecCursor = Readonly<{ watermark: string; overlapDays: number }>;
export type SecResult = { publications: NewsPublication[]; observations: NewsProviderObservation[]; nextCursor: string | null };
function text(value: unknown, field: string): string { if (typeof value !== "string" || value.length === 0 || value.length > 512) throw new Error(`INVALID_SEC_RESPONSE:${field}`); return value; }
function strictDate(value: unknown): string {
  const raw = text(value, "date"); if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error("INVALID_SEC_RESPONSE:date");
  const [year, month, day] = raw.split("-").map(Number), parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new Error("INVALID_SEC_RESPONSE:date");
  return parsed.toISOString();
}
function parseCursor(value: string | null | undefined): SecCursor | null {
  if (!value) return null; try { const parsed = JSON.parse(value) as SecCursor; if (typeof parsed.watermark !== "string" || !/^\d{4}-\d{2}-\d{2}:\d{10}-\d{2}-\d{6}$/.test(parsed.watermark) || parsed.overlapDays !== 7) throw new Error(); return parsed; } catch { throw new Error("INVALID_SEC_CURSOR"); }
}
export function secCollectionScopeKey(cik: string): string { return `sec-edgar|sec|cik=${cik}|forms=10-K,10-Q,8-K,20-F,6-K|overlap=7|v=2`; }
export async function fetchSecFilings(options: Readonly<{ cik: string; userAgent: string; now?: Date; fetchImpl?: typeof fetch; cursor?: string | null; signal?: AbortSignal }>): Promise<SecResult> {
  if (!/^\d{10}$/.test(options.cik) || !options.userAgent.trim()) throw new Error("INVALID_SEC_CONFIG");
  const previous = parseCursor(options.cursor), sourceUrl = `https://data.sec.gov/submissions/CIK${options.cik}.json`, response = options.fetchImpl
    ? await options.fetchImpl(sourceUrl, { headers: { "User-Agent": options.userAgent, Accept: "application/json" }, signal: options.signal })
    : await fetchSafeExternal(sourceUrl, { headers: { "User-Agent": options.userAgent, Accept: "application/json" }, signal: options.signal });
  if (!response.ok) throw new Error(`SEC_UNAVAILABLE:${response.status}`);
  let payload: SecPayload; try { payload = await response.json() as SecPayload; } catch { throw new Error("INVALID_SEC_RESPONSE:json"); }
  if (payload.cik !== options.cik) throw new Error("INVALID_SEC_RESPONSE:cik");
  const recent = payload.filings?.recent;
  if (!recent || !Array.isArray(recent.form) || !Array.isArray(recent.accessionNumber) || !Array.isArray(recent.filingDate) || !Array.isArray(recent.primaryDocument) || !Array.isArray(recent.primaryDocDescription)) throw new Error("INVALID_SEC_RESPONSE:recent");
  const forms = recent.form as unknown[], accessions = recent.accessionNumber as unknown[], dates = recent.filingDate as unknown[], documents = recent.primaryDocument as unknown[], descriptions = recent.primaryDocDescription as unknown[];
  if (forms.length > MAX_ROWS || new Set([forms.length, accessions.length, dates.length, documents.length, descriptions.length]).size !== 1) throw new Error("INVALID_SEC_RESPONSE:arrays");
  const now = options.now ?? new Date(); if (Number.isNaN(now.valueOf())) throw new Error("INVALID_SEC_CONFIG");
  const overlapStart = previous ? new Date(`${previous.watermark.slice(0, 10)}T00:00:00.000Z`) : null; if (overlapStart) overlapStart.setUTCDate(overlapStart.getUTCDate() - 7);
  const publications: NewsPublication[] = [], observations: NewsProviderObservation[] = []; let watermark = previous?.watermark ?? null;
  for (let i = 0; i < forms.length; i++) {
    const form = text(forms[i], "form"), accession = text(accessions[i], "accession"), date = strictDate(dates[i]), document = text(documents[i], "document");
    if (!ACCESSION.test(accession) || !DOCUMENT.test(document) || document.includes("..")) throw new Error("INVALID_SEC_RESPONSE:filing");
    const key = `${date.slice(0, 10)}:${accession}`; if (!watermark || key > watermark) watermark = key;
    if (!FORMS.has(form) || (overlapStart && Date.parse(date) < overlapStart.valueOf())) continue;
    const descriptionValue = descriptions[i], title = typeof descriptionValue === "string" && descriptionValue.length > 0 && descriptionValue.length <= 512 ? descriptionValue : `${form} filing`;
    const cik = options.cik.replace(/^0+/, "") || "0", url = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replaceAll("-", "")}/${document}`, originFingerprint = `${SEC_PROVIDER}:${options.cik}:${accession}:${document}`;
    const publicationId = createHash("sha256").update(originFingerprint).digest("hex").slice(0, 32), observedAt = now.toISOString();
    publications.push({ publicationId, sourceId: SEC_SOURCE_ID, originFingerprint, externalId: accession, originalUrl: url, title, publishedAt: null, firstSeenAt: observedAt, ingestedAt: null, asKnownAt: null, form });
    observations.push({ observationId: createHash("sha256").update(`${SEC_PROVIDER}:${options.cik}:${accession}`).digest("hex").slice(0, 32), providerKey: SEC_PROVIDER, providerObservationKey: `${options.cik}:${accession}`, publicationId, observedAt, retrievedAt: observedAt, publisherKey: "sec-edgar" });
  }
  return { publications, observations, nextCursor: watermark ? JSON.stringify({ watermark, overlapDays: 7 }) : options.cursor ?? null };
}
