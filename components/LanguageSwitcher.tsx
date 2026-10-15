"use client";

import React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SITE_LANG_LABELS, SITE_LANGS, type SiteLang } from "@/lib/i18n/siteLanguage";
import { useSiteLanguage } from "@/components/SiteLanguageProvider";

type LanguageSwitcherProps = {
  compact?: boolean;
};

export default function LanguageSwitcher({ compact = false }: LanguageSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { lang, setLang } = useSiteLanguage();

  function onChange(next: SiteLang) {
    setLang(next);

    const qp = new URLSearchParams(searchParams?.toString() || "");
    if (next === "en") qp.delete("lang");
    else qp.set("lang", next);
    const target = `${pathname || "/"}${qp.toString() ? `?${qp.toString()}` : ""}`;

    router.replace(target);
    if (!String(pathname || "").startsWith("/app")) {
      router.refresh();
    }
  }

  return (
    <label className="inline-flex items-center gap-2 text-xs font-semibold text-neutral-700">
      {!compact ? (
        <span>
          {lang === "pt"
            ? "Idioma"
            : lang === "fr"
              ? "Langue"
              : "Language"}
        </span>
      ) : null}
      <select
        value={lang}
        onChange={(e) => onChange(e.target.value as SiteLang)}
        className="rounded-xl border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-900"
      >
        {SITE_LANGS.map((code) => (
          <option key={code} value={code}>
            {SITE_LANG_LABELS[code]}
          </option>
        ))}
      </select>
    </label>
  );
}
