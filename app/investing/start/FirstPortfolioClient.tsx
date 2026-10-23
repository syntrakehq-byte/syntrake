"use client";
import {useAuth} from "@clerk/nextjs";
import {useEffect,useRef,useState} from "react";
import type {SiteLang} from "@/lib/i18n/siteLanguage";

type Receipt={accountId:string;portfolioId:string;
 state:"STRUCTURE_CREATED_UNFUNDED";financialTruth:"UNAVAILABLE";
 ledgerMovementsCreated:false;brokerConfirmed:false;cashBalance:"UNAVAILABLE"};
type Result={state:string;latest?:Receipt|null;receipt?:Receipt};
const tr={
 pt:{title:"Criar a minha conta e portfolio Investing",detail:"Esta operação cria apenas a estrutura financeira: conta própria, portfolio e subcontas contabilísticas vazias. Não deposita dinheiro, compra ativos ou movimenta o ledger.",
 name:"Nome da conta",portfolio:"Nome do portfolio",currency:"Moeda base",
 action:"Criar conta e portfolio",busy:"A verificar…",
 ready:"Estrutura criada e guardada",account:"Conta Investing",portfolioId:"Portfolio",
 unavailable:"Não foi possível verificar a conta. Nenhum saldo foi presumido.",
 conflict:"Esta conta já foi criada com outra configuração. Não criámos outra.",
 lacking:"Guarda primeiro a tua escolha Investing.",
 noBalance:"Cash: INDISPONÍVEL · Broker: NÃO CONFIRMADO · Sem movimentos financeiros",
 },
 en:{title:"Create my Investing account and portfolio",detail:"Creates only an account, portfolio and empty internal bookkeeping subaccounts. No deposits, purchases or ledger movements.",
 name:"Account name",portfolio:"Portfolio name",currency:"Base currency",
 action:"Create account and portfolio",busy:"Checking…",
 ready:"Structure created and saved",account:"Investing account",portfolioId:"Portfolio",
 unavailable:"Unable to verify the account; no balance was assumed.",
 conflict:"An initial account already exists with different details. No duplicate was created.",
 lacking:"Save your Investing choice first.",
 noBalance:"Cash: UNAVAILABLE · Broker: NOT CONFIRMED · No financial movements",
 },
 fr:{title:"Créer mon compte et portefeuille Investing",detail:"Crée uniquement le compte, le portefeuille et des sous-comptes comptables vides. Aucun dépôt, achat ou mouvement financier.",
 name:"Nom du compte",portfolio:"Nom du portefeuille",currency:"Devise de base",
 action:"Créer le compte et le portefeuille",busy:"Vérification…",
 ready:"Structure créée et enregistrée",account:"Compte Investing",portfolioId:"Portefeuille",
 unavailable:"Impossible de vérifier le compte ; aucun solde n'a été supposé.",
 conflict:"Un premier compte existe avec d'autres paramètres. Aucun doublon créé.",
 lacking:"Enregistrez d'abord votre choix Investing.",
 noBalance:"Cash : INDISPONIBLE · Courtier : NON CONFIRMÉ · Aucun mouvement financier",
 },
} satisfies Record<SiteLang,Record<string,string>>;
function isReceipt(x:unknown):x is Receipt{
 if(!x||typeof x!=="object")return false;
 const r=x as Partial<Receipt>;
 return typeof r.accountId==="string"&&typeof r.portfolioId==="string"&&
  r.state==="STRUCTURE_CREATED_UNFUNDED"&&r.financialTruth==="UNAVAILABLE"&&
  r.cashBalance==="UNAVAILABLE"&&r.ledgerMovementsCreated===false;
}
export default function FirstPortfolioClient({lang}:{lang:SiteLang}){
 const t=tr[lang],{userId,isLoaded}=useAuth();
 const actor=isLoaded?userId:null;
 const [account,setAccount]=useState("Investing Principal");
 const [portfolio,setPortfolio]=useState("Portfolio Longo Prazo");
 const [currency,setCurrency]=useState<"EUR"|"USD"|"GBP"|"CHF"|"JPY"|"KWD">("EUR");
 const [receipt,setReceipt]=useState<{owner:string;value:Receipt}|null>(null);
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
    if(active&&isReceipt(o.latest))setReceipt({owner:actor,value:o.latest});
   }catch{if(active)setError("UNAVAILABLE");}
  })();
  return()=>{active=false;controller.abort();};
 },[actor]);
 function revised(){
  attempt.current=null;setError(null);
 }
 async function submit(){
  if(!actor||busy)return;
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
   if(r.status===409){setError(result.error==="NO_ONBOARDING_INTENT"?"NO_INTENT":"CONFLICT");return;}
   if(!r.ok||!isReceipt(result.receipt))throw new Error("unavailable");
   setReceipt({owner:actor,value:result.receipt});
  }catch{setError("UNAVAILABLE");}
  finally{setBusy(false);}
 }
 const verified=actor&&receipt?.owner===actor?receipt.value:null;
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
  ):(
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
  )}
  {error&&<p role="alert" className="mt-4 text-sm text-amber-300">
    {error==="CONFLICT"?t.conflict:error==="NO_INTENT"?t.lacking:t.unavailable}</p>}
 </section>;
}
