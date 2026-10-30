import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ArrowRight, CheckCircle2, Clock3, FlaskConical, Info, Layers3, ShieldCheck, TrendingUp, BarChart3 } from "lucide-react";
import { resolveRequestSiteLang, withLangQuery } from "@/lib/i18n/requestSiteLang";
import { readInvestingWorkspaceStatus } from "@/lib/workspace/investingOverview";
import { isR1AccountReadEnabled } from "@/investing-core/server/accountsReadHttp";
import { WorkspaceShell, WorkspaceSection, WorkspaceTile } from "@/components/workspace/WorkspaceShell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Accueil | Syntrake",
  robots: { index: false, follow: false, noarchive: true },
};

const copy = {
  pt: {
    eyebrow: "O teu espaço de trabalho", title: "Bem-vindo ao teu SYNTRAKE.",
    intro: "Investing e Trading, na mesma conta e sem misturar as duas atividades. Explora cada área ao teu ritmo.",
    principle: "Sem preços fictícios, saldos inventados ou rentabilidade presumida.",
    explore: "Explorar a plataforma", areas: "As tuas áreas", areasIntro: "Tudo organizado, sem te obrigar a escolher uma única atividade.",
    investing: "Organiza os teus portfólios, objetivos, perfil e importações declaradas.",
    trading: "Um espaço separado para desenvolver estratégias e preparar o trading.",
    research: "Experimenta e avalia hipóteses com evidências e backtests quando estiver disponível.",
    markets: "Instrumentos, preços, históricos e notícias numa área própria, a partir do R3.",
    open: "Abrir área", ready: "R2 disponível", inactive: "Indisponível aqui", future: "Em desenvolvimento", planned: "Planeado", r3: "Próxima fase: R3",
    nextEyebrow: "Continuidade", next: "O que podes fazer agora", existing: "A tua estrutura Investing está disponível.",
    existingDetails: "Encontrámos uma conta com {n} portfólio(s). Os valores financeiros continuam por verificar.",
    noAccount: "Ainda não foi encontrada uma conta Investing.", noAccountDetails: "Quando quiseres, inicia a configuração progressiva do Investing.",
    multi: "Foram encontradas várias contas Investing.", multiDetails: "Escolhe e consulta as tuas contas na área Investing. Não selecionamos nenhuma automaticamente.",
    unavailable: "Não foi possível verificar o estado do Investing.", unavailableDetails: "Tenta novamente na área Investing. Não assumimos que a tua conta esteja vazia.",
    disabled: "A leitura do Investing não está disponível neste ambiente.", disabledDetails: "As funcionalidades protegidas continuam sujeitas às suas autorizações.",
    continue: "Continuar no Investing", activity: "Atividade recente", activityEmpty: "O Accueil ainda não apresenta um histórico integrado. Os teus registos reais permanecem nas páginas do Investing.",
    security: "Dados com proveniência", securityDetail: "Uma declaração manual não é saldo confirmado nem movimento financeiro.",
  },
  en: {
    eyebrow: "Your workspace", title: "Welcome to your SYNTRAKE.",
    intro: "Investing and Trading in one account, with both activities kept separate. Explore at your own pace.",
    principle: "No made-up prices, balances or performance.",
    explore: "Explore the platform", areas: "Your areas", areasIntro: "Everything organized without making you choose only one activity.",
    investing: "Manage portfolios, objectives, your profile and declared imports.",
    trading: "An independent space for developing strategies and preparing trading.",
    research: "Investigate and evaluate ideas with evidence and backtests when available.",
    markets: "Instruments, prices, history and news in their own space, starting at R3.",
    open: "Open area", ready: "R2 available", inactive: "Unavailable here", future: "In development", planned: "Planned", r3: "Next phase: R3",
    nextEyebrow: "Pick up where you left off", next: "What you can do now", existing: "Your Investing structure is available.",
    existingDetails: "An account with {n} portfolio(s) was observed. Financial figures remain unverified.",
    noAccount: "No Investing account was found.", noAccountDetails: "Start the progressive Investing setup when you are ready.",
    multi: "Multiple Investing accounts were found.", multiDetails: "Review your accounts in Investing. None is selected automatically.",
    unavailable: "Investing status could not be verified.", unavailableDetails: "Try again in Investing. We never treat a failed read as an empty account.",
    disabled: "Investing read access is unavailable here.", disabledDetails: "Protected features continue to require their own authorization.",
    continue: "Continue to Investing", activity: "Recent activity", activityEmpty: "The Home workspace does not yet have an integrated activity feed. Your actual records remain in Investing.",
    security: "Data with provenance", securityDetail: "A manual declaration is not a confirmed balance or a financial transaction.",
  },
  fr: {
    eyebrow: "Votre espace de travail", title: "Bienvenue dans votre SYNTRAKE.",
    intro: "Investing et Trading dans un même compte, avec deux activités séparées. Explorez à votre rythme.",
    principle: "Aucun prix, solde ou rendement inventé.",
    explore: "Explorer la plateforme", areas: "Vos espaces", areasIntro: "Tout est organisé, sans vous imposer une seule activité.",
    investing: "Organisez vos portefeuilles, objectifs, profil et importations déclarées.",
    trading: "Un espace indépendant pour développer des stratégies et préparer le trading.",
    research: "Étudiez et évaluez des idées avec des preuves et des backtests, lorsqu'ils seront disponibles.",
    markets: "Instruments, cours, historiques et actualités dans un espace dédié, à partir de R3.",
    open: "Ouvrir l'espace", ready: "R2 disponible", inactive: "Indisponible ici", future: "En développement", planned: "Prévu", r3: "Prochaine phase : R3",
    nextEyebrow: "Continuité", next: "Que faire maintenant", existing: "Votre structure Investing est disponible.",
    existingDetails: "Un compte avec {n} portefeuille(s) a été identifié. Les données financières restent non vérifiées.",
    noAccount: "Aucun compte Investing identifié.", noAccountDetails: "Commencez la configuration progressive d'Investing lorsque vous le souhaitez.",
    multi: "Plusieurs comptes Investing ont été identifiés.", multiDetails: "Consultez vos comptes dans Investing. Aucun n'est sélectionné automatiquement.",
    unavailable: "Impossible de vérifier l'état d'Investing.", unavailableDetails: "Réessayez dans Investing. Une erreur de lecture ne signifie jamais un compte vide.",
    disabled: "La lecture Investing n'est pas disponible ici.", disabledDetails: "Les fonctions protégées restent soumises à leurs autorisations.",
    continue: "Continuer vers Investing", activity: "Activité récente", activityEmpty: "L'Accueil ne dispose pas encore d'un historique d'activité intégré. Vos vrais enregistrements restent dans Investing.",
    security: "Données avec provenance", securityDetail: "Une déclaration manuelle n'est ni un solde confirmé ni une transaction financière.",
  },
} as const;

