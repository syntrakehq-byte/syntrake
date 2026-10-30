import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ArrowRight, ClipboardList, FileText, Layers3, Plus, ShieldCheck } from "lucide-react";
import { WorkspaceShell, WorkspaceSection } from "@/components/workspace/WorkspaceShell";
import { readInvestingWorkspaceStatus } from "@/lib/workspace/investingOverview";
import { resolveRequestSiteLang, withLangQuery } from "@/lib/i18n/requestSiteLang";
import { isR2COperationalReady } from "@/investing-core/server/onboardingTransport";
import { isR2C4PrivateWriteReady } from "@/investing-core/server/firstPortfolioPreviewHttp";
import { isOnboardingPortfolioReady } from "@/investing-core/server/onboardingPortfolioFromClerk";
import { isR2DImportReady } from "@/investing-core/server/importPreviewRuntime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Investing | Syntrake",
  robots: { index: false, follow: false, noarchive: true },
};

const texts = {
  pt: {
    kicker: "Área independente", title: "Investing",
    intro: "O teu espaço de investimento a médio e longo prazo. Consulta a estrutura e as declarações já guardadas; os preços e as valorizações ainda não estão disponíveis.",
    label: "Estrutura existente", unknown: "Não conseguimos confirmar os teus dados neste momento.",
    none: "Não encontramos uma conta Investing nesta consulta autenticada.",
    single: "Encontrámos uma conta Investing com {n} portfólio(s) associado(s).",
    multiple: "Tens várias contas Investing. Nenhuma é escolhida automaticamente.",
    disabled: "A leitura Investing está desativada neste ambiente.",
    actions: "Funcionalidades do R2", open: "Abrir", unavailable: "Indisponível aqui",
    existing: "Contas e portfólios", existingInfo: "Consulta estrutural de contas e portfólios da tua identidade.",
    profile: "Perfil e objetivos", profileInfo: "Revê as tuas declarações, objetivos e correções anteriores.",
    importer: "Importações declaradas", importerInfo: "Regista valores e posições não verificados, sem movimentos financeiros.",
    setup: "Primeiro portfólio", setupInfo: "Começa gradualmente a criar a estrutura Investing.",
    truth: "Declaração ≠ dinheiro verificado",
    truthInfo: "O R2 não fornece preços de mercado, rentabilidades nem confirma saldos. Estes dados exigirão fases posteriores.",
  },
  en: {
    kicker: "Independent workspace", title: "Investing",
    intro: "Your space for medium- and long-term investing. Review saved structures and declarations; market prices and valuations are not yet available.",
    label: "Existing structure", unknown: "We cannot verify your data right now.",
    none: "No Investing account was found in this authenticated read.",
    single: "An Investing account with {n} associated portfolio(s) was found.",
    multiple: "Multiple Investing accounts found. None is selected automatically.",
    disabled: "Investing read access is disabled in this environment.",
    actions: "R2 features", open: "Open", unavailable: "Unavailable here",
    existing: "Accounts and portfolios", existingInfo: "Read-only structure of accounts and portfolios owned by your identity.",
    profile: "Profile and goals", profileInfo: "Review your declarations, goals and prior corrections.",
    importer: "Declared imports", importerInfo: "Record unverified cash and holdings without financial postings.",
    setup: "First portfolio", setupInfo: "Progressively set up your Investing structure.",
    truth: "Declaration ≠ verified cash",
    truthInfo: "R2 does not provide market prices, performance or verified balances. Later phases will address these.",
  },
  fr: {
    kicker: "Espace indépendant", title: "Investing",
    intro: "Votre espace pour investir à moyen et long terme. Consultez vos structures et déclarations, sans inventer les cours ni les valorisations.",
    label: "Structure existante", unknown: "Impossible de vérifier vos données pour le moment.",
    none: "Aucun compte Investing trouvé dans cette consultation authentifiée.",
    single: "Un compte Investing avec {n} portefeuille(s) associé(s) a été identifié.",
    multiple: "Plusieurs comptes Investing identifiés. Aucun n'est sélectionné automatiquement.",
    disabled: "La lecture Investing est désactivée dans cet environnement.",
    actions: "Fonctionnalités R2", open: "Ouvrir", unavailable: "Indisponible ici",
    existing: "Comptes et portefeuilles", existingInfo: "Consultation structurelle des comptes et portefeuilles de votre identité.",
    profile: "Profil et objectifs", profileInfo: "Retrouvez vos déclarations, objectifs et corrections précédentes.",
    importer: "Importations déclarées", importerInfo: "Déclarez liquidités et positions non vérifiées, sans mouvement financier.",
    setup: "Premier portefeuille", setupInfo: "Commencez progressivement la configuration Investing.",
    truth: "Déclaration ≠ liquidités vérifiées",
    truthInfo: "R2 ne fournit ni cours, ni performance, ni solde confirmé. Les phases suivantes traiteront ces données.",
  },
} as const;

