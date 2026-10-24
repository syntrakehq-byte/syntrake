"use client";

import { useAuth } from "@clerk/nextjs";
import { ArrowLeft, ArrowRight, ShieldCheck, ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SiteLang } from "@/lib/i18n/siteLanguage";
import type { OnboardingChoice, OnboardingEvent } from "@/investing-core/onboarding/onboardingIntent";

type Pathway=OnboardingChoice["pathway"];
type ResponseState={state:string;latest:OnboardingEvent|null;financialState:string;executionAuthority:string};
const tr={
 pt:{
  eyebrow:"SYNTRAKE · INVESTING",title:"Vamos conhecer a tua situação",
  subtitle:"O Investing é para acompanhamento e decisões de longo prazo. Não partilha contas, capital ou ordens com o Trading.",
  back:"Início",titleQuestion:"Já tens um portfolio de investimentos?",
  has:"Sim, já invisto",hasText:"Quero importar as posições e depois analisar se o portfolio é adequado.",
  needs:"Não, vou começar",needsText:"Quero definir objetivos, horizonte e risco antes de construir um portfolio.",
  source:"Como pretendes importar?",manual:"Introduzir manualmente",document:"Extrato ou ficheiro do broker",connect:"Ligar broker mais tarde",
  objective:"Objetivo principal",retirement:"Reforma",wealth:"Crescimento do património",purchase:"Compra importante",other:"Outro",
  horizon:"Horizonte (anos)",risk:"Capacidade de suportar perdas",low:"Baixa",medium:"Média",high:"Alta",
  save:"Guardar a minha escolha",saving:"A guardar…",saved:"Escolha guardada no Supabase Preview",
  disclaimer:"Este passo guarda apenas a tua intenção declarada. Ainda não cria uma conta financeira, portfolio, cash, depósitos ou recomendações. Não são enviadas ordens.",
  recent:"Última escolha guardada",none:"Ainda não tens uma escolha guardada.",reload:"Atualizar",
  error:"Não foi possível confirmar os dados. Nenhuma situação financeira foi presumida.",
  blocked:"O serviço ainda não está disponível para esta sessão ou ambiente.",
  noAccount:"Esta escolha não cria nem altera uma conta financeira.",reviewExisting:"Consultar contas Investing existentes (apenas leitura)",next:"Próxima etapa: criar conta e portfolio próprios, importar ou propor alternativas depois de validar os dados.",
  label:"R2-C · PREVIEW · APENAS INVESTING",
 },
 en:{
  eyebrow:"SYNTRAKE · INVESTING",title:"Tell us about your situation",
  subtitle:"Investing focuses on long-term decisions. It does not share accounts, capital, or orders with Trading.",
  back:"Home",titleQuestion:"Do you already have an investment portfolio?",
  has:"Yes, I invest already",hasText:"Import my positions and then assess portfolio suitability.",
  needs:"No, I am starting",needsText:"Define goals, horizon and risk before constructing a portfolio.",
  source:"How would you like to import?",manual:"Enter manually",document:"Broker statement or file",connect:"Connect broker later",
  objective:"Primary goal",retirement:"Retirement",wealth:"Wealth growth",purchase:"Major purchase",other:"Other",
  horizon:"Investment horizon (years)",risk:"Capacity to withstand losses",low:"Low",medium:"Medium",high:"High",
  save:"Save my choice",saving:"Saving…",saved:"Choice saved in Supabase Preview",
  disclaimer:"This saves only your declared intent. It does not create a financial account, portfolio, cash, deposits or recommendations, and it does not place orders.",
  recent:"Last saved choice",none:"No saved choice yet.",reload:"Refresh",
  error:"Unable to verify onboarding data. No financial state was assumed.",
  blocked:"Onboarding is unavailable for this session or environment.",
  noAccount:"This choice does not create or modify a financial account.",reviewExisting:"Review existing Investing accounts (read only)",next:"Next step: provision your own account and portfolio, then import or construct alternatives after validation.",
  label:"R2-C · PREVIEW · INVESTING ONLY",
 },
 fr:{
  eyebrow:"SYNTRAKE · INVESTING",title:"Parlons de votre situation",
  subtitle:"Investing concerne les décisions à long terme. Il ne partage ni comptes, ni capital, ni ordres avec Trading.",
  back:"Accueil",titleQuestion:"Avez-vous déjà un portefeuille d'investissement ?",
  has:"Oui, j'investis déjà",hasText:"Importer mes positions et vérifier ensuite l'adéquation du portefeuille.",
  needs:"Non, je débute",needsText:"Définir objectifs, horizon et risque avant de construire un portefeuille.",
  source:"Comment souhaitez-vous importer ?",manual:"Saisie manuelle",document:"Relevé ou fichier du courtier",connect:"Connecter un courtier plus tard",
  objective:"Objectif principal",retirement:"Retraite",wealth:"Développer mon patrimoine",purchase:"Achat important",other:"Autre",
  horizon:"Horizon (années)",risk:"Capacité à supporter des pertes",low:"Faible",medium:"Moyenne",high:"Élevée",
  save:"Enregistrer mon choix",saving:"Enregistrement…",saved:"Choix enregistré dans Supabase Preview",
  disclaimer:"Seule votre intention déclarée est enregistrée. Aucun compte financier, portefeuille, solde, dépôt ou recommandation n'est créé. Aucun ordre n'est envoyé.",
  recent:"Dernier choix enregistré",none:"Aucun choix enregistré.",reload:"Actualiser",
  error:"Impossible de vérifier les données. Aucun état financier n'a été supposé.",
  blocked:"Ce service n'est pas disponible pour cette session ou cet environnement.",
  noAccount:"Ce choix ne crée ni ne modifie de compte financier.",reviewExisting:"Voir les comptes Investing existants (lecture seule)",next:"Étape suivante : créer un compte et un portefeuille propres, puis importer ou construire des alternatives après vérification.",
  label:"R2-C · PREVIEW · INVESTING UNIQUEMENT",
 },
} satisfies Record<SiteLang,Record<string,string>>;