export default async function StartPage({
  searchParams,
}: { searchParams?: Promise<{lang?:string}> | {lang?:string} }) {
  const session = await auth();
  if (!session.userId || !session.sessionId)
    redirect("/sign-in?redirect_url=%2Fstart");
  const lang = await resolveRequestSiteLang(await searchParams);
  const tx = copy[lang];
  const href = (path: string) => withLangQuery(path, lang);
  // Preserve the original R1 product-entry security contract: the exact
  // same server-side read gate controls both /investing/accounts and its API.
  const link = (path: string) => withLangQuery(path, lang);
  const { userId } = session;
  const r1AccountsEnabled = isR1AccountReadEnabled(process.env);
  const setupTarget = r1AccountsEnabled ? link("/investing/accounts") : link("/start");
  const openSetupHref = userId ? setupTarget : link(`/sign-in?redirect_url=${encodeURIComponent(setupTarget)}`);
  const r1Label = {
    en: "View investing accounts",
    pt: "Ver contas de investimento",
    fr: "Voir les comptes d’investissement",
  }[lang];
  const state = await readInvestingWorkspaceStatus({
    userId: session.userId, sessionId: session.sessionId,
    getToken: () => session.getToken(),
  });
  const details = state.state === "observed" ? {
    title: tx.existing,
    details: tx.existingDetails.replace("{n}", String(state.portfolios)),
  } : state.state === "none" ? { title: tx.noAccount, details: tx.noAccountDetails }
    : state.state === "multiple" ? { title: tx.multi, details: tx.multiDetails }
    : state.state === "unavailable" ? { title: tx.unavailable, details: tx.unavailableDetails }
    : { title: tx.disabled, details: tx.disabledDetails };

  return (
    <WorkspaceShell lang={lang} area="home">
      <section className="relative overflow-hidden rounded-[28px] border border-[#745e3f]/40 bg-gradient-to-r from-[#22283b] via-[#17243a] to-[#102b36] px-7 py-10 sm:px-10 sm:py-12">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full border border-[#e9c68d]/20 bg-[#c99c54]/10 blur-2xl" />
        <div aria-hidden="true" className="pointer-events-none absolute bottom-[-120px] right-16 h-72 w-72 rounded-full border border-[#63afc3]/15 bg-[#367489]/15 blur-3xl" />
        <div className="relative max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#d1ad6e]/25 bg-[#d0aa6b]/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#e9c992]">
            <ShieldCheck size={15} aria-hidden="true" /> {tx.eyebrow}
          </div>
          <h1 className="mt-6 text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl lg:text-[42px]">{tx.title}</h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-[#bfccdf]">{tx.intro}</p>
          <a href="#areas" className="mt-7 inline-flex items-center gap-2 rounded-xl bg-[#d7ba82] px-5 py-3 text-sm font-semibold text-[#152037] transition-colors hover:bg-[#f0d4a1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            {tx.explore}<ArrowRight size={17} aria-hidden="true"/>
          </a>
        </div>
        <p className="relative mt-8 flex items-center gap-2 text-xs text-[#aab9cf]"><CheckCircle2 size={14} className="text-[#a6dbc3]" aria-hidden="true" />{tx.principle}</p>
      </section>

      <div id="areas">
        <WorkspaceSection title={tx.areas} eyebrow={tx.areasIntro}>
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
            <WorkspaceTile href={href("/investing")} icon={Layers3} title="Investing" description={tx.investing} tag={state.state === "disabled" || state.state === "unavailable" ? tx.inactive : tx.ready} cta={tx.open} accent="gold" />
            <WorkspaceTile href={href("/trading")} icon={TrendingUp} title="Trading" description={tx.trading} tag={tx.future} cta={tx.open} accent="blue" />
            <WorkspaceTile href={href("/research")} icon={FlaskConical} title="Research Lab" description={tx.research} tag={tx.planned} cta={tx.open} accent="purple" />
            <WorkspaceTile href={href("/markets")} icon={BarChart3} title="Market Data" description={tx.markets} tag={tx.r3} cta={tx.open} accent="teal" />
          </div>
        </WorkspaceSection>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <WorkspaceSection title={tx.next} eyebrow={tx.nextEyebrow}>
          <div className="h-full rounded-[22px] border border-[#293a54] bg-[#142139] p-6">
            <div className="flex items-start gap-4">
              <span className="rounded-xl border border-[#4d8a76]/30 bg-[#237c69]/15 p-3 text-[#9bdcc4]"><Layers3 aria-hidden="true" size={22}/></span>
              <div>
                <h3 className="font-semibold text-[#f5f7fc]">{details.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[#aebbd1]">{details.details}</p>
                <Link href={href("/investing")} className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#e8c995] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e8c995]">
                  {tx.continue}<ArrowRight size={16} aria-hidden="true" />
                </Link>
                {r1AccountsEnabled ? (
                  <div className="mt-3">
                    <Link href={openSetupHref} className="inline-flex items-center gap-2 text-xs font-medium text-[#9ac7ed] hover:text-white">
                      {r1Label}<ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </WorkspaceSection>
        <WorkspaceSection title={tx.activity}>
          <div className="h-full rounded-[22px] border border-[#293a54] bg-[#111d31] p-6">
            <Clock3 size={22} className="text-[#b5c4dc]" aria-hidden="true"/>
            <p className="mt-4 text-sm leading-7 text-[#acbad0]">{tx.activityEmpty}</p>
          </div>
        </WorkspaceSection>
      </div>

      <div className="mt-10 flex items-start gap-3 rounded-2xl border border-[#2b4351] bg-[#112532]/75 px-5 py-4">
        <Info size={18} className="mt-0.5 shrink-0 text-[#8bd6ce]" aria-hidden="true" />
        <p className="text-sm leading-6 text-[#b8c9d5]"><strong className="text-[#e3efef]">{tx.security}.</strong> {tx.securityDetail}</p>
      </div>
    </WorkspaceShell>
  );
}
