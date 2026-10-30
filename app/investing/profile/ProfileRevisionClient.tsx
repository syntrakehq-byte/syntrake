"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { SiteLang } from "@/lib/i18n/siteLanguage";

type Read = {
  state?: string;
  existing?: { accountId?: string | null; accountMultiplicity?: string; portfolioIds?: string[] } | null;
  financialTruth?: string;
  financialWrites?: boolean;
};
type Reply = {
  state?: string;
  accountId?: string;
  revisionId?: string;
  currentRevisionId?: string;
  verification?: string;
  version?: number;
  financialMovementsCreated?: boolean;
  error?: string;
};
type Mode = "initial" | "correction";
type Choice = "LOW" | "MEDIUM" | "HIGH" | "UNSPECIFIED";
type Horizon = "SHORT" | "MEDIUM" | "LONG" | "OPEN";
const copy = {
  pt: {
    title:"Perfil Investing — revisões", intro:"Regista os teus objetivos e a capacidade de risco. São declarações tuas, não valores verificados ou recomendações.",
    loading:"A consultar a tua conta...", blocked:"Não foi possível confirmar uma única conta e portfólio teus. Não foi efetuada nenhuma alteração.",
    initial:"Aplicar o primeiro perfil", correction:"Corrigir o perfil existente",
    mode:"Tipo de operação", objective:"Objetivo principal", currency:"Moeda", capital:"Capital declarado (opcional, não verificado)",
    horizon:"Horizonte", tolerance:"Tolerância ao risco", capacity:"Capacidade de suportar perdas",
    restrictions:"Restrições (opcionais, uma por linha)", missing:"Seleciona", save:"Guardar e aplicar perfil",
    working:"A guardar...", applied:"Revisão aplicada com sucesso", pending:"Revisão pendente: podes tentar aplicar a mesma revisão sem voltar a criá-la.",
    retry:"Aplicar revisão pendente", error:"Operação não confirmada. Não repitas sem verificar o estado.",
    noMoney:"Nenhum depósito, ordem ou movimento financeiro é criado.",
    guidance:"Se já aplicaste o primeiro perfil, seleciona «Corrigir». Se é a primeira vez, seleciona «Primeiro perfil».",
    back:"Voltar às contas", day:"Dias", open:"Sem horizonte fixo",
  },
  en: {
    title:"Investing profile — revisions", intro:"Record your goals and risk capacity. These are your declarations, not verified balances or advice.",
    loading:"Checking your account...", blocked:"Cannot verify one owned account and portfolio. No changes were made.",
    initial:"Apply first profile", correction:"Correct existing profile", mode:"Operation",
    objective:"Primary objective", currency:"Currency", capital:"Declared capital (optional, unverified)",
    horizon:"Horizon", tolerance:"Risk tolerance", capacity:"Capacity to bear losses",
    restrictions:"Restrictions (optional, one per line)", missing:"Choose", save:"Save and apply profile",
    working:"Saving...", applied:"Revision applied successfully", pending:"Revision pending. You may retry applying the same revision without creating another.",
    retry:"Apply pending revision", error:"Outcome not confirmed. Check the state before retrying.",
    noMoney:"No deposit, order, or financial movement is created.",
    guidance:"If you already applied the first profile, choose Correction; otherwise choose First profile.",
    back:"Return to accounts", day:"Days", open:"Open-ended",
  },
  fr: {
    title:"Profil Investing — révisions", intro:"Déclarez vos objectifs et capacité de risque. Ces données ne sont ni des soldes vérifiés ni des conseils.",
    loading:"Vérification de votre compte...", blocked:"Impossible de vérifier un seul compte et portefeuille vous appartenant. Aucune modification effectuée.",
    initial:"Appliquer le premier profil", correction:"Corriger le profil existant", mode:"Opération",
    objective:"Objectif principal", currency:"Devise", capital:"Capital déclaré (facultatif, non vérifié)",
    horizon:"Horizon", tolerance:"Tolérance au risque", capacity:"Capacité à supporter des pertes",
    restrictions:"Restrictions (facultatives, une par ligne)", missing:"Sélectionner", save:"Enregistrer et appliquer",
    working:"Enregistrement...", applied:"Révision appliquée", pending:"Révision en attente : vous pouvez appliquer la même révision sans en créer une nouvelle.",
    retry:"Appliquer la révision en attente", error:"Résultat non confirmé. Vérifiez l'état avant de recommencer.",
    noMoney:"Aucun dépôt, ordre ou mouvement financier n'est créé.",
    guidance:"Si un premier profil a déjà été appliqué, choisissez Correction. Sinon, Premier profil.",
    back:"Retour aux comptes", day:"Jours", open:"Sans date fixe",
  },
} satisfies Record<SiteLang, Record<string,string>>;

