import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import test from "node:test";

type T03Manifest = Readonly<{
  eventId: string;
  eventFingerprint: string;
  groupingBasis: string;
  cutoffAsKnownAt: string;
  verification: Readonly<{ checkedAt: string; method: string; verifiedHttp200Count: number; non200Count: number }>;
  sourceMetadata: readonly Readonly<{
    publicationId: string;
    eventId: string;
    url: string;
    publisher: string;
    title: string;
    author: string | null;
    publishedAt: string;
    provenanceRef: string;
    editorialDependency: "INDEPENDENT" | "REPUBLICATION" | "UNKNOWN";
  }>[];
}>;

const manifestPath = process.env.N0_T03_MANIFEST;

async function loadManifest(): Promise<T03Manifest> {
  if (!manifestPath) throw new Error("N0_T03_MANIFEST_REQUIRED");
  return JSON.parse(await readFile(manifestPath, "utf8")) as T03Manifest;
}

function validateManifest(manifest: T03Manifest): void {
  if (!manifest.eventId || !manifest.eventFingerprint || !manifest.groupingBasis || !manifest.cutoffAsKnownAt || manifest.sourceMetadata.length !== 25) throw new Error("N0_T03_REQUIRES_EXACTLY_25_SOURCES_AND_GROUPING_PROOF");
  if (!manifest.verification || manifest.verification.verifiedHttp200Count !== 25 || manifest.verification.non200Count !== 0) throw new Error("N0_T03_URL_VERIFICATION_INCOMPLETE");
  const urls = new Set<string>();
  const publicationIds = new Set<string>();
  for (const source of manifest.sourceMetadata) {
    if (source.eventId !== manifest.eventId || !source.publicationId || !/^https:\/\//.test(source.url) || !source.publisher || !source.title || !Number.isFinite(Date.parse(source.publishedAt)) || !source.provenanceRef) throw new Error("N0_T03_SOURCE_METADATA_INCOMPLETE");
    if (urls.has(source.url)) throw new Error("N0_T03_DUPLICATE_URL");
    if (publicationIds.has(source.publicationId)) throw new Error("N0_T03_DUPLICATE_PUBLICATION");
    urls.add(source.url);
    publicationIds.add(source.publicationId);
  }
}

test("N0-T03: 25-source editorial acceptance requires a verified real manifest", { skip: !manifestPath && "N0_T03_MANIFEST is required; no sources are fabricated" }, async () => {
  const manifest = await loadManifest();
  validateManifest(manifest);
  assert.equal(new Set(manifest.sourceMetadata.map(source => source.eventId)).size, 1);
  assert.equal(new Set(manifest.sourceMetadata.map(source => source.publicationId)).size, 25);
  assert.ok(manifest.sourceMetadata.every(source => source.editorialDependency !== "INDEPENDENT" || source.provenanceRef.length > 0));
});
