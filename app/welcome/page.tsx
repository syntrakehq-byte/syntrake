import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ArrowRight, Compass, Layers3, ShieldCheck, TrendingUp } from "lucide-react";
import { resolveRequestSiteLang, withLangQuery } from "@/lib/i18n/requestSiteLang";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Welcome | Syntrake",
  robots: { index: false, follow: false, noarchive: true },
};

const text = {
  pt: {
    eyebrow: "Conta criada", title: "Bem-vindo ao SYNTRAKE.",
    summary: "Um espaço para investir, investigar e explorar trading — sem misturar os teus dados e sem questionários obrigatórios logo à entrada.",
    investing: "Investe e acompanha os teus objetivos ao teu ritmo.",
    trading: "Explora Trading separadamente, à medida que as ferramentas chegam.",
    trust: "Podes configurar o Investing mais tarde. Não pedimos valores financeiros nesta etapa.",
    button: "Começar a explorar",
  },
  en: {
    eyebrow: "Account ready", title: "Welcome to SYNTRAKE.",
    summary: "A workspace for investing, research and trading — with separate financial activities and no mandatory questionnaire up front.",
    investing: "Invest and track your goals at your own pace.",
    trading: "Explore Trading separately as new tools become available.",
    trust: "You can set up Investing later. We do not ask for financial figures at this stage.",
    button: "Explore the workspace",
  },
  fr: {
    eyebrow: "Compte créé", title: "Bienvenue dans SYNTRAKE.",
    summary: "Un espace pour investir, rechercher et explorer le trading, avec des activités financières distinctes et sans questionnaire obligatoire.",
    investing: "Investissez et suivez vos objectifs à votre rythme.",
    trading: "Explorez Trading séparément au fur et à mesure de son développement.",
    trust: "Vous pourrez configurer Investing plus tard. Aucune donnée financière n'est demandée ici.",
    button: "Explorer la plateforme",
  },
} as const;

export default async function WelcomePage({
  searchParams,
}: { searchParams?: Promise<{lang?:string}> | {lang?:string} }) {
  const session = await auth();
  if (!session.userId || !session.sessionId)
    redirect("/sign-in?redirect_url=%2Fwelcome");
  const lang = await resolveRequestSiteLang(await searchParams);
  const t = text[lang];
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#090f1d] px-5 py-14 text-[#f3f5fb]">
      <div className="w-full max-w-[900px] overflow-hidden rounded-[30px] border border-[#5e4c38]/45 bg-gradient-to-br from-[#1b2a43] via-[#101b30] to-[#0d2630] p-7 shadow-[0_30px_100px_rgba(0,0,0,0.38)] sm:p-12">
        <Link href={withLangQuery("/start",lang)} className="inline-flex items-center gap-3 text-sm font-semibold tracking-[0.18em] text-[#e5cc9f]">
          <Compass aria-hidden="true" size={27}/> SYNTRAKE
        </Link>
        <div className="mt-12 inline-flex rounded-full border border-[#bf9b69]/30 bg-[#bd995a]/10 px-4 py-2 text-xs uppercase tracking-[0.2em] text-[#f0d49d]">{t.eyebrow}</div>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-5xl">{t.title}</h1>
        <p className="mt-5 max-w-2xl text-base leading-8 text-[#bfcee1]">{t.summary}</p>
        <div className="mt-9 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-[#536079]/40 bg-[#172a43]/70 p-5">
            <Layers3 aria-hidden="true" size={23} className="text-[#e8c58c]" />
            <h2 className="mt-3 text-lg font-semibold">Investing</h2>
            <p className="mt-2 text-sm leading-6 text-[#aebdd3]">{t.investing}</p>
          </div>
          <div className="rounded-2xl border border-[#536079]/40 bg-[#172a43]/70 p-5">
            <TrendingUp aria-hidden="true" size={23} className="text-[#9bbdff]" />
            <h2 className="mt-3 text-lg font-semibold">Trading</h2>
            <p className="mt-2 text-sm leading-6 text-[#aebdd3]">{t.trading}</p>
          </div>
        </div>
        <p className="mt-8 flex items-start gap-2 text-sm leading-6 text-[#a9c4be]">
          <ShieldCheck aria-hidden="true" size={19} className="mt-0.5 shrink-0" />
          {t.trust}
        </p>
        <Link href={withLangQuery("/start",lang)} className="mt-7 inline-flex items-center gap-2 rounded-xl bg-[#d7ba82] px-6 py-3 font-semibold text-[#152037] hover:bg-[#f0d4a1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          {t.button}<ArrowRight size={18} aria-hidden="true"/>
        </Link>
      </div>
    </main>
  );
}
