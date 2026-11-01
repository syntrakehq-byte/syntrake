import test from "node:test";
import assert from "node:assert/strict";
import { createDiscoveryResult, normalizeCatalogCandidate, normalizeCatalogQuery, type CatalogCandidate, type CatalogSource } from "../instrumentDiscovery";

const sourceA = { providerKey: "CATALOG_A", snapshotId: "snap-a-1", snapshotVersion: "2026-11-01", observedAt: "2026-11-01T10:00:00Z", licensePolicyId: "catalog-a-dev", storageAllowed: true, sharingAllowed: false } as const;
const sourceB = { providerKey: "CATALOG_B", snapshotId: "snap-b-1", snapshotVersion: "2026-11-01", observedAt: "2026-11-01T10:01:00Z", licensePolicyId: "catalog-b-dev", storageAllowed: true, sharingAllowed: false } as const;
function candidate(source: CatalogSource, mic: "XNAS" | "XNGS", providerReference: string): CatalogCandidate {
  return { issuer:{issuerRef:"issuer-apple",legalName:"Apple Inc."}, instrument:{instrumentRef:"instrument-apple",assetClass:"EQUITY",denominationCurrency:"USD"}, listing:{listingRef:`listing-apple-${mic}`,ticker:"aapl",mic,micRole:mic === "XNGS" ? "SEGMENT" : "OPERATING",tradingCurrency:"USD",validity:{validFrom:"1980-12-12",validTo:null}}, providerReference:{providerKey:source.providerKey,providerReference,identifierType:"PROVIDER_NATIVE",scope:"LISTING",source,validity:{validFrom:"1980-12-12",validTo:null}}, identifiers:[{type:"ISIN",value:"US0378331005",scope:"INSTRUMENT",source,evidenceKind:"IDENTIFIER_RECORD",strength:"STRONG",verified:true,validity:{validFrom:"1980-12-12",validTo:null},marketMic:mic}] ,source };
}

test("D0 normalizes queries and keeps issuer/instrument/listing/provider identity separate", () => {
  const query = normalizeCatalogQuery({ name:"  Apple   Inc. ", ticker:" aapl ", identifiers:[{type:"ISIN",value:"us0378331005",scope:"INSTRUMENT"}], marketMic:"xngs", currency:"usd" });
  assert.deepEqual(query, {name:"Apple Inc.",ticker:"AAPL",identifiers:[{type:"ISIN",value:"US0378331005",scope:"INSTRUMENT"}],marketMic:"XNGS",currency:"USD"});
  const normalized = normalizeCatalogCandidate(candidate(sourceA,"XNAS","AAPL-XNAS"));
  assert.equal(normalized.issuer?.issuerRef,"issuer-apple");
  assert.equal(normalized.instrument?.instrumentRef,"instrument-apple");
  assert.equal(normalized.listing?.micRole,"OPERATING");
  assert.equal(normalized.providerReference.providerKey,"CATALOG_A");
});

test("D0 uses two independent simulated providers and never equates XNAS with XNGS", () => {
  const a = createDiscoveryResult({ticker:"AAPL",marketMic:"XNAS"},[candidate(sourceA,"XNAS","AAPL-XNAS")]);
  const b = createDiscoveryResult({ticker:"AAPL",marketMic:"XNGS"},[candidate(sourceB,"XNGS","APPLE.NASDAQ")]);
  assert.equal(a.status,"EXACT");
  assert.equal(b.status,"EXACT");
  assert.notEqual(a.candidates[0].listing?.mic,b.candidates[0].listing?.mic);
  assert.notEqual(a.candidates[0].providerReference.providerKey,b.candidates[0].providerReference.providerKey);
});

test("D0 refuses ambiguity, contradictory identity and insufficient evidence", () => {
  assert.equal(createDiscoveryResult({ticker:"AAPL"},[candidate(sourceA,"XNAS","AAPL-XNAS"),candidate(sourceB,"XNGS","APPLE.NASDAQ")]).status,"AMBIGUOUS");
  const contradictoryBase = candidate(sourceA,"XNAS","AAPL-XNAS");
  const contradictory = {...contradictoryBase, identifiers:[{...contradictoryBase.identifiers[0], marketMic:"XNGS" as const}]};
  assert.throws(() => createDiscoveryResult({ticker:"AAPL"},[contradictory]),/DISCOVERY_CANDIDATE_IDENTITY_CONTRADICTION/);
  const insufficient = {...candidate(sourceA,"XNAS","AAPL-XNAS"), identifiers:[{...candidate(sourceA,"XNAS","AAPL-XNAS").identifiers[0],verified:false,strength:"SUPPORTING" as const}]};
  assert.equal(createDiscoveryResult({ticker:"AAPL"},[insufficient]).status,"REVIEW_REQUIRED");
  assert.equal(createDiscoveryResult({ticker:"UNKNOWN"},[]).status,"UNRESOLVED");
});

test("D0 rejects invalid queries, invalid windows and unlicensed catalog storage", () => {
  assert.throws(() => normalizeCatalogQuery({}),/DISCOVERY_QUERY_EMPTY/);
  assert.throws(() => normalizeCatalogQuery({ticker:"AAPL",marketMic:"NASDAQ"}),/DISCOVERY_QUERY_MIC_INVALID/);
  const invalid = {...candidate(sourceA,"XNAS","AAPL-XNAS"), listing:{...candidate(sourceA,"XNAS","AAPL-XNAS").listing!, validity:{validFrom:"2027-01-01",validTo:"2026-01-01"}}};
  assert.throws(() => normalizeCatalogCandidate(invalid),/DISCOVERY_CANDIDATE_LISTING_INVALID/);
  const unlicensed = {...candidate(sourceA,"XNAS","AAPL-XNAS"), source:{...sourceA,storageAllowed:false}, providerReference:{...candidate(sourceA,"XNAS","AAPL-XNAS").providerReference,source:{...sourceA,storageAllowed:false}}, identifiers:[{...candidate(sourceA,"XNAS","AAPL-XNAS").identifiers[0],source:{...sourceA,storageAllowed:false}}]};
  assert.equal(createDiscoveryResult({ticker:"AAPL"},[unlicensed]).status,"REVIEW_REQUIRED");
});
