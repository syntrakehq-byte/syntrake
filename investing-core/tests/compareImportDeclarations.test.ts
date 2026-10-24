import assert from "node:assert/strict";
import test from "node:test";
import {currencyCode} from "../domain/money";
import type {UnverifiedImportReadback} from "../server/readOwnPortfolioImport";
import {compareImportDeclarations,ImportComparisonBlocked}
 from "../portfolio/compareImportDeclarations";

const eur=currencyCode.parse("EUR"),usd=currencyCode.parse("USD");
const account="00000000-0000-4000-8000-0000000000a2";
const beforeId="00000000-0000-4000-8000-0000000000a5";
const afterId="00000000-0000-4000-8000-0000000000a6";
const position = (quantityAtoms:bigint) => ({
 isin:"US0378331005",mic:"XNAS",quoteCurrency:usd,
 quantityAtoms,reportedCostBasis:null,verification:"UNVERIFIED" as const,
});
function snapshot(overrides:Partial<UnverifiedImportReadback>={}):UnverifiedImportReadback {
 return {
  kind:"UNVERIFIED_IMPORT",evidenceStatus:"UNVERIFIED",
  portfolioId:account,snapshotId:beforeId,schemaVersion:"R2_IMPORT_DRAFT_V1",
  provenance:{source:"MANUAL_ENTRY",sourceReference:"test-declaration-001",
    asOf:"2026-10-22T18:00:00.000Z"},
  portfolioName:"Long term",baseCurrency:eur,
  reportedCoverage:{cash:"PARTIAL",positions:"PARTIAL"},
  cashBalances:[{currency:eur,minor:9007199254740993n,verification:"UNVERIFIED"}],
  positions:[position(1000000000001n)],
  plannedContributions:[{currency:eur,minor:10000n,dueDate:"2026-11-01",realized:false}],
  verifiedCash:"UNAVAILABLE",valuation:"UNAVAILABLE",performance:"UNAVAILABLE",
  ledgerChanged:false,...overrides,
 };
}
const after = (changes:Partial<UnverifiedImportReadback>={}) => snapshot({
 snapshotId:afterId,
 provenance:{source:"MANUAL_ENTRY",sourceReference:"test-declaration-002",
   asOf:"2026-10-23T18:00:00.000Z"},
 ...changes,
});
test("R2-E two observed values: exact bigint decimal delta, not financial movement",()=>{
 const result=compareImportDeclarations(snapshot(),after({
  cashBalances:[{currency:eur,minor:9007199254741004n,verification:"UNVERIFIED"}],
  positions:[position(1000000000003n)],
 }));
 assert.equal(result.kind,"UNVERIFIED_DECLARATION_COMPARISON_V1");
 assert.deepEqual(result.cash,[{currency:"EUR",change:{
  state:"TWO_REPORTED_VALUES",before:"9007199254740993",after:"9007199254741004",
  reportedDifference:"11",financialMovement:"UNAVAILABLE",
 }}]);
 assert.deepEqual(result.positions,[{isin:"US0378331005",mic:"XNAS",
  quoteCurrency:"USD",change:{state:"TWO_REPORTED_VALUES",
    before:"1000000000001",after:"1000000000003",
    reportedDifference:"2",financialMovement:"UNAVAILABLE"}}]);
 assert.equal(result.ledgerMovements,"UNAVAILABLE");
 assert.equal(result.buySellReconstruction,"UNAVAILABLE");
 assert.equal(result.realizedContributions,"UNAVAILABLE");
 assert.equal(result.income,"UNAVAILABLE");
 assert.equal(result.fxConversion,"UNAVAILABLE");
 assert.equal(result.valuation,"UNAVAILABLE");
 assert.equal(result.performance,"UNAVAILABLE");
 assert.equal(result.recommendations,"NOT_PERFORMED");
 assert.equal(result.financialWrites,false);
 assert.equal(Object.isFrozen(result),true);
 assert.equal(Object.isFrozen(result.cash),true);
 assert.equal(Object.isFrozen(result.cash[0].change),true);
});
test("R2-E absent report never implies zero even when ASSERTED_COMPLETE",()=>{
 const x=compareImportDeclarations(snapshot(),after({
  cashBalances:[],positions:[],
  reportedCoverage:{cash:"ASSERTED_COMPLETE",positions:"ASSERTED_COMPLETE"},
 }));
 assert.equal(x.cash[0].change.state,"NOT_COMPARABLE_MISSING_REPORT");
 assert.equal(x.cash[0].change.after,null);
 assert.equal(x.cash[0].change.reportedDifference,null);
 assert.equal(x.positions[0].change.after,null);
 assert.equal(x.positions[0].change.reportedDifference,null);
 assert.equal(x.coverage.after.cash,"ASSERTED_COMPLETE");
});
test("R2-E partial and legacy unknown never create rows from unknown; no position delisting inference",()=>{
 const x=compareImportDeclarations(snapshot({
  cashBalances:[],
  positions:[],
  reportedCoverage:{cash:"LEGACY_COVERAGE_UNKNOWN",positions:"LEGACY_COVERAGE_UNKNOWN"},
 }),after());
 assert.equal(x.cash[0].change.before,null);
 assert.equal(x.cash[0].change.reportedDifference,null);
 assert.equal(x.positions[0].change.before,null);
 assert.equal(x.positions[0].change.reportedDifference,null);
 assert.equal(x.coverage.before.positions,"LEGACY_COVERAGE_UNKNOWN");
});
test("R2-E deterministic sorting by currency and full instrument identity; no FX mix",()=>{
 const x=compareImportDeclarations(snapshot({
  cashBalances:[
   {currency:usd,minor:500n,verification:"UNVERIFIED"},
   {currency:eur,minor:300n,verification:"UNVERIFIED"},
  ],
  positions:[
   position(123n),{...position(200n),mic:"XNYS"},
  ],
 }),after({
  cashBalances:[{currency:eur,minor:100n,verification:"UNVERIFIED"}],
  positions:[{...position(190n),mic:"XNYS"},position(123n)],
 }));
 assert.deepEqual(x.cash.map(v=>v.currency),["EUR","USD"]);
 assert.equal(x.cash[0].change.reportedDifference,"-200");
 assert.equal(x.cash[1].change.after,null);
 assert.deepEqual(x.positions.map(v=>v.mic),["XNAS","XNYS"]);
 assert.equal(x.positions[0].change.reportedDifference,"0");
 assert.equal(x.positions[1].change.reportedDifference,"-10");
});
test("R2-E proposed/realized contribution is not assumed from snapshots",()=>{
 const x=compareImportDeclarations(snapshot(),after({
  plannedContributions:[],
 }));
 assert.equal(x.realizedContributions,"UNAVAILABLE");
 assert.equal(x.ledgerMovements,"UNAVAILABLE");
 assert.ok(!Object.keys(x).includes("plannedContributionDelta"));
 assert.ok(!Object.keys(x).includes("cashReturn"));
});
test("R2-E fail closed cross-portfolio, same ID, equal/reversed as-of",()=>{
 const fixed=snapshot();
 for(const [candidate,code] of [
  [after({portfolioId:"00000000-0000-4000-8000-0000000000b2"}),"PORTFOLIO_MISMATCH"],
  [after({snapshotId:beforeId}),"IDENTICAL_SNAPSHOT"],
  [after({provenance:{...fixed.provenance}}),"INVALID_CHRONOLOGY"],
  [after({provenance:{...fixed.provenance,asOf:"2026-10-20T18:00:00.000Z"}}),
    "INVALID_CHRONOLOGY"],
 ] as const) {
  assert.throws(()=>compareImportDeclarations(fixed,candidate),
   (e:unknown)=>e instanceof ImportComparisonBlocked&&e.code===code);
 }
});
test("R2-E duplicate currency / instrument identity fails instead of summing",()=>{
 for(const v of [
  after({cashBalances:[
    {currency:eur,minor:1n,verification:"UNVERIFIED"},
    {currency:eur,minor:2n,verification:"UNVERIFIED"},
  ]}),
  after({positions:[position(1n),position(2n)]}),
 ]) assert.throws(()=>compareImportDeclarations(snapshot(),v),
   (e:unknown)=>e instanceof ImportComparisonBlocked&&e.code==="INCONSISTENT_SNAPSHOT");
});
test("R2-E source not verified, ledger-inconsistent snapshots rejected",()=>{
 const bad=after({ledgerChanged:true});
 assert.throws(()=>compareImportDeclarations(snapshot(),bad),
   (e:unknown)=>e instanceof ImportComparisonBlocked&&e.code==="INCONSISTENT_SNAPSHOT");
});
test("R2-E invariant exact differences over wide bigint magnitudes",()=>{
 for(let i=1n;i<=25n;i++){
  const before=10n**25n+i;
  const afterN=before+(i%2n===0n?-i:i);
  const compare=compareImportDeclarations(snapshot({
    cashBalances:[{currency:eur,minor:before,verification:"UNVERIFIED"}],
  }),after({cashBalances:[{currency:eur,minor:afterN,verification:"UNVERIFIED"}]}));
  assert.equal(compare.cash[0].change.reportedDifference,(afterN-before).toString());
  assert.equal(compare.financialWrites,false);
 }
});
