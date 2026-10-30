import { ArrowRight, BarChart3, FlaskConical, Info, TrendingUp } from "lucide-react";
import Link from "next/link";
import { WorkspaceSection, WorkspaceShell, type WorkspaceArea } from "@/components/workspace/WorkspaceShell";
import { withLangQuery } from "@/lib/i18n/requestSiteLang";
import type { SiteLang } from "@/lib/i18n/siteLanguage";

type ComingArea = Extract<WorkspaceArea, "trading" | "research" | "markets">;
const shared = {
  pt: {
    status: "Em desenvolvimento", planned: "Previsto, ainda indisponível",
    items: "Estrutura prevista", explain: "As funcionalidades abaixo são apenas a organização futura. Não existem operações, preços ou resultados simulados.",
    safe: "A área está separada do Investing. Nenhuma ação financeira está disponível nesta página.",
    back: "Voltar ao Accueil",
  },
  en: {
    status: "In development", planned: "Planned, not available yet",
    items: "Planned structure", explain: "These are future sections only. No simulated trades, prices or results are displayed.",
    safe: "This area remains separate from Investing. No financial actions are available on this page.",
    back: "Back to Home",
  },
  fr: {
    status: "En développement", planned: "Prévu, pas encore disponible",
    items: "Structure prévue", explain: "Les éléments ci-dessous sont prévus. Aucune opération, cotation ou performance fictive n'est affichée.",
    safe: "Cet espace reste séparé d'Investing. Aucune action financière n'est disponible sur cette page.",
    back: "Retour à l'Accueil",
  },
} as const;
const areas = {
  trading: {
    title: "Trading",
    tags: ["R6", "R7"],
    items: {
      pt: ["Estratégias e controlo de risco", "Paper trading", "Execução futura"],
      en: ["Strategies and risk controls", "Paper trading", "Future execution"],
      fr: ["Stratégies et contrôle des risques", "Paper trading", "Exécution future"],
    },
    descriptions: {
      pt: "Espaço independente para investigação operacional e trading. Ainda não há motor de execução nem posições reais.",
      en: "An independent space for operational research and trading. No execution engine or real positions yet.",
      fr: "Un espace indépendant pour préparer le trading. Aucun moteur d'exécution ni position réelle pour le moment.",
    },
    icon: TrendingUp,
    accent: "from-[#20314e] to-[#111d32]",
  },
  research: {
    title: "Research Lab",
    tags: ["R3", "R5"],
    items: {
      pt: ["Investigações e hipóteses", "Backtests reproduzíveis", "Avaliação e comparação"],
      en: ["Research and hypotheses", "Reproducible backtests", "Evaluation and comparison"],
      fr: ["Recherche et hypothèses", "Backtests reproductibles", "Évaluation et comparaison"],
    },
    descriptions: {
      pt: "Laboratório de investigação com critérios verificáveis. Não apresentamos backtests que ainda não foram realizados.",
      en: "A research lab built around verifiable evidence. We do not display backtests that have not been run.",
      fr: "Un laboratoire fondé sur des preuves vérifiables. Aucun backtest non exécuté n'est affiché.",
    },
    icon: FlaskConical,
    accent: "from-[#2a2745] to-[#141b33]",
  },
  markets: {
    title: "Market Data",
    tags: ["R3"],
    items: {
      pt: ["Instrumentos e preços", "Históricos e câmbio", "Notícias e visão dos mercados"],
      en: ["Instruments and prices", "History and foreign exchange", "Market news and overview"],
      fr: ["Instruments et cours", "Historique et change", "Actualités et aperçu des marchés"],
    },
    descriptions: {
      pt: "Preços, históricos e notícias pertencem aqui, não ao Accueil. A integração com fontes reais será desenvolvida no R3.",
      en: "Prices, history and news belong here, not on Home. Verified-source integration starts in R3.",
      fr: "Cours, historiques et actualités figurent ici, pas dans l'Accueil. L'intégration des sources réelles commencera en R3.",
    },
    icon: BarChart3,
    accent: "from-[#153a41] to-[#112637]",
  },
} as const;

export function UpcomingArea({lang,area}:{lang:SiteLang;area:ComingArea}) {
  const t=shared[lang],config=areas[area],Icon=config.icon;
  return (
    <WorkspaceShell lang={lang} area={area}>
      <section className={"rounded-[26px] border border-[#33465e] bg-gradient-to-br px-7 py-11 sm:px-10 " + config.accent}>
        <div className="flex items-start justify-between gap-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#e9c68b]">{t.status} · {config.tags.join(" / ")}</p>
            <h1 className="mt-4 text-4xl font-semibold text-white">{config.title}</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-[#c0cce0]">{config.descriptions[lang]}</p>
          </div>
          <span className="hidden shrink-0 rounded-2xl border border-white/10 bg-white/5 p-5 text-[#d7c494] sm:block"><Icon size={38} aria-hidden="true" strokeWidth={1.6}/></span>
        </div>
      </section>
      <WorkspaceSection title={t.items} eyebrow={t.explain}>
        <div className="grid gap-4 lg:grid-cols-3">
          {config.items[lang].map((label,index)=>(
            <div key={label} className="min-h-40 rounded-[20px] border border-[#293850] bg-[#152138] p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#c9aa78]">0{index+1}</p>
              <h2 className="mt-4 text-base font-semibold text-white">{label}</h2>
              <p className="mt-2 text-xs text-[#9daec5]">{t.planned}</p>
            </div>
          ))}
        </div>
      </WorkspaceSection>
      <div className="mt-10 flex items-start gap-3 rounded-2xl border border-[#2c4452] bg-[#122433] p-5">
        <Info size={19} className="mt-0.5 shrink-0 text-[#8cd2ce]" aria-hidden="true"/>
        <p className="text-sm leading-6 text-[#b6c7d6]">{t.safe}</p>
      </div>
      <Link href={withLangQuery("/start",lang)} className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-[#e9c990] hover:text-white">{t.back}<ArrowRight size={17} aria-hidden="true"/></Link>
    </WorkspaceShell>
  );
}
