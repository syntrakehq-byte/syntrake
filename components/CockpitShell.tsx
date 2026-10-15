"use client";

import React from "react";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useSiteLanguage } from "@/components/SiteLanguageProvider";
import { pickByLang } from "@/lib/i18n/siteLanguage";
import type { AccessTrialState } from "@/lib/signalcore/accessClientShared";

function classNames(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ");
}

export default function CockpitShell({
  title,
  subtitle,
  productBadge,
  right,
  children,
  active,
  items,
  onNav,
  onLockedNav,
  homeHref,
  isPaid,
  trial,
  showPageHeader = true,
}: {
  title: string;
  subtitle?: string;
  productBadge?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  active: string;
  items: Array<{ key: string; label: string; locked?: boolean }>;
  onNav: (k: string) => void;
  onLockedNav?: (k: string) => void;
  homeHref?: string;
  isPaid: boolean;
  trial: AccessTrialState | null;
  showPageHeader?: boolean;
}) {
  const { lang } = useSiteLanguage();
  const [mobileMoreOpen, setMobileMoreOpen] = React.useState(false);
  const isDaily = active === "daily";
  const isTradingSurface = ["trading", "opportunities", "execution", "risk", "journal", "alerts"].includes(active);
  const mobilePrimaryItems = items.length > 5 ? items.slice(0, 4) : items;
  const mobileMoreItems = items.length > 5 ? items.slice(4) : [];
  const hasMobileMore = mobileMoreItems.length > 0;
  const mobileMoreActive = mobileMoreItems.some((it) => it.key === active);
  const mobileGridClass = hasMobileMore || mobilePrimaryItems.length >= 5
    ? "grid-cols-5"
    : mobilePrimaryItems.length === 4
      ? "grid-cols-4"
      : mobilePrimaryItems.length === 3
        ? "grid-cols-3"
        : mobilePrimaryItems.length === 2
          ? "grid-cols-2"
          : "grid-cols-1";

  const trialLabel = !isPaid
    ? trial?.active
      ? pickByLang(lang, {
          en: `${Math.max(1, Number(trial.remainingDays || trial.days || 1))}d Trial`,
          pt: `${Math.max(1, Number(trial.remainingDays || trial.days || 1))}d Trial`,
          es: `${Math.max(1, Number(trial.remainingDays || trial.days || 1))}d Trial`,
          fr: `${Math.max(1, Number(trial.remainingDays || trial.days || 1))}j Trial`,
          de: `${Math.max(1, Number(trial.remainingDays || trial.days || 1))}T Trial`,
          it: `${Math.max(1, Number(trial.remainingDays || trial.days || 1))}g Trial`,
        })
      : !trial?.started
        ? pickByLang(lang, {
            en: "7-Day Trial",
            pt: "Trial 7 Dias",
            es: "Trial 7 Dias",
            fr: "Essai 7 Jours",
            de: "7-Tage-Test",
            it: "Trial 7 Giorni",
          })
        : null
    : null;
  const accountBadgeLabel = isPaid ? "Pro" : trial?.active ? "Trial" : isTradingSurface ? "Discovery" : "Free";
  const accountBadgeTone = isPaid
    ? "border-[#3a2e15] bg-[#1d160b] text-[#f3c77a]"
    : trial?.active
      ? "border-[#24406f] bg-[#0f2345] text-[#91bbff]"
      : isTradingSurface
        ? "border-cyan-400/20 bg-cyan-400/10 text-cyan-100"
        : "border-slate-700 bg-[#101b2f] text-slate-300";

  return (
    <div className="syn-app min-h-screen bg-[radial-gradient(circle_at_top_left,_#13203a_0%,_#0f172a_30%,_#0b1220_100%)] text-slate-100">
      <div
        className={classNames(
          "syn-topbar sticky top-0 z-30 border-b bg-[linear-gradient(180deg,#101a2e_0%,#0c1424_100%)]",
          isDaily ? "border-[#1b2941]" : "border-slate-800/80 backdrop-blur"
        )}
      >
        <div
          className={classNames(
            "flex h-[68px] items-center justify-between gap-4",
            isDaily ? "px-4 lg:px-[26px]" : "mx-auto max-w-[1280px] px-4 lg:px-6"
          )}
        >
          <div className={classNames("flex min-w-0 items-center gap-4", isDaily ? "lg:gap-4" : "lg:gap-6")}>
            <Link href={homeHref || "/app?tab=daily"} className="flex items-center gap-3 text-lg font-extrabold tracking-[-0.04em] text-slate-50">
              <span className="h-6 w-6 rounded-full bg-[linear-gradient(180deg,#73a8ff_0%,#265fd8_100%)] shadow-[0_0_0_3px_rgba(75,139,255,0.12)]" />
              <span>Syntrake</span>
              {productBadge ? (
                <span className="rounded-full border border-slate-700/80 bg-[#0f1a2d] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-300">
                  {productBadge}
                </span>
              ) : null}
            </Link>

            <nav className="syn-nav hidden items-center gap-2 min-[981px]:flex">
              {items.map((it) => {
                const isActive = it.key === active;
                return (
                  <button
                    key={it.key}
                    type="button"
                    onClick={() => (it.locked ? onLockedNav?.(it.key) : onNav(it.key))}
                    data-active={isActive ? "true" : "false"}
                    className={classNames(
                      "syn-nav-btn rounded-xl border px-3 py-2 text-sm font-medium transition",
                      isActive
                        ? "border-slate-700 bg-[#12203a] text-white"
                        : "border-transparent text-slate-300 hover:border-slate-800 hover:bg-[#0f1a2d] hover:text-white"
                    )}
                  >
                    <span className="inline-flex items-center gap-2">
                      <span>{it.label}</span>
                      {it.locked ? (
                        <span className="rounded-full border border-slate-700/80 bg-[#0b1526] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-300">
                          Pro
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>

          <div className={classNames("flex items-center gap-2", isDaily ? "lg:gap-4" : "lg:gap-3")}>
            <div className="hidden items-center gap-2 xl:flex">{right}</div>
            {trialLabel ? (
              <Link
                href="/pricing?source=shell_trial"
                className={classNames(
                  "items-center rounded-[10px] border px-3 text-[11px] font-bold uppercase tracking-[0.12em] transition hover:brightness-110",
                  isDaily ? "flex h-[38px]" : "hidden h-10 md:flex",
                  "border-[#24406f] bg-[#0f2345] text-[#91bbff]"
                )}
              >
                {trialLabel}
              </Link>
            ) : null}
            <div
              className={classNames(
                "items-center rounded-[10px] border px-3 text-[11px] font-bold uppercase tracking-[0.12em]",
                isDaily ? "flex h-[38px] max-[980px]:hidden" : "hidden h-10 md:flex",
                accountBadgeTone
              )}
            >
              {accountBadgeLabel}
            </div>
            {!isDaily ? <LanguageSwitcher compact /> : null}
            <UserButton />
          </div>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-700/80 bg-[#0b1424]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl min-[981px]:hidden">
          {mobileMoreOpen ? (
            <div className="mx-auto max-w-[640px] border-b border-slate-700/80 p-3">
              <div className="grid grid-cols-2 gap-2">
                {mobileMoreItems.map((it) => (
                  <button
                    key={`mobile-more-${it.key}`}
                    type="button"
                    onClick={() => {
                      setMobileMoreOpen(false);
                      if (it.locked) onLockedNav?.(it.key);
                      else onNav(it.key);
                    }}
                    data-active={it.key === active ? "true" : "false"}
                    className={classNames(
                      "min-h-11 rounded-xl border px-3 text-left text-sm font-semibold",
                      it.key === active
                        ? "border-[#365d98] bg-[#172846] text-white"
                        : "border-slate-700 bg-[#12203a] text-slate-100"
                    )}
                  >
                    {it.label}
                  </button>
                ))}
                <Link href="/pricing?source=mobile_account" className="flex min-h-11 items-center rounded-xl border border-slate-700 bg-[#12203a] px-3 text-sm font-semibold text-white">Plan: {accountBadgeLabel}</Link>
                <div className="flex min-h-11 items-center rounded-xl border border-slate-700 bg-[#12203a] px-3"><LanguageSwitcher compact /></div>
                <div className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 bg-[#12203a] px-3 text-sm font-semibold text-white"><UserButton /> Account</div>
              </div>
            </div>
          ) : null}
          <nav
            aria-label="Primary"
            className={classNames("mx-auto grid max-w-[640px] px-2 py-2", mobileGridClass)}
          >
            {mobilePrimaryItems.map((it) => {
              const isActive = it.key === active;
              return (
                <button
                  key={`mobile-${it.key}`}
                  type="button"
                  onClick={() => it.locked ? onLockedNav?.(it.key) : onNav(it.key)}
                  data-active={isActive ? "true" : "false"}
                  className={classNames(
                    "min-h-11 min-w-0 rounded-xl border px-1 py-2 text-[11px] font-semibold tracking-[0.01em] transition",
                    isActive
                      ? "border-[#365d98] bg-[#12203a] text-white shadow-[0_10px_24px_rgba(0,0,0,0.18)]"
                      : "border-slate-800 bg-[#0d1628] text-slate-300 hover:border-slate-700 hover:text-white"
                    )}
                  >
                  <span className="inline-flex items-center gap-1.5">
                    <span>{it.label}</span>
                    {it.locked ? (
                      <span className="rounded-full border border-slate-700/80 bg-[#0b1526] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-300">
                        Pro
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
            {hasMobileMore ? (
              <button
                type="button"
                aria-expanded={mobileMoreOpen}
                aria-label="More navigation and account options"
                onClick={() => setMobileMoreOpen((open) => !open)}
                data-active={mobileMoreActive ? "true" : "false"}
                className={classNames(
                  "min-h-11 min-w-0 rounded-xl border px-1 py-2 text-[11px] font-semibold tracking-[0.01em] transition",
                  mobileMoreActive
                    ? "border-[#365d98] bg-[#12203a] text-white shadow-[0_10px_24px_rgba(0,0,0,0.18)]"
                    : "border-slate-800 bg-[#0d1628] text-slate-300 hover:border-slate-700 hover:text-white"
                )}
              >
                More
              </button>
            ) : null}
          </nav>
        </div>
      </div>

      <div
        className={classNames(
          "mx-auto w-full max-w-[1280px]",
          isDaily ? "px-[18px] pb-24 pt-[18px] lg:px-[26px] lg:py-[26px]" : "px-4 pb-24 pt-6 lg:px-6 lg:py-8"
        )}
      >
        {active !== "daily" && showPageHeader ? (
          <div className="syn-header-wrap mb-6 rounded-[22px] border border-slate-800/80 bg-[linear-gradient(180deg,rgba(16,29,52,0.86)_0%,rgba(13,23,41,0.92)_100%)] px-6 py-5 shadow-[0_18px_50px_rgba(0,0,0,0.28)]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              {productBadge ? `Syntrake ${productBadge}` : "Syntrake OS"}
            </div>
            <div className="mt-2 text-3xl font-black tracking-[-0.06em] text-white">{title}</div>
            {subtitle ? <div className="mt-2 max-w-3xl text-sm leading-7 text-slate-300">{subtitle}</div> : null}
          </div>
        ) : null}

        <div>{children}</div>
      </div>
    </div>
  );
}
