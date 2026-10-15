"use client";

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { track } from "@/lib/analytics/client";
import {
  DEFAULT_SITE_LANG,
  SITE_DETECTED_LANG_COOKIE_KEY,
  SITE_LANG_COOKIE_KEY,
  type SiteLang,
  resolvePreferredSiteLang,
  resolveSiteLang,
} from "@/lib/i18n/siteLanguage";

type SiteLanguageContextValue = {
  lang: SiteLang;
  setLang: (next: SiteLang) => void;
};

const SITE_LANG_KEY = "sc_site_lang";

const SiteLanguageContext = createContext<SiteLanguageContextValue | null>(null);

function syncLangInUrl(lang: SiteLang) {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    if (lang === DEFAULT_SITE_LANG) url.searchParams.delete("lang");
    else url.searchParams.set("lang", lang);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // ignore URL parsing errors
  }
}

function readCookieValue(name: string) {
  if (typeof document === "undefined") return null;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cookieMatch = document.cookie.match(new RegExp(`(?:^|; )${escapedName}=([^;]*)`));
  return cookieMatch?.[1] ? decodeURIComponent(cookieMatch[1]) : null;
}

function readPreferredSiteLangFromBrowser() {
  if (typeof window === "undefined") return DEFAULT_SITE_LANG;
  const qp = new URLSearchParams(window.location.search);
  const browserLanguages = Array.isArray(navigator.languages) && navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language].filter(Boolean);
  return resolvePreferredSiteLang({
    query: qp.get("lang"),
    stored: window.localStorage.getItem(SITE_LANG_KEY),
    cookie: readCookieValue(SITE_LANG_COOKIE_KEY),
    browser: browserLanguages,
    detected: readCookieValue(SITE_DETECTED_LANG_COOKIE_KEY),
  });
}

function persistSiteLang(lang: SiteLang) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SITE_LANG_KEY, lang);
  document.cookie = `${SITE_LANG_COOKIE_KEY}=${encodeURIComponent(lang)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  document.documentElement.lang = lang;
  syncLangInUrl(lang);
}

export function SiteLanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<SiteLang>(() => readPreferredSiteLangFromBrowser());
  const hasResolvedInitialLang = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const resolved = readPreferredSiteLangFromBrowser();
    hasResolvedInitialLang.current = true;
    persistSiteLang(resolved);
    // Sync browser preference once after hydration without first writing the default language.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLangState((current) => (current === resolved ? current : resolved));
  }, []);

  useEffect(() => {
    if (!hasResolvedInitialLang.current) return;
    persistSiteLang(lang);
  }, [lang]);

  function setLang(next: SiteLang) {
    const normalized = resolveSiteLang(next);
    hasResolvedInitialLang.current = true;
    persistSiteLang(normalized);
    setLangState(normalized);
    track("site_language_changed", { lang: normalized });
  }

  const value = useMemo<SiteLanguageContextValue>(() => ({ lang, setLang }), [lang]);

  return <SiteLanguageContext.Provider value={value}>{children}</SiteLanguageContext.Provider>;
}

export function useSiteLanguage() {
  const ctx = useContext(SiteLanguageContext);
  if (!ctx) {
    return {
      lang: DEFAULT_SITE_LANG as SiteLang,
      setLang: () => {},
    };
  }
  return ctx;
}