type Bound=Readonly<{userId:string;data:ResponseState}>;
function isState(v:unknown):v is ResponseState{
 if(!v||typeof v!=="object")return false;
 const o=v as Partial<ResponseState>;
 return typeof o.state==="string"&&typeof o.financialState==="string"
   &&typeof o.executionAuthority==="string"&&("latest" in o);
}
const inputClass="mt-2 w-full rounded-xl border border-slate-600 bg-slate-900/90 px-4 py-3 text-sm text-white focus:border-sky-400 focus:outline-none";
export default function InvestingOnboardingClient({lang,canCreateFirstPortfolio=false}:{lang:SiteLang;canCreateFirstPortfolio?:boolean}){
 const copy=tr[lang];
 const {isLoaded,userId}=useAuth();
 const actor=isLoaded?userId:null;
 const [pathway,setPathway]=useState<Pathway|null>(null);
 const [source,setSource]=useState<"MANUAL_ENTRY"|"DOCUMENT_EXTRACTED"|"BROKER_CONNECT_LATER">("MANUAL_ENTRY");
 const [objective,setObjective]=useState<"RETIREMENT"|"WEALTH_GROWTH"|"LARGE_PURCHASE"|"OTHER">("WEALTH_GROWTH");
 const [horizon,setHorizon]=useState("15");
 const [capacity,setCapacity]=useState<"LOW"|"MEDIUM"|"HIGH">("MEDIUM");
 const [record,setRecord]=useState<Bound|null>(null);
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [notice,setNotice]=useState<"SAVED"|"ERROR"|"BLOCKED"|null>(null);
 const [rev,setRev]=useState(0);
 const attempt=useRef<string|null>(null);
 const current=actor&&record?.userId===actor?record.data:null;

 useEffect(()=>{
   if(!actor)return;
   let live=true;const controller=new AbortController();
   void (async()=>{
    try{
     const res=await fetch("/api/investing/onboarding",{
      method:"GET",credentials:"same-origin",cache:"no-store",
      headers:{Accept:"application/json"},signal:controller.signal,
     });
     const data:unknown=await res.json();
     if(!res.ok||!isState(data))throw new Error("unavailable");
     if(live)setRecord({userId:actor,data});
    }catch{if(live){setRecord(null);setNotice("ERROR");}}
    finally{if(live)setLoading(false);}
   })();
   return ()=>{live=false;controller.abort();};
 },[actor,rev]);

 const resetAttempt=useCallback(()=>{attempt.current=null;setNotice(null);},[]);
 function choose(path:Pathway){setPathway(path);resetAttempt();}
 async function submit(){
  if(!actor||!pathway||saving)return;
  const n=Number(horizon);
  if(pathway==="NEEDS_PORTFOLIO"&&(!Number.isInteger(n)||n<1||n>60)){setNotice("ERROR");return;}
  const choice:OnboardingChoice=pathway==="HAS_PORTFOLIO"
   ?{pathway,importSource:source}
   :{pathway,objective,horizonYears:n,lossCapacity:capacity};
  if(!attempt.current)attempt.current=crypto.randomUUID();
  const key=attempt.current;
  setSaving(true);setNotice(null);
  try{
   const res=await fetch("/api/investing/onboarding",{
     method:"POST",cache:"no-store",credentials:"same-origin",
     headers:{"Content-Type":"application/json",Accept:"application/json"},
     body:JSON.stringify({idempotencyKey:key,choice}),
   });
   const value:unknown=await res.json();
   if(!res.ok||!isState(value)){setNotice(res.status===403||res.status===404?"BLOCKED":"ERROR");return;}
   setRecord({userId:actor,data:value});
   setNotice("SAVED");
  }catch{setNotice("ERROR");}
  finally{setSaving(false);}
 }

 return (
 <main className="min-h-screen bg-slate-950 text-slate-100">
 <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-20">
 <header className="flex flex-wrap items-center justify-between gap-4">
 <Link className="flex items-center gap-2 text-sm text-slate-300 hover:text-white" href="/start">
  <ArrowLeft size={17}/>{copy.back}</Link>
 <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-4 py-2 text-xs font-semibold tracking-wider text-sky-200">{copy.label}</span>
 </header>
 <section className="mt-14 max-w-3xl">
  <p className="text-xs font-bold tracking-[0.25em] text-sky-300">{copy.eyebrow}</p>
  <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">{copy.title}</h1>
  <p className="mt-5 text-lg leading-relaxed text-slate-300">{copy.subtitle}</p>
 </section>
 <section className="mt-12">
 <h2 className="text-2xl font-semibold">{copy.titleQuestion}</h2>
 <div className="mt-6 grid gap-4 md:grid-cols-2">
  {([
   {key:"HAS_PORTFOLIO" as const,title:copy.has,body:copy.hasText},
   {key:"NEEDS_PORTFOLIO" as const,title:copy.needs,body:copy.needsText},
  ]).map(option=>(
   <button type="button" onClick={()=>choose(option.key)} key={option.key}
    aria-pressed={pathway===option.key}
    className={"rounded-2xl border p-7 text-left transition-colors "+(pathway===option.key?
     "border-sky-400 bg-sky-950/80 shadow-lg shadow-sky-950/50":"border-slate-700 bg-slate-900 hover:border-slate-500")}>
    <div className="flex items-center justify-between gap-3"><span className="text-xl font-bold">{option.title}</span>
    <ArrowRight size={20} className="text-sky-400"/></div>
    <p className="mt-3 leading-relaxed text-slate-300">{option.body}</p>
   </button>
  ))}
 </div>
 </section>
 {pathway&&(
 <section className="mt-8 rounded-2xl border border-slate-700 bg-slate-900/80 p-7">
 {pathway==="HAS_PORTFOLIO"?(
 <label className="block text-sm font-semibold">{copy.source}
  <select value={source} onChange={e=>{setSource(e.target.value as typeof source);resetAttempt();}} className={inputClass}>
   <option value="MANUAL_ENTRY">{copy.manual}</option>
   <option value="DOCUMENT_EXTRACTED">{copy.document}</option>
   <option value="BROKER_CONNECT_LATER">{copy.connect}</option>
  </select>
 </label>
 ):(
 <div className="grid gap-5 md:grid-cols-3">
 <label className="text-sm font-semibold">{copy.objective}
  <select value={objective} onChange={e=>{setObjective(e.target.value as typeof objective);resetAttempt();}} className={inputClass}>
   <option value="RETIREMENT">{copy.retirement}</option>
   <option value="WEALTH_GROWTH">{copy.wealth}</option>
   <option value="LARGE_PURCHASE">{copy.purchase}</option>
   <option value="OTHER">{copy.other}</option>
  </select>
 </label>
 <label className="text-sm font-semibold">{copy.horizon}
  <input type="number" min={1} max={60} step={1} value={horizon}
   onChange={e=>{setHorizon(e.target.value);resetAttempt();}} className={inputClass}/>
 </label>
 <label className="text-sm font-semibold">{copy.risk}
  <select value={capacity} onChange={e=>{setCapacity(e.target.value as typeof capacity);resetAttempt();}} className={inputClass}>
   <option value="LOW">{copy.low}</option>
   <option value="MEDIUM">{copy.medium}</option>
   <option value="HIGH">{copy.high}</option>
  </select>
 </label>
 </div>
 )}
 <button type="button" disabled={!actor||saving} onClick={()=>void submit()}
  className="mt-7 inline-flex items-center gap-3 rounded-xl bg-sky-500 px-6 py-3 font-semibold text-slate-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40">
  <ClipboardCheck size={20}/>{saving?copy.saving:copy.save}
 </button>
 </section>
 )}
 <section className="mt-9 rounded-2xl border border-slate-700 bg-slate-900/60 p-7" aria-live="polite">
 <div className="flex flex-wrap items-center justify-between gap-3">
  <h2 className="font-semibold">{copy.recent}</h2>
  <button className="text-sm text-sky-300 underline disabled:opacity-40" disabled={loading}
   onClick={()=>{setLoading(true);setRev(v=>v+1);}}>{copy.reload}</button>
 </div>
 {loading?<p className="mt-3 text-slate-400">…</p>
  :current?.latest?<p className="mt-3 text-emerald-200">{copy.saved} — {current.latest.choice.pathway==="HAS_PORTFOLIO"?copy.has:copy.needs}</p>
  :<p className="mt-3 text-slate-300">{copy.none}</p>}
 {notice==="SAVED"&&<p className="mt-3 text-sm text-emerald-300">{copy.saved}</p>}
 {notice==="ERROR"&&<p role="alert" className="mt-3 text-sm text-amber-300">{copy.error}</p>}
 {notice==="BLOCKED"&&<p role="alert" className="mt-3 text-sm text-amber-300">{copy.blocked}</p>}
 <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-amber-300">{copy.noAccount}</p>
 </section>
 <aside className="mt-8 rounded-2xl border border-sky-500/20 bg-sky-900/15 p-7 text-sm leading-relaxed text-slate-300">
  <p className="flex items-center gap-2 font-semibold text-sky-200"><ShieldCheck size={18}/>{copy.disclaimer}</p>
  <p className="mt-4">{copy.next}</p>
  <Link href="/investing/existing" className="mt-4 inline-block text-sky-300 underline">{copy.reviewExisting}</Link>
  {canCreateFirstPortfolio&&current?.latest&&<Link href="/investing/portfolio/initialize" className="ml-6 mt-4 inline-block text-emerald-300 underline">{copy.next}</Link>}
 </aside>
 </div>
 </main>
 );
}
