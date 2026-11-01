import { createHash } from "node:crypto";
import { requireCatalogLicense, type CatalogConnector } from "./catalogConnector";
import { resolveCanonicalIdentity, type CanonicalIdentity, type CanonicalResolution } from "./canonicalIdentityResolver";
import { normalizeCatalogQuery, type CatalogCandidate, type CatalogQuery, type CatalogSource } from "./instrumentDiscovery";

export type CatalogSqlClient = Readonly<{ query(text: string, values?: readonly unknown[]): Promise<{ rows: readonly Record<string, unknown>[] }> }>;
export type CatalogPersistence = Readonly<{
  persist(source: CatalogSource, candidate: CatalogCandidate): Promise<{ candidateId: string; state: "PERSISTED" | "LICENSE_BLOCKED" }>;
}>;
export type CatalogOnboardingInput = Readonly<{
  connector: CatalogConnector;
  query: CatalogQuery;
  source: CatalogSource;
  asOf: string;
  persistence: CatalogPersistence;
  loadRegistry(listingRefs: readonly string[]): Promise<readonly CanonicalIdentity[]>;
}>;
export type CatalogOnboardingResult = Readonly<{
  discovery: Awaited<ReturnType<CatalogConnector["search"]>>;
  persisted: readonly { candidateId: string; state: "PERSISTED" | "LICENSE_BLOCKED" }[];
  resolutions: readonly CanonicalResolution[];
}>;

function candidateId(source: CatalogSource, candidate: CatalogCandidate): string {
  const digest = createHash("sha256").update(`${source.snapshotId}|${candidate.providerReference.providerReference}|${candidate.providerReference.scope}|${candidate.listing?.mic ?? "NO_MIC"}`).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export function createPostgresCatalogPersistence(db: CatalogSqlClient, sourceId: string): CatalogPersistence {
  return {
    async persist(source, candidate) {
      requireCatalogLicense(source);
      const id = candidateId(source, candidate);
      await db.query(`INSERT INTO market_core.catalog_candidates
        (candidate_id,snapshot_id,provider_reference,provider_identifier_type,provider_scope,legal_name,asset_class,ticker,mic,mic_role,trading_currency,denomination_currency,valid_from,valid_to,review_state,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'REVIEW_REQUIRED',clock_timestamp())
        ON CONFLICT (snapshot_id,provider_reference,provider_scope) DO NOTHING`, [id, source.snapshotId, candidate.providerReference.providerReference, candidate.providerReference.identifierType, candidate.providerReference.scope, candidate.descriptiveName ?? null, candidate.descriptiveAssetClass ?? null, candidate.listing?.ticker ?? null, candidate.listing?.mic ?? null, candidate.listing?.micRole ?? null, candidate.listing?.tradingCurrency ?? null, candidate.instrument?.denominationCurrency ?? candidate.descriptiveCurrency ?? null, candidate.listing?.validity.validFrom ?? null, candidate.listing?.validity.validTo ?? null]);
      const row = (await db.query("SELECT candidate_id FROM market_core.catalog_candidates WHERE snapshot_id=$1 AND provider_reference=$2 AND provider_scope=$3 AND mic IS NOT DISTINCT FROM $4", [source.snapshotId, candidate.providerReference.providerReference, candidate.providerReference.scope, candidate.listing?.mic ?? null])).rows[0];
      const persistedId = String(row?.candidate_id ?? id);
      for (const evidence of candidate.identifiers) {
        const evidenceId = createHash("sha256").update(`${persistedId}|${evidence.type}|${evidence.value}|${evidence.scope}`).digest("hex").slice(0, 32);
        const uuid = `${evidenceId.slice(0, 8)}-${evidenceId.slice(8, 12)}-4${evidenceId.slice(13, 16)}-8${evidenceId.slice(17, 20)}-${evidenceId.slice(20, 32)}`;
        await db.query(`INSERT INTO market_core.catalog_candidate_identifiers
          (candidate_identifier_id,candidate_id,identifier_type,identifier_value,identifier_scope,source_id,snapshot_id,valid_from,valid_to,evidence_kind,evidence_strength,verified,mic,created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,$12,clock_timestamp()) ON CONFLICT DO NOTHING`, [uuid, persistedId, evidence.type, evidence.value, evidence.scope, sourceId, source.snapshotId, evidence.validity.validFrom, evidence.validity.validTo, evidence.evidenceKind, evidence.strength, evidence.marketMic]);
      }
      return { candidateId: persistedId, state: "PERSISTED" };
    },
  };
}

export async function onboardCatalog(input: CatalogOnboardingInput): Promise<CatalogOnboardingResult> {
  const query = normalizeCatalogQuery(input.query);
  requireCatalogLicense(input.source);
  const discovery = await input.connector.search(query);
  const persisted = [];
  for (const candidate of discovery.candidates) persisted.push(await input.persistence.persist(input.source, candidate));
  const refs = discovery.candidates.map(candidate => candidate.listing?.listingRef).filter((ref): ref is string => ref !== undefined);
  const registry = await input.loadRegistry(refs);
  const resolutions = discovery.candidates.map(candidate => resolveCanonicalIdentity({ candidate, registry, asOf: input.asOf }));
  return Object.freeze({ discovery, persisted: Object.freeze(persisted), resolutions: Object.freeze(resolutions) });
}
