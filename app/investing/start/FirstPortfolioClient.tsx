"use client";
import {useAuth} from "@clerk/nextjs";
import {useEffect,useRef,useState} from "react";
import type {SiteLang} from "@/lib/i18n/siteLanguage";

type Receipt={accountId:string;portfolioId:string;
 state:"STRUCTURE_CREATED_UNFUNDED";financialTruth:"UNAVAILABLE";
 ledgerMovementsCreated:false;brokerConfirmed:false;cashBalance:"UNAVAILABLE"};
type ExistingReview={accountId:string|null;portfolioIds:readonly string[];
 accountMultiplicity:"ONE"|"MULTIPLE";financialTruth:"UNAVAILABLE";
 reconciliation:"REQUIRED";evidence:"SUPABASE_RLS_READ"};
type Result={state:string;latest?:Receipt|null;receipt?:Receipt;existing?:ExistingReview|null};
const tr={
 pt:{title:"Criar a minha conta e portfolio Investing",detail:"Esta operação cria apenas a estrutura financeira: conta própria, portfolio e subcontas contabilísticas vazias. Não deposita dinheiro, compra ativos ou movimenta o ledger.",
 name:"Nome da conta",portfolio:"Nome do portfolio",currency:"Moeda base",
 action:"Criar conta e portfolio",busy:"A verificar…",
 ready:"Estrutura criada e guardada",account:"Conta Investing",portfolioId:"Portfolio",
 unavailable:"Não foi possível verificar a conta. Nenhum saldo foi presumido.",
 conflict:"Esta conta já foi criada com outra configuração. Não criámos outra.",
 lacking:"Guarda primeiro a tua escolha Investing.",
 noBalance:"Cash: INDISPONÍVEL · Broker: NÃO CONFIRMADO · Sem movimentos financeiros",
 legacy:"Conta Investing anterior identificada — reconciliação necessária",
 legacyNote:"Conta existente consultada com identidade autenticada. Não foi criada nenhuma conta, recibo, transação ou posição. Saldo, posições, custos e corretora permanecem INDISPONÍVEIS até reconciliação comprovada.",
 legacyAccounts:"Várias contas existentes detetadas. Necessária análise individual; nenhuma foi selecionada automaticamente.",
 legacyPortfolios:"Portfolios associados encontrados",
 legacyNoPortfolio:"Nenhum portfolio associado encontrado; não será criado outro automaticamente.",
 pending:"A verificar se já existe uma conta Investing…",
 },
 en:{title:"Create my Investing account and portfolio",detail:"Creates only an account, portfolio and empty internal bookkeeping subaccounts. No deposits, purchases or ledger movements.",
 name:"Account name",portfolio:"Portfolio name",currency:"Base currency",
 action:"Create account and portfolio",busy:"Checking…",
 ready:"Structure created and saved",account:"Investing account",portfolioId:"Portfolio",
 unavailable:"Unable to verify the account; no balance was assumed.",
 conflict:"An initial account already exists with different details. No duplicate was created.",
 lacking:"Save your Investing choice first.",
 noBalance:"Cash: UNAVAILABLE · Broker: NOT CONFIRMED · No financial movements",
 legacy:"Existing Investing account found — reconciliation required",
 legacyNote:"An existing account was read using the authenticated identity. No account, receipt, transaction or position was created. Cash, positions, costs and broker state remain UNAVAILABLE until evidenced reconciliation.",
 legacyAccounts:"Multiple accounts detected. Manual review required; none was selected automatically.",
 legacyPortfolios:"Associated portfolios found",
 legacyNoPortfolio:"No associated portfolio found; another will not be created automatically.",
 pending:"Checking for existing Investing accounts…",
 },
 fr:{title:"Créer mon compte et portefeuille Investing",detail:"Crée uniquement le compte, le portefeuille et des sous-comptes comptables vides. Aucun dépôt, achat ou mouvement financier.",
 name:"Nom du compte",portfolio:"Nom du portefeuille",currency:"Devise de base",
 action:"Créer le compte et le portefeuille",busy:"Vérification…",
 ready:"Structure créée et enregistrée",account:"Compte Investing",portfolioId:"Portefeuille",
 unavailable:"Impossible de vérifier le compte ; aucun solde n'a été supposé.",
 conflict:"Un premier compte existe avec d'autres paramètres. Aucun doublon créé.",
 lacking:"Enregistrez d'abord votre choix Investing.",
 noBalance:"Cash : INDISPONIBLE · Courtier : NON CONFIRMÉ · Aucun mouvement financier",
 legacy:"Compte Investing antérieur détecté — rapprochement nécessaire",
 legacyNote:"Compte existant consulté avec l'identité authentifiée. Aucun compte, reçu, mouvement ou position n'a été créé. Liquidités, positions, coûts et courtier restent INDISPONIBLES jusqu'au rapprochement vérifié.",
 legacyAccounts:"Plusieurs comptes détectés. Vérification manuelle nécessaire ; aucun compte sélectionné automatiquement.",
 legacyPortfolios:"Portefeuilles associés identifiés",
 legacyNoPortfolio:"Aucun portefeuille associé identifié ; aucun autre ne sera créé automatiquement.",
 pending:"Vérification des comptes Investing existants…",
 },
} satisfies Record<SiteLang,Record<string,string>>;
function isReceipt(x:unknown):x is Receipt{
 if(!x||typeof x!=="object")return false;
 const r=x as Partial<Receipt>;
 return typeof r.accountId==="string"&&typeof r.portfolioId==="string"&&
  r.state==="STRUCTURE_CREATED_UNFUNDED"&&r.financialTruth==="UNAVAILABLE"&&
  r.cashBalance==="UNAVAILABLE"&&r.ledgerMovementsCreated===false;
}
function isExistingReview(x:unknown):x is ExistingReview{
 if(!x||typeof x!=="object")return false;
 const r=x as Partial<ExistingReview>;
 const id=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
 return r.financialTruth==="UNAVAILABLE"&&r.reconciliation==="REQUIRED"&&
  r.evidence==="SUPABASE_RLS_READ"&&Array.isArray(r.portfolioIds)&&
  r.portfolioIds.length<=50&&r.portfolioIds.every(x=>typeof x==="string"&&id.test(x))&&
  ((r.accountMultiplicity==="ONE"&&typeof r.accountId==="string"&&id.test(r.accountId))||
   (r.accountMultiplicity==="MULTIPLE"&&r.accountId===null&&r.portfolioIds.length===0));
}
export default function FirstPortfolioClient({lang}:{lang:SiteLang}){
 const t=tr[lang],{userId,isLoaded}=useAuth();
 const actor=isLoaded?userId:null;
 const [account,setAccount]=useState("Investing Principal");
 const [portfolio,setPortfolio]=useState("Portfolio Longo Prazo");
 const [currency,setCurrency]=useState<"EUR"|"USD"|"GBP"|"CHF"|"JPY"|"KWD">("EUR");
 const [receipt,setReceipt]=useState<{owner:string;value:Receipt}|null>(null);
 const [existing,setExisting]=useState<{owner:string;value:ExistingReview}|null>(null);
 const [checkedActor,setCheckedActor]=useState<string|null>(null);
 const [error,setError]=useState<"UNAVAILABLE"|"CONFLICT"|"NO_INTENT"|null>(null);
 const [busy,setBusy]=useState(false);
 const attempt=useRef<string|null>(null);
 useEffect(()=>{
  if(!actor)return;
  let active=true;
  const controller=new AbortController();
  void (async()=>{
   try{
    const r=await fetch("/api/investing/portfolio/initialize",{
      credentials:"same-origin",cache:"no-store",signal:controller.signal});
    if(!r.ok)throw new Error("unavailable");
    const unknown:unknown=await r.json();
    if(!unknown||typeof unknown!=="object")throw new Error("shape");
    const o=unknown as Result;
    if(!active)return;
    if(o.state==="INITIAL_PORTFOLIO_EXISTS"&&isReceipt(o.latest)){
      setReceipt({owner:actor,value:o.latest});setExisting(null);
    }else if(o.state==="EXISTING_ACCOUNT_RECONCILIATION_REQUIRED"&&
      isExistingReview(o.existing)){
      setExisting({owner:actor,value:o.existing});setReceipt(null);
    }else if(o.state==="NOT_PROVISIONED"&&o.latest==null&&o.existing==null){
      setExisting(null);setReceipt(null);
    }else throw new Error("untrusted response");
    setError(null);setCheckedActor(actor);
   }catch{if(active){setError("UNAVAILABLE");setCheckedActor(actor);}}
  })();
  return()=>{active=false;controller.abort();};
 },[actor]);
 function revised(){
  attempt.current=null;setError(null);
 }
 const verified=actor&&receipt?.owner===actor?receipt.value:null;
 const review=actor&&existing?.owner===actor?existing.value:null;
 const canCreate=!!actor&&checkedActor===actor&&!error&&!verified&&!review;
 async function submit(){
  if(!canCreate||busy||!actor)return;
  if(!attempt.current)attempt.current=crypto.randomUUID();
  setBusy(true);setError(null);
  try{
   const r=await fetch("/api/investing/portfolio/initialize",{
     method:"POST",credentials:"same-origin",cache:"no-store",
     headers:{"Content-Type":"application/json"},
     body:JSON.stringify({
       idempotencyKey:attempt.current,
       accountName:account,portfolioName:portfolio,baseCurrency:currency,
     }),
   });
   const o:unknown=await r.json();
   if(!o||typeof o!=="object")throw new Error("shape");
   const result=o as Result&{error?:string};
   if(r.status===409){
    // A concurrent or historic account must be re-read, never duplicated.
    const check=await fetch("/api/investing/portfolio/initialize",{
      credentials:"same-origin",cache:"no-store"});
    if(check.ok){
      const latest:unknown=await check.json();
      if(latest&&typeof latest==="object"){
       const state=latest as Result;
       if(state.state==="EXISTING_ACCOUNT_RECONCILIATION_REQUIRED"&&isExistingReview(state.existing)){
        setExisting({owner:actor,value:state.existing});return;
       }
       if(state.state==="INITIAL_PORTFOLIO_EXISTS"&&isReceipt(state.latest)){
        setReceipt({owner:actor,value:state.latest});return;
       }
      }
    }
    setError(result.error==="NO_ONBOARDING_INTENT"?"NO_INTENT":"CONFLICT");return;
   }
   if(!r.ok||!isReceipt(result.receipt))throw new Error("unavailable");
   setReceipt({owner:actor,value:result.receipt});
  }catch{setError("UNAVAILABLE");}
  finally{setBusy(false);}
 }
 return <section className="mt-9 rounded-2xl border border-emerald-500/25 bg-slate-900 p-7">
  <h2 className="text-xl font-semibold">{t.title}</h2>
  <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300">{t.detail}</p>
  {verified?(
   <div className="mt-5 rounded-xl border border-emerald-400/40 bg-emerald-950/30 p-5">
    <p className="font-semibold text-emerald-300">{t.ready}</p>
    <p className="mt-3 break-all text-xs text-slate-300">{t.account}: {verified.accountId}</p>
    <p className="mt-2 break-all text-xs text-slate-300">{t.portfolioId}: {verified.portfolioId}</p>
    <p className="mt-3 text-sm text-amber-200">{t.noBalance}</p>
   </div>
  ):review?(
   <div className="mt-5 rounded-xl border border-amber-400/40 bg-amber-950/20 p-5">
    <p className="font-semibold text-amber-200">{t.legacy}</p>
    {review.accountMultiplicity==="ONE"?(
      <>
       <p className="mt-3 break-all text-xs text-slate-300">{t.account}: {review.accountId}</p>
       <p className="mt-2 text-sm text-slate-300">{t.legacyPortfolios}: {review.portfolioIds.length}</p>
       {review.portfolioIds.length===0?<p className="mt-2 text-sm text-amber-200">{t.legacyNoPortfolio}</p>:
        review.portfolioIds.map(id=><p key={id} className="mt-2 break-all text-xs text-slate-300">{t.portfolioId}: {id}</p>)}
      </>
    ):<p className="mt-3 text-sm text-amber-200">{t.legacyAccounts}</p>}
    <p className="mt-4 text-sm text-amber-200">{t.legacyNote}</p>
   </div>
  ):canCreate?(
   <>
    <div className="mt-5 grid gap-4 sm:grid-cols-3">
     <label className="text-sm text-slate-200">{t.name}
      <input className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 p-3"
       value={account} maxLength={80} onChange={e=>{setAccount(e.target.value);revised();}}/>
     </label>
     <label className="text-sm text-slate-200">{t.portfolio}
      <input className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 p-3"
       value={portfolio} maxLength={80} onChange={e=>{setPortfolio(e.target.value);revised();}}/>
     </label>
     <label className="text-sm text-slate-200">{t.currency}
      <select className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 p-3"
       value={currency} onChange={e=>{setCurrency(e.target.value as typeof currency);revised();}}>
       {["EUR","USD","GBP","CHF","JPY","KWD"].map(x=><option key={x}>{x}</option>)}
      </select>
     </label>
    </div>
    <button type="button" disabled={!actor||busy||!account.trim()||!portfolio.trim()}
     onClick={()=>void submit()}
     className="mt-5 rounded-xl bg-emerald-400 px-5 py-3 text-sm font-semibold text-slate-950 disabled:opacity-40">
      {busy?t.busy:t.action}</button>
   </>
  ):null}
  {!verified&&!review&&!canCreate&&!error&&<p className="mt-4 text-sm text-slate-300">{t.pending}</p>}
  {error&&<p role="alert" className="mt-4 text-sm text-amber-300">
    {error==="CONFLICT"?t.conflict:error==="NO_INTENT"?t.lacking:t.unavailable}</p>}
 </section>;
}