export default async function InvestingHub({
  searchParams,
}: { searchParams?: Promise<{lang?:string}> | {lang?:string} }) {
  const actor = await auth();
  if (!actor.userId || !actor.sessionId) redirect("/sign-in?redirect_url=%2Finvesting");
  const lang = await resolveRequestSiteLang(await searchParams);
  const t = texts[lang];
  const href = (target:string) => withLangQuery(target,lang);
  const [status, available] = await Promise.all([
    readInvestingWorkspaceStatus({
      userId: actor.userId, sessionId: actor.sessionId,
      getToken: () => actor.getToken(),
    }),
    Promise.resolve({
      review: isR2COperationalReady(process.env),
      profile: isOnboardingPortfolioReady(process.env),
      importer: isR2DImportReady(process.env),
      setup: isR2COperationalReady(process.env) && isR2C4PrivateWriteReady(process.env),
    }),
  ]);
  const summary = status.state === "observed" ? t.single.replace("{n}",String(status.portfolios))
    : status.state === "multiple" ? t.multiple
    : status.state === "none" ? t.none
    : status.state === "disabled" ? t.disabled : t.unknown;
  const cards = [
    { title:t.existing, description:t.existingInfo, path:"/investing/existing", enabled:available.review, icon:Layers3 },
    { title:t.profile, description:t.profileInfo, path:"/investing/profile", enabled:available.profile, icon:ClipboardList },
    { title:t.importer, description:t.importerInfo, path:"/investing/import", enabled:available.importer, icon:FileText },
    ...(status.state === "none" ? [{ title:t.setup, description:t.setupInfo, path:"/investing/start", enabled:available.setup, icon:Plus }] : []),
  ] as const;
  return (
    <WorkspaceShell lang={lang} area="investing">
      <section className="rounded-[25px] border border-[#6b543b]/35 bg-gradient-to-r from-[#282b3b] to-[#102336] px-7 py-10 sm:px-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.23em] text-[#ebcb94]">{t.kicker}</p>
        <h1 className="mt-3 text-4xl font-semibold text-white">{t.title}</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-[#bac8dc]">{t.intro}</p>
      </section>
      <div className="mt-6 flex items-start gap-4 rounded-2xl border border-[#293a54] bg-[#142037] px-5 py-5">
        <Layers3 aria-hidden="true" size={22} className="mt-0.5 shrink-0 text-[#e0c38e]" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#aebacf]">{t.label}</p>
          <p className="mt-2 text-sm leading-6 text-white">{summary}</p>
        </div>
      </div>
      <WorkspaceSection title={t.actions}>
        <div className="grid gap-4 md:grid-cols-2">
          {cards.map(({title,description,path,enabled,icon:Icon}) => (
            <div key={path} className="rounded-[22px] border border-[#283850] bg-[#152137] p-6">
              <div className="flex items-start justify-between gap-3">
                <span className="inline-flex rounded-xl border border-[#50617c]/45 bg-[#243450] p-3 text-[#e5cc9f]"><Icon aria-hidden="true" size={21} /></span>
                <span className={"rounded-full border px-3 py-1 text-xs " + (enabled ? "border-[#416e63] bg-[#24483d]/40 text-[#9bdac3]" : "border-[#455067] bg-[#253047] text-[#aeb7cc]")}>
                  {enabled ? "R2" : t.unavailable}
                </span>
              </div>
              <h2 className="mt-5 text-lg font-semibold">{title}</h2>
              <p className="mt-2 min-h-[48px] text-sm leading-6 text-[#aab9cd]">{description}</p>
              {enabled ? (
                <Link href={href(path)} className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#e8c994] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e8c994]">{t.open}<ArrowRight size={17} aria-hidden="true"/></Link>
              ) : (
                <p className="mt-5 text-sm text-[#8796ac]">{t.unavailable}</p>
              )}
            </div>
          ))}
        </div>
      </WorkspaceSection>
      <div className="mt-9 flex items-start gap-3 rounded-2xl border border-[#2e4d4b] bg-[#112832] px-5 py-4">
        <ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0 text-[#8cd3bd]" size={20} />
        <p className="text-sm leading-6 text-[#b5c7d2]"><strong className="text-white">{t.truth}.</strong> {t.truthInfo}</p>
      </div>
    </WorkspaceShell>
  );
}