function moneyToMinor(raw: string, currency: string): string | null {
  const value = raw.trim().replace(",", ".");
  if (!value) return null;
  const digits = currency === "JPY" ? 0 : currency === "KWD" ? 3 : 2;
  const amountPattern = new RegExp("^(?:0|[1-9][0-9]{0,17})" + (digits ? "(?:\\.[0-9]{1," + digits + "})?" : "") + "$");
  if (!amountPattern.test(value)) throw Error("INVALID_MONEY");
  const [whole, fraction = ""] = value.split(".");
  return (BigInt(whole) * 10n ** BigInt(digits) +
    BigInt((fraction + "0".repeat(digits)).slice(0,digits) || "0")).toString();
}
function newRef(prefix: string): string {
  return prefix + crypto.randomUUID().replaceAll("-", "");
}

export default function ProfileRevisionClient({lang}:{lang:SiteLang}) {
  const t=copy[lang];
  const {userId,isLoaded}=useAuth();
  const [accountId,setAccountId]=useState<string|null>(null);
  const [readState,setReadState]=useState<"loading"|"ready"|"blocked">("loading");
  const [mode,setMode]=useState<Mode>("initial");
  const [objective,setObjective]=useState("");
  const [currency,setCurrency]=useState("");
  const [capital,setCapital]=useState("");
  const [horizon,setHorizon]=useState<Horizon|"">("");
  const [tolerance,setTolerance]=useState<Choice|"">("");
  const [capacity,setCapacity]=useState<Choice|"">("");
  const [restrictions,setRestrictions]=useState("");
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [pending,setPending]=useState<{accountId:string;revisionId:string}|null>(null);

  useEffect(()=>{
    if(!isLoaded||!userId){if(isLoaded)setReadState("blocked");return;}
    let active=true;
    setReadState("loading");setAccountId(null);
    void fetch("/api/investing/existing-account",{cache:"no-store",credentials:"same-origin"}).then(async response=>{
      if(!response.ok)throw Error("READ_FAILED");
      const data=await response.json() as Read;
      const owned=data.existing;
      if(data.state!=="EXISTING_ACCOUNT_REVIEW_REQUIRED" ||
        data.financialWrites!==false||data.financialTruth!=="UNAVAILABLE"||
        owned?.accountMultiplicity!=="ONE"||
        !owned.accountId||!Array.isArray(owned.portfolioIds)||owned.portfolioIds.length===0)
          throw Error("NO_UNIQUE_OWNED_ACCOUNT");
      if(active){setAccountId(owned.accountId);setReadState("ready");}
    }).catch(()=>{if(active)setReadState("blocked");});
    return ()=>{active=false;};
  },[isLoaded,userId]);

  async function send(body:object):Promise<Reply>{
    const response=await fetch("/api/investing/portfolio/onboarding",{
      method:"POST",credentials:"same-origin",cache:"no-store",
      headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
    });
    const data=await response.json() as Reply;
    if(!response.ok)throw Error(data.error||"HTTP_"+response.status);
    if(data.financialMovementsCreated!==false)throw Error("INVALID_FINANCIAL_RESPONSE");
    return data;
  }

  async function applyPending() {
    if(!pending||busy||readState!=="ready"||accountId!==pending.accountId)return;
    setBusy(true);setError(null);
    try{
      const applied=await send({operation:"APPLY_INITIAL_REVISION",accountId:pending.accountId,revisionId:pending.revisionId});
      if(applied.state!=="APPLIED"||applied.currentRevisionId!==pending.revisionId)throw Error("INVALID_APPLY_RESPONSE");
      setPending(null);setResult(t.applied+" · version "+String(applied.version??"?"));
      setMode("correction");
    }catch(e){setError((e instanceof Error?e.message:t.error)+" — "+t.error);}
    finally{setBusy(false);}
  }

  async function submit() {
    if(!accountId||readState!=="ready"||busy||pending||!objective.trim()||
       !currency||!horizon||!tolerance||!capacity)return;
    let declaredCapital:string|null;
    try{declaredCapital=moneyToMinor(capital,currency);}catch{setError("Invalid declared capital amount");return;}
    const revisionId=newRef("revision_");
    const idempotencyKey=newRef("idem_");
    const input={
      declaredCapital:declaredCapital===null?null:{currency,amountMinor:declaredCapital},
      objectives:[{id:newRef("objective_"),name:objective.trim(),targetMinor:null,currency,targetDate:null}],
      horizon,riskTolerance:tolerance,riskCapacity:capacity,
      liquidity:{currency,minimumMinor:null,needsWithinDays:null},
      restrictions:restrictions.split("\n").map(s=>s.trim()).filter(Boolean),
      plannedContributions:[],
    };
    setBusy(true);setError(null);setResult(null);
    try{
      if(mode==="initial"){
        const pendingRevision=await send({operation:"UPSERT_REVISION",accountId,revisionId,idempotencyKey,input});
        if(pendingRevision.revisionId!==revisionId||
          pendingRevision.state!=="PENDING"||pendingRevision.verification!=="UNVERIFIED")throw Error("INVALID_REVISION_RESPONSE");
        setPending({accountId,revisionId});
        const applied=await send({operation:"APPLY_INITIAL_REVISION",accountId,revisionId});
        if(applied.state!=="APPLIED"||applied.currentRevisionId!==revisionId)throw Error("INVALID_APPLY_RESPONSE");
        setPending(null);setResult(t.applied+" · version "+String(applied.version??"?"));
        setMode("correction");
      }else{
        const applied=await send({operation:"APPLY_CORRECTION",accountId,revisionId,idempotencyKey,input});
        if(applied.state!=="APPLIED"||applied.currentRevisionId!==revisionId)throw Error("INVALID_CORRECTION_RESPONSE");
        setResult(t.applied+" · version "+String(applied.version??"?"));
      }
    }catch(e){
      setError((e instanceof Error?e.message:t.error)+" — "+t.error);
    }finally{setBusy(false);}
  }

  return <main className="mx-auto max-w-3xl px-5 py-12 text-slate-100">
    <h1 className="text-3xl font-semibold">{t.title}</h1>
    <p className="mt-3 text-sm text-slate-300">{t.intro}</p>
    <p className="mt-3 text-sm text-amber-200">{t.noMoney}</p>
    {readState==="loading"?<p className="mt-8">{t.loading}</p>:
     readState==="blocked"?<p role="alert" className="mt-8 text-amber-200">{t.blocked}</p>:
     <section className="mt-8 space-y-5 rounded-xl border border-slate-700 bg-slate-900 p-6">
       <p className="text-xs text-slate-400">{t.guidance}</p>
       <fieldset className="flex flex-col gap-3">
         <legend className="mb-2 font-medium">{t.mode}</legend>
         <label className="flex gap-2"><input type="radio" checked={mode==="initial"} disabled={busy||!!pending}
           onChange={()=>setMode("initial")}/>{t.initial}</label>
         <label className="flex gap-2"><input type="radio" checked={mode==="correction"} disabled={busy||!!pending}
           onChange={()=>setMode("correction")}/>{t.correction}</label>
       </fieldset>
       <label className="block text-sm">{t.objective}
         <input className="mt-2 w-full rounded border border-slate-600 bg-slate-950 p-3" maxLength={120}
           value={objective} onChange={e=>setObjective(e.target.value)} />
       </label>
       <label className="block text-sm">{t.currency}
         <select className="mt-2 w-full rounded border border-slate-600 bg-slate-950 p-3" value={currency}
           onChange={e=>setCurrency(e.target.value)}><option value="">{t.missing}</option>
           {["EUR","USD","GBP","CHF","JPY","KWD"].map(c=><option key={c}>{c}</option>)}</select>
       </label>
       <label className="block text-sm">{t.capital}
         <input className="mt-2 w-full rounded border border-slate-600 bg-slate-950 p-3" inputMode="decimal"
           value={capital} onChange={e=>setCapital(e.target.value)} placeholder="1234.56"/>
       </label>
       <label className="block text-sm">{t.horizon}
         <select className="mt-2 w-full rounded border border-slate-600 bg-slate-950 p-3" value={horizon}
           onChange={e=>setHorizon(e.target.value as Horizon|"")}><option value="">{t.missing}</option>
           <option value="SHORT">0–3</option><option value="MEDIUM">3–10</option><option value="LONG">10+</option>
           <option value="OPEN">{t.open}</option></select>
       </label>
       {([["tolerance",t.tolerance,tolerance,setTolerance],["capacity",t.capacity,capacity,setCapacity]] as const).map(([key,label,value,setter])=>
         <label key={key} className="block text-sm">{label}
           <select className="mt-2 w-full rounded border border-slate-600 bg-slate-950 p-3" value={value}
             onChange={e=>setter(e.target.value as Choice|"")}><option value="">{t.missing}</option>
             <option value="LOW">Low / Faible / Baixa</option><option value="MEDIUM">Medium / Moyenne / Média</option>
             <option value="HIGH">High / Élevée / Alta</option><option value="UNSPECIFIED">Not specified / Non précisé / Não especificado</option>
           </select>
         </label>)}
       <label className="block text-sm">{t.restrictions}
         <textarea className="mt-2 w-full rounded border border-slate-600 bg-slate-950 p-3" rows={3}
           maxLength={5000} value={restrictions} onChange={e=>setRestrictions(e.target.value)}/>
       </label>
       {error&&<p role="alert" className="text-amber-300">{error}</p>}
       {result&&<p role="status" className="text-emerald-300">{result}</p>}
       {pending?<div className="space-y-3">
         <p className="text-amber-200">{t.pending}</p>
         <button type="button" disabled={busy} onClick={()=>void applyPending()}
           className="rounded bg-sky-400 px-5 py-3 font-semibold text-slate-950 disabled:opacity-40">
           {busy?t.working:t.retry}</button>
       </div>:<button type="button" disabled={busy||!objective.trim()||!currency||!horizon||!tolerance||!capacity}
         onClick={()=>void submit()} className="rounded bg-sky-400 px-5 py-3 font-semibold text-slate-950 disabled:opacity-40">
         {busy?t.working:t.save}</button>}
     </section>}
    <Link href="/investing/existing" className="mt-7 inline-block text-sky-300 underline">{t.back}</Link>
  </main>;
}
