"use client";
import {useAuth} from "@clerk/nextjs";
import Link from "next/link";
import {useEffect,useRef,useState} from "react";
import type {SiteLang} from "@/lib/i18n/siteLanguage";

type Coverage="NOT_REPORTED"|"PARTIAL"|"ASSERTED_COMPLETE";
type ObservedCoverage=Coverage|"LEGACY_COVERAGE_UNKNOWN";
type Cash=Readonly<{currency:string;amountMinor:string}>;
type Position=Readonly<{isin:string;mic:string;quoteCurrency:string;quantity:string}>;
type HistoryRecord=Readonly<{snapshotId:string;sourceReference:string;asOf:string;
  reportedCoverage:Readonly<{cash:ObservedCoverage;positions:ObservedCoverage}>;evidenceStatus:"UNVERIFIED"}>;
type Review={
  state:"EXISTING_ACCOUNT_REVIEW_REQUIRED"|"NO_OWN_ACCOUNT_OBSERVED";
  existing:null|{accountMultiplicity:"ONE"|"MULTIPLE";portfolioIds:readonly string[]};
  financialTruth:"UNAVAILABLE";financialWrites:false;
};
type ImportRead={
  state:"UNVERIFIED_IMPORT_READBACK";
  snapshot:{
    snapshotId:string;portfolioId:string;evidenceStatus:"UNVERIFIED";
    reportedCoverage:{cash:ObservedCoverage;positions:ObservedCoverage};
    cashBalances:readonly {currency:string;minor:string}[];
    positions:readonly {isin:string;mic:string;quoteCurrency:string;quantityAtoms:string;
      reportedCostBasis:null|{currency:string;minor:string}}[];
    plannedContributions:readonly {currency:string;minor:string;dueDate:string;realized:false}[];
    valuation:"UNAVAILABLE";performance:"UNAVAILABLE";verifiedCash:"UNAVAILABLE";
    provenance:{sourceReference:string;asOf:string};
  };
};
type DifferenceRow=Readonly<{
  state:"TWO_REPORTED_VALUES"|"NOT_COMPARABLE_MISSING_REPORT";
  before:string|null;after:string|null;reportedDifference:string|null;
  financialMovement:"UNAVAILABLE";
}>;
type DeclarationComparison=Readonly<{
  kind:"UNVERIFIED_DECLARATION_COMPARISON_V1";
  portfolioId:string;beforeSnapshotId:string;afterSnapshotId:string;
  beforeAsOf:string;afterAsOf:string;
  evidence:"USER_REPORTED_UNVERIFIED";
  cash:readonly {currency:string;change:DifferenceRow}[];
  positions:readonly {isin:string;mic:string;quoteCurrency:string;change:DifferenceRow}[];
  ledgerMovements:"UNAVAILABLE";buySellReconstruction:"UNAVAILABLE";
  realizedContributions:"UNAVAILABLE";income:"UNAVAILABLE";
  fxConversion:"UNAVAILABLE";valuation:"UNAVAILABLE";performance:"UNAVAILABLE";
  recommendations:"NOT_PERFORMED";financialWrites:false;
}>;
const copy={
 pt:{title:"Importar um portfolio declarado",lead:"Importação manual de cash e instrumentos com ISIN/MIC. Os valores são declarações não verificadas: não representam saldo confirmado, valorização ou operações.",label:"Portfolio próprio",name:"Nome declarado",currency:"Moeda base",cash:"Cash declarado (unidades menores: cêntimos em EUR)",assets:"Posições declaradas (ISIN/MIC)",cashCoverage:"Cobertura de cash",assetCoverage:"Cobertura de posições",addCash:"Adicionar moeda",addAsset:"Adicionar posição",remove:"Remover",submit:"Guardar importação sem movimentar dinheiro",saved:"Snapshot não verificado guardado",recent:"Histórico guardado (máx. 20 mais recentes)",open:"Consultar snapshot",notReady:"Conta inexistente, várias contas ou acesso indisponível. Importação bloqueada.",error:"Erro de autorização, dados ou comunicação. Confirma o histórico antes de repetir.",none:"Não foram observadas importações deste portfolio.",unknown:"SEM VALORIZAÇÃO · CASH NÃO VERIFICADO · SEM PERFORMANCE",back:"Voltar ao Investing",source:"Referência de origem",asOf:"Data declarada",quantity:"Quantidade (decimal exato)",cost:"Custo de aquisição: desconhecido",historyMore:"Existem outras importações; esta lista não está completa.",unreported:"Não declarado",partial:"Parcial",complete:"Completo, declarado pelo utilizador",legacy:"Cobertura histórica DESCONHECIDA; não concluir saldo zero nem totalidade das posições",compare:"Comparar as duas declarações mais recentes",comparison:"Diferenças entre declarações não verificadas",difference:"Diferença declarada",notReported:"Não comparável: não declarado num dos snapshots",notTransactions:"Diferenças declaradas não provam compras/vendas, depósitos, retornos ou dividendos"},
 en:{title:"Import a declared portfolio",lead:"Manual import of cash and ISIN/MIC instruments. These are unverified declarations, not broker-confirmed funds, valuations or trades.",label:"Own portfolio",name:"Declared name",currency:"Base currency",cash:"Declared cash (minor units, cents in EUR)",assets:"Declared positions (ISIN/MIC)",cashCoverage:"Cash coverage",assetCoverage:"Positions coverage",addCash:"Add currency",addAsset:"Add position",remove:"Remove",submit:"Save import without moving money",saved:"Unverified snapshot saved",recent:"Saved history (20 latest max)",open:"View snapshot",notReady:"Account missing, multiple accounts or unavailable. Import blocked.",error:"Authorization, data or connection error. Check history before retrying.",none:"No imports observed for this portfolio.",unknown:"NO VALUATION · UNVERIFIED CASH · NO PERFORMANCE",back:"Back to Investing",source:"Source reference",asOf:"Declared date",quantity:"Quantity (exact decimal)",cost:"Cost basis: unknown",historyMore:"Additional imports exist; this list is incomplete.",unreported:"Not reported",partial:"Partial",complete:"Complete, user declared",legacy:"Legacy coverage UNKNOWN; neither zero cash nor complete holdings can be assumed",compare:"Compare the two most recent declarations",comparison:"Differences between unverified declarations",difference:"Reported difference",notReported:"Not comparable: missing in one snapshot",notTransactions:"Reported differences do not establish trades, deposits, returns or dividends"},
 fr:{title:"Importer un portefeuille déclaré",lead:"Import manuel de liquidités et instruments ISIN/MIC. Déclarations non vérifiées, sans solde confirmé, valorisation ou transactions.",label:"Mon portefeuille",name:"Nom déclaré",currency:"Devise de base",cash:"Liquidités déclarées (unités mineures, centimes en EUR)",assets:"Positions déclarées (ISIN/MIC)",cashCoverage:"Couverture liquidités",assetCoverage:"Couverture positions",addCash:"Ajouter devise",addAsset:"Ajouter position",remove:"Supprimer",submit:"Enregistrer sans mouvement financier",saved:"Snapshot non vérifié enregistré",recent:"Historique (20 derniers au maximum)",open:"Voir snapshot",notReady:"Compte absent, comptes multiples ou service indisponible. Import bloqué.",error:"Erreur de données, d'autorisation ou de connexion. Vérifier l'historique avant de réessayer.",none:"Aucun import observé pour ce portefeuille.",unknown:"SANS VALORISATION · LIQUIDITÉS NON VÉRIFIÉES · SANS PERFORMANCE",back:"Retour à Investing",source:"Référence d'origine",asOf:"Date déclarée",quantity:"Quantité (décimal exact)",cost:"Coût d'acquisition : inconnu",historyMore:"D'autres imports existent; cette liste est incomplète.",unreported:"Non déclaré",partial:"Partiel",complete:"Complet, déclaré par l'utilisateur",legacy:"Couverture historique INCONNUE : ni solde nul ni positions complètes présumés",compare:"Comparer les deux dernières déclarations",comparison:"Écarts entre déclarations non vérifiées",difference:"Écart déclaré",notReported:"Non comparable : absent de l’un des snapshots",notTransactions:"Les écarts déclarés ne prouvent pas d’ordres, dépôts, rendements ou dividendes"},
} satisfies Record<SiteLang,Record<string,string>>;
const inp="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2 text-slate-100";
function readOnlyJson(r:unknown):r is {state:"UNVERIFIED_IMPORT_HISTORY";history:{
  portfolioId:string;records:HistoryRecord[];hasMore:boolean;valuation:"UNAVAILABLE"}}{
 if(!r||typeof r!=="object")return false;
 const x=r as Record<string,unknown>;
 if(x.state!=="UNVERIFIED_IMPORT_HISTORY"||!x.history||typeof x.history!=="object")return false;
 const h=x.history as Record<string,unknown>;
 return Array.isArray(h.records)&&h.valuation==="UNAVAILABLE"&&typeof h.portfolioId==="string"&&
  typeof h.hasMore==="boolean"&&h.records.every(p=>p&&typeof p.snapshotId==="string"&&
    p.evidenceStatus==="UNVERIFIED");
}
export default function PortfolioImportClient({lang}:{lang:SiteLang}){
 const t=copy[lang],{userId,isLoaded}=useAuth(),user=isLoaded?userId:null;
 const [readyFor,setReadyFor]=useState<string|null>(null);
 const [portfolios,setPortfolios]=useState<readonly string[]>([]);
 const [selected,setSelected]=useState("");
 const [name,setName]=useState("Portfolio");
 const [baseCurrency,setBaseCurrency]=useState("EUR");
 const [cash,setCash]=useState<Cash[]>([]);
 const [assets,setAssets]=useState<Position[]>([]);
 const [cashCoverage,setCashCoverage]=useState<Coverage>("NOT_REPORTED");
 const [assetCoverage,setAssetCoverage]=useState<Coverage>("NOT_REPORTED");
 const [history,setHistory]=useState<HistoryRecord[]>([]);
 const [hasMore,setHasMore]=useState(false);
 const [detail,setDetail]=useState<ImportRead["snapshot"]|null>(null);
 const [comparison,setComparison]=useState<DeclarationComparison|null>(null);
 const [error,setError]=useState(false);
 const [saving,setSaving]=useState(false);
 const [done,setDone]=useState(false);
 const attempt=useRef<{key:string;source:string;asOf:string}|null>(null);
 const allowed=!!user&&readyFor===user&&portfolios.length>0&&!!selected&&portfolios.includes(selected);
 useEffect(()=>{
   if(!user)return;
   let active=true;const controller=new AbortController();
   void fetch("/api/investing/existing-account",{cache:"no-store",signal:controller.signal})
    .then(async response=>{
      if(!response.ok)throw Error("no read");
      const body:unknown=await response.json();
      if(!body||typeof body!=="object")throw Error("invalid");
      const d=body as Partial<Review>;
      if(d.financialTruth!=="UNAVAILABLE"||d.financialWrites!==false||
         d.state!=="EXISTING_ACCOUNT_REVIEW_REQUIRED"||
         d.existing?.accountMultiplicity!=="ONE"||
         !Array.isArray(d.existing.portfolioIds))throw Error("ambiguous");
      const ids=d.existing.portfolioIds;
      if(!ids.every(id=>typeof id==="string"))throw Error("invalid");
      if(active){
        setPortfolios(ids);setSelected(ids[0]??"");setReadyFor(user);setError(false);
      }
    }).catch(()=>{if(active){setPortfolios([]);setSelected("");setReadyFor(null);setError(true);}});
   return()=>{active=false;controller.abort();};
 },[user]);
 useEffect(()=>{
   if(!allowed)return;
   let active=true;const controller=new AbortController();
   const params=new URLSearchParams({portfolioId:selected});
   void fetch("/api/investing/portfolio/import?"+params,{cache:"no-store",signal:controller.signal})
     .then(async response=>{
       if(!response.ok)throw Error("read");
       const value:unknown=await response.json();
       if(!readOnlyJson(value)||value.history.portfolioId!==selected)throw Error("invalid");
       if(active){setHistory(value.history.records);setHasMore(value.history.hasMore);}
     }).catch(()=>{if(active){setHistory([]);setError(true);}});
   return()=>{active=false;controller.abort();};
 },[user,allowed,selected,done]);
 function changed(){attempt.current=null;setDone(false);setDetail(null);setComparison(null);setError(false);}
 const updateCash=(i:number,key:keyof Cash,value:string)=>{
   changed();setCash(rows=>rows.map((r,j)=>i===j?{...r,[key]:value}:r));
 };
 const updateAsset=(i:number,key:keyof Position,value:string)=>{
   changed();setAssets(rows=>rows.map((r,j)=>i===j?{...r,[key]:value}:r));
 };
 async function show(snapshotId:string){
   if(!allowed)return;
   setError(false);
   try{
     const params=new URLSearchParams({portfolioId:selected,snapshotId});
     const res=await fetch("/api/investing/portfolio/import?"+params,{cache:"no-store"});
     if(!res.ok)throw Error("read");
     const val:unknown=await res.json();
     if(!val||typeof val!=="object")throw Error("invalid");
     const d=val as Partial<ImportRead>;
     if(d.state!=="UNVERIFIED_IMPORT_READBACK"||
        d.snapshot?.snapshotId!==snapshotId||d.snapshot?.portfolioId!==selected||
        d.snapshot?.evidenceStatus!=="UNVERIFIED"||
        d.snapshot?.valuation!=="UNAVAILABLE")throw Error("wrong scope");
     setDetail(d.snapshot);
   }catch{setError(true);}
 }
 async function compareLatest(){
   if(!allowed)return;
   setError(false);
   setComparison(null);
   // "latest" here refers to source timestamps stated by the user, not
   // trade timestamps, not transaction ordering, not broker evidence.
   const chronological=[...history].sort((a,b)=>b.asOf.localeCompare(a.asOf));
   const current=chronological[0],previous=chronological[1];
   if(!current||!previous||!(previous.asOf<current.asOf))return;
   try{
     const query=new URLSearchParams({
       portfolioId:selected,snapshotId:current.snapshotId,
       baselineSnapshotId:previous.snapshotId,
     });
     const response=await fetch("/api/investing/portfolio/import?"+query,{
       credentials:"same-origin",cache:"no-store",
     });
     if(!response.ok)throw Error("not comparable");
     const data:unknown=await response.json();
     if(!data||typeof data!=="object")throw Error("invalid");
     const wrapper=data as {
       state?:string;comparison?:Partial<DeclarationComparison>;
     };
     const result=wrapper.comparison;
     if(wrapper.state!=="UNVERIFIED_DECLARATION_COMPARISON"||
       result?.kind!=="UNVERIFIED_DECLARATION_COMPARISON_V1"||
       result.portfolioId!==selected||
       result.beforeSnapshotId!==previous.snapshotId||
       result.afterSnapshotId!==current.snapshotId||
       result.evidence!=="USER_REPORTED_UNVERIFIED"||
       result.ledgerMovements!=="UNAVAILABLE"||
       result.buySellReconstruction!=="UNAVAILABLE"||
       result.valuation!=="UNAVAILABLE"||
       result.performance!=="UNAVAILABLE"||
       result.financialWrites!==false||
       !Array.isArray(result.cash)||!Array.isArray(result.positions))
       throw Error("invalid comparison evidence");
     setComparison(result as DeclarationComparison);
   }catch{setError(true);}
 }
 async function submit(){
   if(!allowed||saving||(!cash.length&&!assets.length))return;
   // Form values are strings; never convert quantities/money through JS floats.
   if(!attempt.current){
     const id=crypto.randomUUID();
     attempt.current={key:"import-"+id,source:"manual-"+id,asOf:new Date().toISOString()};
   }
   const key=attempt.current;
   const declaration={
     schemaVersion:"R2_IMPORT_DRAFT_V1",
     source:"MANUAL_ENTRY",sourceReference:key.source,
     asOf:key.asOf,
     portfolioName:name,baseCurrency,reportedCoverage:{
       cash:cashCoverage,positions:assetCoverage,
     },cashBalances:cash,positions:assets.map(p=>({
       instrument:{isin:p.isin,mic:p.mic,quoteCurrency:p.quoteCurrency},
       quantity:p.quantity,reportedCostBasis:null,
     })),plannedContributions:[],
   };
   setSaving(true);setError(false);
   try{
     const response=await fetch("/api/investing/portfolio/import",{
       method:"POST",cache:"no-store",credentials:"same-origin",
       headers:{"Content-Type":"application/json"},
       body:JSON.stringify({portfolioId:selected,idempotencyKey:key.key,declaration}),
     });
     const result:unknown=await response.json();
     if(!response.ok||!result||typeof result!=="object")throw Error("submit");
     const a=result as {state?:string;receipt?:{snapshotId?:string}};
     if(a.state!=="USER_REPORTED_UNVERIFIED_IMPORT"||
        typeof a.receipt?.snapshotId!=="string")throw Error("invalid");
     setDone(true);setHistory(records=>records);
     await show(a.receipt.snapshotId);
   }catch{setError(true);}
   finally{setSaving(false);}
 }
 const dated=[...history].sort((a,b)=>b.asOf.localeCompare(a.asOf));
 const canCompare=allowed&&dated.length>1&&dated[0].asOf>dated[1].asOf;
 const coverageOptions:[Coverage,string][]=[
  ["NOT_REPORTED",t.unreported],["PARTIAL",t.partial],["ASSERTED_COMPLETE",t.complete]];
 const cashValid=cash.every(x=>!!x.currency&&/^(0|[1-9]\d*)$/.test(x.amountMinor));
 const assetsValid=assets.every(p=>!!p.isin&&!!p.mic&&!!p.quoteCurrency&&!!p.quantity);
 const coverageValid=(cash.length?cashCoverage!=="NOT_REPORTED":cashCoverage!=="PARTIAL")&&
   (assets.length?assetCoverage!=="NOT_REPORTED":assetCoverage!=="PARTIAL");
 return <main className="mx-auto max-w-4xl px-5 py-12 text-slate-100">
   <h1 className="text-3xl font-semibold">{t.title}</h1>
   <p className="mt-3 text-slate-300">{t.lead}</p>
   <p className="mt-4 rounded border border-amber-700 p-3 text-amber-200">{t.unknown}</p>
   {!allowed?<p role="alert" className="mt-6 text-amber-200">{t.notReady}</p>:<>
    <section className="mt-7 space-y-4 rounded border border-slate-700 p-5">
     <label className="block text-sm">{t.label}
      <select value={selected} className={inp} onChange={e=>{changed();setSelected(e.target.value);setDetail(null);}}>
       {portfolios.map(id=><option key={id} value={id}>{id}</option>)}
      </select>
     </label>
     <label className="block text-sm">{t.name}
      <input className={inp} value={name} onChange={e=>{changed();setName(e.target.value);}}/>
     </label>
     <label className="block text-sm">{t.currency}
      <select className={inp} value={baseCurrency} onChange={e=>{changed();setBaseCurrency(e.target.value);}}>
       {["EUR","USD","GBP","CHF","JPY","KWD"].map(c=><option key={c}>{c}</option>)}
      </select>
     </label>
     <h2 className="text-xl font-semibold">{t.cash}</h2>
     <label className="block text-sm">{t.cashCoverage}
      <select value={cashCoverage} className={inp} onChange={e=>{changed();setCashCoverage(e.target.value as Coverage);}}>
       {coverageOptions.map(([v,label])=><option value={v} key={v}>{label}</option>)}
      </select>
     </label>
     {cash.map((row,i)=><div className="grid gap-3 sm:grid-cols-3" key={"cash-"+i}>
      <select className={inp} value={row.currency} onChange={e=>updateCash(i,"currency",e.target.value)}>
       {["EUR","USD","GBP","CHF","JPY","KWD"].map(c=><option key={c}>{c}</option>)}
      </select>
      <input aria-label="Minor units" className={inp} inputMode="numeric" placeholder="minor units"
        value={row.amountMinor} onChange={e=>updateCash(i,"amountMinor",e.target.value)}/>
      <button className="underline text-sky-300" onClick={()=>{changed();setCash(v=>v.filter((_,j)=>i!==j));setCashCoverage(cash.length===1?"NOT_REPORTED":cashCoverage);}}>{t.remove}</button>
     </div>)}
     <button className="text-sky-300 underline" onClick={()=>{if(cash.length>=5)return;changed();setCash(v=>[...v,{currency:baseCurrency,amountMinor:""}]);setCashCoverage("PARTIAL");}}>{t.addCash}</button>
     <h2 className="text-xl font-semibold">{t.assets}</h2>
     <label className="block text-sm">{t.assetCoverage}
      <select className={inp} value={assetCoverage} onChange={e=>{changed();setAssetCoverage(e.target.value as Coverage);}}>
       {coverageOptions.map(([v,label])=><option value={v} key={v}>{label}</option>)}
      </select>
     </label>
     {assets.map((row,i)=><div className="grid gap-2 sm:grid-cols-5" key={"asset-"+i}>
       {(["isin","mic","quoteCurrency","quantity"] as const).map(field=>
         <input key={field} className={inp} value={row[field]}
           placeholder={field==="quantity"?t.quantity:field.toUpperCase()}
           aria-label={field} onChange={e=>updateAsset(i,field,e.target.value)}/>)}
       <button className="underline text-sky-300" onClick={()=>{changed();setAssets(v=>v.filter((_,j)=>i!==j));setAssetCoverage(assets.length===1?"NOT_REPORTED":assetCoverage);}}>{t.remove}</button>
     </div>)}
     <p className="text-xs text-slate-400">{t.cost}</p>
     <button className="text-sky-300 underline" onClick={()=>{if(assets.length>=5)return;changed();setAssets(v=>[...v,{isin:"",mic:"",quoteCurrency:baseCurrency,quantity:""}]);setAssetCoverage("PARTIAL");}}>{t.addAsset}</button>
     <div>
       <button type="button" className="rounded bg-sky-400 px-5 py-3 font-semibold text-slate-950 disabled:opacity-40"
        disabled={saving||!name.trim()||!cashValid||!assetsValid||!coverageValid||(!cash.length&&!assets.length)}
        onClick={()=>void submit()}>{saving?"…":t.submit}</button>
     </div>
     {done&&<p role="status" className="text-emerald-200">{t.saved}</p>}
    </section>
    <section className="mt-7 rounded border border-slate-700 p-5">
     <h2 className="text-xl font-semibold">{t.recent}</h2>
     {history.length===0?<p className="mt-3 text-slate-400">{t.none}</p>:history.map(record=>
       <button key={record.snapshotId} className="mt-3 block break-all text-left text-sky-300 underline"
         onClick={()=>void show(record.snapshotId)}>{t.open}: {record.snapshotId} — {record.asOf}</button>)}
     {canCompare&&<button type="button" className="mt-4 block text-emerald-300 underline"
       onClick={()=>void compareLatest()}>{t.compare}</button>}
     {hasMore&&<p className="mt-3 text-amber-200">{t.historyMore}</p>}
     {history.some(r=>r.reportedCoverage.cash==="LEGACY_COVERAGE_UNKNOWN"||r.reportedCoverage.positions==="LEGACY_COVERAGE_UNKNOWN")&&
      <p role="status" className="mt-3 text-amber-200">{t.legacy}</p>}
    </section>
    {comparison&&<section className="mt-7 rounded border border-amber-700 p-5">
      <h2 className="text-xl font-semibold">{t.comparison}</h2>
      <p className="mt-2 text-sm text-slate-400">{comparison.beforeAsOf} → {comparison.afterAsOf}</p>
      <p role="status" className="mt-3 text-amber-200">{t.notTransactions}</p>
      {comparison.cash.map(row=>
        <p className="mt-3 break-all text-sm" key={row.currency}>
          {row.currency}: {row.change.reportedDifference===null?
            t.notReported:t.difference+" "+row.change.reportedDifference+" (minor units)"}
        </p>)}
      {comparison.positions.map(row=>
        <p className="mt-3 break-all text-sm" key={[row.isin,row.mic,row.quoteCurrency].join(":")}>
          {row.isin} / {row.mic} / {row.quoteCurrency}: {
          row.change.reportedDifference===null?t.notReported:
            t.difference+" "+row.change.reportedDifference+" (10^-12 units)"}
        </p>)}
    </section>}
    {detail&&<section className="mt-7 rounded border border-slate-700 p-5">
      <h2 className="text-lg font-semibold">{t.open}: {detail.snapshotId}</h2>
      <p className="mt-2">{t.source}: {detail.provenance.sourceReference}</p>
      <p className="mt-1">{t.asOf}: {detail.provenance.asOf}</p>
      <p className="mt-2 text-amber-200">{t.unknown}</p>
      {(detail.reportedCoverage.cash==="LEGACY_COVERAGE_UNKNOWN"||detail.reportedCoverage.positions==="LEGACY_COVERAGE_UNKNOWN")&&
       <p role="status" className="mt-2 text-amber-200">{t.legacy}</p>}
      <pre className="mt-3 overflow-auto whitespace-pre-wrap break-all text-sm">{JSON.stringify({
        reportedCoverage:detail.reportedCoverage,cashBalances:detail.cashBalances,
        positions:detail.positions,plannedContributions:detail.plannedContributions,
        valuation:detail.valuation,performance:detail.performance,
      },null,2)}</pre>
    </section>}
   </>}
   {error&&<p role="alert" className="mt-4 text-amber-200">{t.error}</p>}
   <Link href="/investing/start" className="mt-7 inline-block text-sky-300 underline">{t.back}</Link>
 </main>;
}
