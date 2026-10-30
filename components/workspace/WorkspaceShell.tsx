import type { ReactNode } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import {
  ArrowUpRight, BarChart3, Compass, FlaskConical, Home, Layers3,
  ShieldCheck, TrendingUp, type LucideIcon,
} from "lucide-react";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { withLangQuery } from "@/lib/i18n/requestSiteLang";
import type { SiteLang } from "@/lib/i18n/siteLanguage";

export type WorkspaceArea = "home" | "investing" | "trading" | "research" | "markets";

const translations = {
  pt: {
    navigation: "Plataforma", home: "Accueil", investing: "Investing", trading: "Trading",
    research: "Research Lab", markets: "Market Data", account: "A minha conta",
    private: "Área privada", banner: "Investing e Trading independentes",
    subtitle: "Uma conta, duas atividades financeiras separadas.",
  },
  en: {
    navigation: "Platform", home: "Home", investing: "Investing", trading: "Trading",
    research: "Research Lab", markets: "Market Data", account: "My account",
    private: "Private workspace", banner: "Investing and Trading stay separate",
    subtitle: "One account, two independent financial activities.",
  },
  fr: {
    navigation: "Plateforme", home: "Accueil", investing: "Investing", trading: "Trading",
    research: "Research Lab", markets: "Market Data", account: "Mon compte",
    private: "Espace privé", banner: "Investing et Trading restent séparés",
    subtitle: "Un compte, deux activités financières indépendantes.",
  },
} as const;

const nav: readonly { key: WorkspaceArea; href: string; icon: LucideIcon }[] = [
  { key: "home", href: "/start", icon: Home },
  { key: "investing", href: "/investing", icon: Layers3 },
  { key: "trading", href: "/trading", icon: TrendingUp },
  { key: "research", href: "/research", icon: FlaskConical },
  { key: "markets", href: "/markets", icon: BarChart3 },
];

export function WorkspaceShell({
  lang, area, children,
}: { lang: SiteLang; area: WorkspaceArea; children: ReactNode }) {
  const tx = translations[lang];
  return (
    <div className="min-h-screen bg-[#090f1d] text-[#f1f4fa]">
      <div className="mx-auto flex min-h-screen max-w-[1800px] flex-col lg:flex-row">
        <aside className="shrink-0 border-b border-[#222d43] bg-[#0b1323] lg:sticky lg:top-0 lg:h-screen lg:w-[248px] lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between px-5 py-6 lg:px-6 lg:py-8">
            <Link className="group inline-flex items-center gap-3" href={withLangQuery("/start", lang)} aria-label="SYNTRAKE — Accueil">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#caad70]/30 bg-[#1f2836] text-[#efcf90]">
                <Compass aria-hidden="true" size={24} strokeWidth={1.7} />
              </span>
              <span>
                <span className="block font-semibold tracking-[0.17em] text-[#f3e4c6]">SYNTRAKE</span>
                <span className="block text-[10px] uppercase tracking-[0.21em] text-[#8191ad]">Workspace</span>
              </span>
            </Link>
            <span className="text-[11px] text-[#8996b1] lg:hidden">{tx.private}</span>
          </div>
          <nav aria-label={tx.navigation} className="flex gap-1 overflow-x-auto px-4 pb-4 lg:block lg:space-y-1 lg:px-3 lg:pb-0">
            {nav.map(({ key, href, icon: Icon }) => {
              const active = key === area;
              return (
                <Link
                  key={key}
                  href={withLangQuery(href, lang)}
                  aria-current={active ? "page" : undefined}
                  className={
                    "group flex min-w-max items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d7bc81] " +
                    (active
                      ? "border-[#bd9a5c]/30 bg-[#302c2c] text-[#f5ddb0]"
                      : "border-transparent text-[#a2b0c9] hover:border-[#273653] hover:bg-[#172338] hover:text-white")
                  }
                >
                  <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                  <span>{tx[key]}</span>
                </Link>
              );
            })}
          </nav>
          <div className="hidden px-5 pb-8 pt-12 lg:absolute lg:bottom-0 lg:block lg:w-[248px]">
            <div className="rounded-2xl border border-[#2d3a52] bg-[#111d31] p-4">
              <ShieldCheck size={20} className="text-[#8fd7bf]" aria-hidden="true" />
              <p className="mt-3 text-xs font-semibold text-[#e9edf5]">{tx.banner}</p>
              <p className="mt-1 text-xs leading-5 text-[#8f9eb9]">{tx.subtitle}</p>
            </div>
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <header className="flex min-h-[76px] items-center justify-between gap-3 border-b border-[#222d43] bg-[#0d1628]/95 px-5 sm:px-8">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-[#cfb37c]">{tx.private}</p>
              <p className="mt-1 truncate text-sm font-medium text-[#cad3e2]">{tx[area]}</p>
            </div>
            <div className="flex items-center gap-3 sm:gap-5">
              <Suspense fallback={<span className="text-xs text-[#98a6bd]">{lang.toUpperCase()}</span>}>
                <LanguageSwitcher compact />
              </Suspense>
              <div className="h-6 w-px bg-[#2c3850]" aria-hidden="true" />
              <UserButton afterSignOutUrl="/" />
            </div>
          </header>
          <main id="workspace-content" className="mx-auto w-full max-w-[1360px] px-5 pb-20 pt-8 sm:px-8 lg:px-10 lg:pt-10">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

export function WorkspaceSection({
  eyebrow, title, action, children,
}: { eyebrow?: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-10" aria-label={title}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          {eyebrow && <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.23em] text-[#bfa06b]">{eyebrow}</p>}
          <h2 className="text-xl font-semibold tracking-tight text-[#f1f4fa] sm:text-2xl">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function WorkspaceTile({
  icon: Icon, title, description, tag, href, accent = "gold", cta,
}: {
  icon: LucideIcon; title: string; description: string; tag: string; href: string;
  accent?: "gold" | "blue" | "purple" | "teal"; cta: string;
}) {
  const accentClass = {
    gold: "border-[#bd9c65]/30 bg-[#b89351]/15 text-[#f3d19a]",
    blue: "border-[#559df4]/30 bg-[#3278d8]/15 text-[#9cbdff]",
    purple: "border-[#a68bec]/30 bg-[#8262ca]/15 text-[#c7afff]",
    teal: "border-[#5fbdab]/30 bg-[#2b917f]/15 text-[#a0e2d2]",
  }[accent];
  return (
    <Link href={href} className="group flex min-h-[224px] flex-col rounded-[22px] border border-[#273650] bg-gradient-to-br from-[#17243c] to-[#101b2f] p-6 transition-colors hover:border-[#74829c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d7bc81]">
      <div className="flex items-start justify-between gap-4">
        <span className={"flex h-12 w-12 items-center justify-center rounded-2xl border " + accentClass}><Icon aria-hidden="true" size={23} strokeWidth={1.8} /></span>
        <span className="rounded-full border border-[#36455f] bg-[#1c2a40] px-3 py-1 text-[11px] text-[#b2bed0]">{tag}</span>
      </div>
      <h3 className="mt-5 text-lg font-semibold text-[#f4f6fb]">{title}</h3>
      <p className="mt-2 flex-1 text-sm leading-6 text-[#a1afc5]">{description}</p>
      <span className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-[#f0d3a0] group-hover:text-white">
        {cta}<ArrowUpRight size={16} aria-hidden="true" />
      </span>
    </Link>
  );
}
