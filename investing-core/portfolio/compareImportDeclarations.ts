import type { UnverifiedImportReadback } from "../server/readOwnPortfolioImport";

/**
 * R2-E: deterministic comparison of TWO USER-DECLARED (not broker-verified)
 * snapshots of the same Investing portfolio. It is deliberately NOT a ledger,
 * trade reconstruction, market valuation, return, FX conversion or advice.
 *
 * Missing on either side => UNAVAILABLE, NEVER implicitly 0n.
 * Presence on both sides => exact difference of two reported values only.
 */
export class ImportComparisonBlocked extends Error {
  constructor(public readonly code:
    "PORTFOLIO_MISMATCH" | "IDENTICAL_SNAPSHOT" | "INVALID_CHRONOLOGY" |
    "INCONSISTENT_SNAPSHOT" | "SIZE_LIMIT") {
    super(code);
  }
}
type Coverage = UnverifiedImportReadback["reportedCoverage"]["cash"];
export type DeclaredChange = Readonly<{
  state: "TWO_REPORTED_VALUES" | "NOT_COMPARABLE_MISSING_REPORT";
  before: string | null;
  after: string | null;
  reportedDifference: string | null;
  financialMovement: "UNAVAILABLE";
}>;
export type ImportDeclarationComparison = Readonly<{
  kind: "UNVERIFIED_DECLARATION_COMPARISON_V1";
  portfolioId: string;
  beforeSnapshotId: string;
  afterSnapshotId: string;
  beforeAsOf: string;
  afterAsOf: string;
  coverage: Readonly<{
    before: Readonly<{cash: Coverage; positions: Coverage}>;
    after: Readonly<{cash: Coverage; positions: Coverage}>;
  }>;
  cash: readonly Readonly<{ currency: string; change: DeclaredChange }>[];
  positions: readonly Readonly<{
    isin: string; mic: string; quoteCurrency: string; change: DeclaredChange;
  }>[];
  evidence: "USER_REPORTED_UNVERIFIED";
  ledgerMovements: "UNAVAILABLE";
  buySellReconstruction: "UNAVAILABLE";
  realizedContributions: "UNAVAILABLE";
  income: "UNAVAILABLE";
  fxConversion: "UNAVAILABLE";
  performance: "UNAVAILABLE";
  valuation: "UNAVAILABLE";
  recommendations: "NOT_PERFORMED";
  financialWrites: false;
}>;
const order = (a:string,b:string) => a<b?-1:a>b?1:0;
const positionKey = (p:{isin:string;mic:string;quoteCurrency:string}) =>
  JSON.stringify([p.isin,p.mic,p.quoteCurrency]);
const difference = (before:bigint|undefined,after:bigint|undefined):DeclaredChange => {
  if(before===undefined || after===undefined) {
    return Object.freeze({
      state:"NOT_COMPARABLE_MISSING_REPORT" as const,
      before:before===undefined?null:before.toString(),
      after:after===undefined?null:after.toString(),
      reportedDifference:null,financialMovement:"UNAVAILABLE" as const,
    });
  }
  return Object.freeze({
    state:"TWO_REPORTED_VALUES" as const,
    before:before.toString(),after:after.toString(),
    reportedDifference:(after-before).toString(),financialMovement:"UNAVAILABLE" as const,
  });
};
function unique<T>(items:readonly T[],getKey:(item:T)=>string):Map<string,T>{
  const map=new Map<string,T>();
  for(const item of items){
    const key=getKey(item);
    if(map.has(key))throw new ImportComparisonBlocked("INCONSISTENT_SNAPSHOT");
    map.set(key,item);
  }
  return map;
}

/** Compare only data from the authenticated owner-scoped readback helper. */
export function compareImportDeclarations(
  before:UnverifiedImportReadback,after:UnverifiedImportReadback,
):ImportDeclarationComparison{
  if(before.kind!=="UNVERIFIED_IMPORT" || after.kind!=="UNVERIFIED_IMPORT" ||
    before.evidenceStatus!=="UNVERIFIED" || after.evidenceStatus!=="UNVERIFIED" ||
    before.schemaVersion!=="R2_IMPORT_DRAFT_V1" ||
    after.schemaVersion!=="R2_IMPORT_DRAFT_V1" ||
    before.ledgerChanged!==false || after.ledgerChanged!==false)
      throw new ImportComparisonBlocked("INCONSISTENT_SNAPSHOT");
  if(before.portfolioId!==after.portfolioId)
    throw new ImportComparisonBlocked("PORTFOLIO_MISMATCH");
  if(before.snapshotId===after.snapshotId)
    throw new ImportComparisonBlocked("IDENTICAL_SNAPSHOT");
  // Source dates are declared, not trusted calendar/broker timestamps.
  // Reversed/equal chronology is not evidence of a forward change.
  if(!(before.provenance.asOf<after.provenance.asOf))
    throw new ImportComparisonBlocked("INVALID_CHRONOLOGY");

  const bCash=unique(before.cashBalances,x=>x.currency);
  const aCash=unique(after.cashBalances,x=>x.currency);
  const bPositions=unique(before.positions,positionKey);
  const aPositions=unique(after.positions,positionKey);
  if(bCash.size+aCash.size>200 || bPositions.size+aPositions.size>10_000)
    throw new ImportComparisonBlocked("SIZE_LIMIT");
  const cashKeys=[...new Set([...bCash.keys(),...aCash.keys()])].sort(order);
  const positionKeys=[...new Set([...bPositions.keys(),...aPositions.keys()])].sort(order);
  const cash=Object.freeze(cashKeys.map(currency=>Object.freeze({
    currency,
    change:difference(bCash.get(currency)?.minor,aCash.get(currency)?.minor),
  })));
  const positions=Object.freeze(positionKeys.map(key=>{
    const x=aPositions.get(key)??bPositions.get(key);
    if(!x)throw new ImportComparisonBlocked("INCONSISTENT_SNAPSHOT");
    return Object.freeze({isin:x.isin,mic:x.mic,quoteCurrency:x.quoteCurrency,
      change:difference(bPositions.get(key)?.quantityAtoms,aPositions.get(key)?.quantityAtoms)});
  }));

  return Object.freeze({
    kind:"UNVERIFIED_DECLARATION_COMPARISON_V1" as const,
    portfolioId:before.portfolioId,
    beforeSnapshotId:before.snapshotId,afterSnapshotId:after.snapshotId,
    beforeAsOf:before.provenance.asOf,afterAsOf:after.provenance.asOf,
    coverage:Object.freeze({
      before:Object.freeze({...before.reportedCoverage}),
      after:Object.freeze({...after.reportedCoverage}),
    }),
    cash,positions,
    evidence:"USER_REPORTED_UNVERIFIED" as const,
    ledgerMovements:"UNAVAILABLE" as const,
    buySellReconstruction:"UNAVAILABLE" as const,
    realizedContributions:"UNAVAILABLE" as const,
    income:"UNAVAILABLE" as const,
    fxConversion:"UNAVAILABLE" as const,
    performance:"UNAVAILABLE" as const,
    valuation:"UNAVAILABLE" as const,
    recommendations:"NOT_PERFORMED" as const,
    financialWrites:false as const,
  });
}
