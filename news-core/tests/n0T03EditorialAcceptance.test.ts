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
  const publishers = new Set<string>();
  for (const source of manifest.sourceMetadata) {
    if (!/^https:\/\//.test(source.url) || !source.publisher || !source.author || !Number.isFinite(Date.parse(source.publishedAt)) || !source.provenanceRef) throw new Error("N0_T03_SOURCE_METADATA_INCOMPLETE");
    if (urls.has(source.url)) throw new Error("N0_T03_DUPLICATE_URL");
    urls.add(source.url);
    publishers.add(source.publisher);
  }
  if (publishers.size < 25) throw new Error("N0_T03_REQUIRES_25_DISTINCT_PUBLISHERS");
  if (manifest.sourceMetadata.some(source => source.editorialDependency === "UNKNOWN")) throw new Error("N0_T03_EDITORIAL_DEPENDENCY_UNKNOWN");
}

test("N0-T03: 25-source editorial acceptance requires a verified real manifest", { skip: !manifestPath && "N0_T03_MANIFEST is required; no sources are fabricated" }, async () => {
  const manifest = await loadManifest();
  validateManifest(manifest);
  assert.equal(manifest.input.claimKey, claimKeyV1(manifest.proposal));
  assert.equal(manifest.input.origins.length, 25);
  assert.equal(manifest.input.independence.length, (25 * 24) / 2);
  const result = new DeterministicEvidenceCorroboratorV1().evaluate(manifest.input);
  assert.equal(result.confirmationStatus, "CORROBORATED");
  assert.equal(result.independence, "PROVEN_INDEPENDENT");
  assert.equal(result.countedEditorialGroups.length, 25);
});
