import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DeterministicEvidenceCorroboratorV1, claimKeyV1, type CorroborationInputV1 } from "../evidenceCorroboration";
import type { ClassificationProposalV1 } from "../factualClassification";

type T03Manifest = Readonly<{
  eventId: string;
  cutoffAsKnownAt: string;
  proposal: ClassificationProposalV1;
  input: CorroborationInputV1;
  sourceMetadata: readonly Readonly<{
    publicationId: string;
    eventId: string;
    url: string;
    publisher: string;
    author: string;
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
  if (!manifest.eventId || !manifest.cutoffAsKnownAt || manifest.sourceMetadata.length !== 25) throw new Error("N0_T03_REQUIRES_EXACTLY_25_SOURCES");
  const urls = new Set<string>();
  const publicationIds = new Set<string>();
  for (const source of manifest.sourceMetadata) {
    if (source.eventId !== manifest.eventId || !source.publicationId || !/^https:\/\//.test(source.url) || !source.publisher || !source.author || !Number.isFinite(Date.parse(source.publishedAt)) || !source.provenanceRef) throw new Error("N0_T03_SOURCE_METADATA_INCOMPLETE");
    if (urls.has(source.url)) throw new Error("N0_T03_DUPLICATE_URL");
    if (publicationIds.has(source.publicationId)) throw new Error("N0_T03_DUPLICATE_PUBLICATION");
    urls.add(source.url);
    publicationIds.add(source.publicationId);
  }
}

test("N0-T03: 25-source editorial acceptance requires a verified real manifest", { skip: !manifestPath && "N0_T03_MANIFEST is required; no sources are fabricated" }, async () => {
  const manifest = await loadManifest();
  validateManifest(manifest);
  assert.equal(manifest.input.claimKey, claimKeyV1(manifest.proposal));
  assert.equal(manifest.input.origins.length, 25);
  const result = new DeterministicEvidenceCorroboratorV1().evaluate(manifest.input);
  assert.equal(result.supportingOriginIds.length, 25);
  assert.notEqual(result.confirmationStatus, "CORROBORATED", "T03 does not promote 25 publications to independent corroboration without T10 evidence");
});
