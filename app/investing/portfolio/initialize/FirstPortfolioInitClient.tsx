"use client";

import {useAuth} from "@clerk/nextjs";
import Link from "next/link";
import {useEffect,useRef,useState} from "react";
import type {SiteLang} from "@/lib/i18n/siteLanguage";

type FirstReceipt=Readonly<{accountId:string;portfolioId:string;state:"STRUCTURE_CREATED_UNFUNDED";
  financialTruth:"UNAVAILABLE";ledgerMovementsCreated:false;brokerConfirmed:false;
  cashBalance:"UNAVAILABLE"}>;
type ExistingRead={state:"NO_OWN_ACCOUNT_OBSERVED"|"EXISTING_ACCOUNT_REVIEW_REQUIRED";
  existing:unknown;financialTruth:"UNAVAILABLE";financialWrites:false};
const tr={
 pt:{title:"Criar a primeira estrutura Investing",detail:"Só cria a conta e o portfolio vazios. Não deposita dinheiro, não compra ativos e não atribui saldo de €0.",
 account:"Nome da conta",portfolio:"Nome do portfolio",currency:"Moeda base",create:"Criar primeira conta",busy:"A verificar...",
 created:"Estrutura criada",none:"Ainda não existe uma conta Investing observada.",
 existing:"Já existe uma conta Investing. Consulta-a antes de qualquer nova criação.",
 unverified:"Cash e broker: INDISPONÍVEIS · Sem movimentos financeiros",
 missing:"Não foi possível confirmar as contas existentes. Criação bloqueada.",
 noIntent:"Escolhe primeiro um percurso Investing no onboarding.",
 blocked:"A criação não está autorizada neste ambiente.",already:"Já existe uma conta inicial ou um conflito de repetição.",
 retry:"Não foi possível completar esta operação; não sabemos se ocorreu. Verifica as contas antes de repetir.",
 back:"Voltar ao onboarding",review:"Ver contas existentes"},
 en:{title:"Create the first Investing structure",detail:"Creates only an unfunded account and portfolio. No deposit, order, or claimed zero balance.",
 account:"Account name",portfolio:"Portfolio name",currency:"Base currency",create:"Create first account",busy:"Checking...",
 created:"Structure created",none:"No existing Investing account observed.",
 existing:"An Investing account already exists. Review it before attempting a new one.",
 unverified:"Cash and broker: UNAVAILABLE · No financial movements",
 missing:"Could not verify existing accounts. Creation is blocked.",
 noIntent:"Complete the Investing onboarding choice first.",
 blocked:"Creation is not authorized in this environment.",already:"An initial account or replay conflict already exists.",
 retry:"Request outcome is unknown. Review existing accounts before retrying.",
 back:"Back to onboarding",review:"Review existing accounts"},
 fr:{title:"Créer la première structure Investing",detail:"Crée uniquement un compte et portefeuille non financés. Aucun dépôt, ordre ou solde zéro supposé.",
 account:"Nom du compte",portfolio:"Nom du portefeuille",currency:"Devise de base",create:"Créer le premier compte",busy:"Vérification...",
 created:"Structure créée",none:"Aucun compte Investing existant observé.",
 existing:"Un compte Investing existe déjà. Consultez-le avant toute création.",
 unverified:"Liquidités et courtier : INDISPONIBLES · Aucun mouvement financier",
 missing:"Impossible de vérifier les comptes existants. Création bloquée.",
 noIntent:"Déclarez d'abord votre choix Investing.",
 blocked:"Création non autorisée dans cet environnement.",already:"Un compte initial ou un conflit existe déjà.",
 retry:"Résultat de création incertain. Vérifiez les comptes avant toute nouvelle tentative.",
 back:"Retour à l'accueil Investing",review:"Consulter les comptes existants"},
} satisfies Record<SiteLang,Record<string,string>>;
function isReceipt(r:unknown):r is FirstReceipt{
 if(!r||typeof r!=="object")return false;
 const x=r as Partial<FirstReceipt>;
 return typeof x.accountId==="string"&&typeof x.portfolioId==="string"&&
  x.state==="STRUCTURE_CREATED_UNFUNDED"&&
  x.financialTruth==="UNAVAILABLE"&&x.cashBalance==="UNAVAILABLE"&&
  x.ledgerMovementsCreated===false&&x.brokerConfirmed===false;
}
export default function FirstPortfolioInitClient({lang}:{lang:SiteLang}){
 const t=tr[lang],{userId,isLoaded}=useAuth();
 const user=isLoaded?userId:null;
 const [status,setStatus]=useState<"CHECKING"|"NO_ACCOUNT"|"EXISTING"|"BLOCKED"|"CREATED">("CHECKING");
 const [checkedUser,setCheckedUser]=useState<string|null>(null);
 const [name,setName]=useState("Investing Principal"),[portfolio,setPortfolio]=useState("Long Term");
 const [currency,setCurrency]=useState<"EUR"|"USD"|"GBP"|"CHF"|"JPY"|"KWD">("EUR");
 const [receipt,setReceipt]=useState<{owner:string;value:FirstReceipt}|null>(null);
 const [error,setError]=useState<"NO_INTENT"|"BLOCKED"|"ALREADY"|"UNKNOWN"|null>(null);
 const [busy,setBusy]=useState(false);
 const attempt=useRef<string|null>(null);
 useEffect(()=>{
  if(!user)return;
  let mounted=true;const controller=new AbortController();
  void fetch("/api/investing/existing-account",{credentials:"same-origin",
    cache:"no-store",signal:controller.signal}).then(async r=>{
    if(!r.ok)throw Error("unavailable");
    const x:unknown=await r.json();
    if(!x||typeof x!=="object")throw Error("invalid");
    const d=x as Partial<ExistingRead>;
    if(d.financialTruth!=="UNAVAILABLE"||d.financialWrites!==false)throw Error("invalid");
    if(!mounted)return;
    setCheckedUser(user);
    if(d.state==="NO_OWN_ACCOUNT_OBSERVED"&&d.existing===null)setStatus("NO_ACCOUNT");
    else if(d.state==="EXISTING_ACCOUNT_REVIEW_REQUIRED")setStatus("EXISTING");
    else setStatus("BLOCKED");
  }).catch(()=>{if(mounted){setCheckedUser(user);setStatus("BLOCKED");}});
  return()=>{mounted=false;controller.abort();};
 },[user]);
 const own=user&&receipt?.owner===user?receipt.value:null;
 const effectiveStatus=user&&checkedUser===user?status:"CHECKING";
 const canSubmit=!!user&&effectiveStatus==="NO_ACCOUNT"&&!busy&&!error;
 function reset(){attempt.current=null;setError(null);}
 async function submit(){
  if(!canSubmit||!user)return;
  if(!attempt.current)attempt.current=crypto.randomUUID();
  setBusy(true);setError(null);
  try{
   const res=await fetch("/api/investing/portfolio/initialize",{
     method:"POST",credentials:"same-origin",cache:"no-store",
     headers:{"Content-Type":"application/json"},
     body:JSON.stringify({
       idempotencyKey:attempt.current,
       accountName:name,portfolioName:portfolio,baseCurrency:currency,
     }),
   });
   const data:unknown=await res.json();
   if(!data||typeof data!=="object")throw Error("bad");
   const o=data as {receipt?:unknown;error?:string};
   if(res.status===409){
    setStatus("BLOCKED");
    setError(o.error==="NO_ONBOARDING_INTENT"?"NO_INTENT":"ALREADY");
   }else if(res.status===403||res.status===404){
    setStatus("BLOCKED");setError("BLOCKED");
   }else if(!res.ok||!isReceipt(o.receipt)){
    setStatus("BLOCKED");setError("UNKNOWN");
   }else{
    setReceipt({owner:user,value:o.receipt});setStatus("CREATED");
   }
  }catch{setStatus("BLOCKED");setError("UNKNOWN");}
  finally{setBusy(false);}
 }
 return <main className="mx-auto max-w-3xl px-5 py-12 text-slate-100">
  <h1 className="text-3xl font-semibold">{t.title}</h1>
  <p className="mt-4 text-slate-300">{t.detail}</p>
  <section className="mt-8 rounded-xl border border-slate-700 bg-slate-900 p-6">
    {own?<div role="status">
      <p className="font-semibold text-emerald-300">{t.created}</p>
      <p className="mt-3 break-all text-sm">Account: {own.accountId}</p>
      <p className="mt-2 break-all text-sm">Portfolio: {own.portfolioId}</p>
      <p className="mt-3 text-amber-200">{t.unverified}</p>
    </div>:effectiveStatus==="CHECKING"?<p>{t.busy}</p>:
    effectiveStatus==="EXISTING"?<p className="text-amber-200">{t.existing}</p>:
    effectiveStatus==="BLOCKED"?<p role="alert" className="text-amber-200">
      {error==="NO_INTENT"?t.noIntent:error==="ALREADY"?t.already:
       error==="BLOCKED"?t.blocked:error==="UNKNOWN"?t.retry:t.missing}
    </p>:<div className="space-y-4">
      <p className="text-slate-300">{t.none}</p>
      <label className="block text-sm">{t.account}
        <input value={name} maxLength={80} onChange={e=>{setName(e.target.value);reset();}}
          className="mt-2 w-full rounded border border-slate-600 bg-slate-950 p-3"/>
      </label>
      <label className="block text-sm">{t.portfolio}
        <input value={portfolio} maxLength={80}
          onChange={e=>{setPortfolio(e.target.value);reset();}}
          className="mt-2 w-full rounded border border-slate-600 bg-slate-950 p-3"/>
      </label>
      <label className="block text-sm">{t.currency}
        <select value={currency} onChange={e=>{setCurrency(e.target.value as typeof currency);reset();}}
          className="mt-2 w-full rounded border border-slate-600 bg-slate-950 p-3">
          {["EUR","USD","GBP","CHF","JPY","KWD"].map(x=><option key={x}>{x}</option>)}
        </select>
      </label>
      <button disabled={!canSubmit||!name.trim()||!portfolio.trim()} type="button"
        onClick={()=>void submit()} className="rounded bg-sky-400 px-5 py-3 font-semibold text-slate-950 disabled:opacity-40">
        {busy?t.busy:t.create}
      </button>
    </div>}
  </section>
  <div className="mt-8 flex gap-7 text-sm text-sky-300">
    <Link href="/investing/start" className="underline">{t.back}</Link>
    <Link href="/investing/existing" className="underline">{t.review}</Link>
  </div>
 </main>;
}
