export const SITE_LANGS = ["en", "pt", "fr"] as const;
export type SiteLang = (typeof SITE_LANGS)[number];

export const DEFAULT_SITE_LANG: SiteLang = "en";
export const SITE_LANG_COOKIE_KEY = "sc_site_lang";
export const SITE_DETECTED_LANG_COOKIE_KEY = "sc_site_lang_detected";

const COUNTRY_TO_SITE_LANG: Record<string, SiteLang> = {
  BE: "fr",
  BR: "pt",
  FR: "fr",
  LU: "fr",
  PT: "pt",
};

export function resolveSiteLang(input: unknown): SiteLang {
  const raw = String(input ?? "").toLowerCase().trim();
  const norm = raw.slice(0, 2);
  if (norm === "pt") return "pt";
  if (norm === "fr") return "fr";
  return "en";
}

export function resolveSiteLangOrNull(input: unknown): SiteLang | null {
  if (input == null) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const resolved = resolveSiteLang(raw);
  if (resolved !== DEFAULT_SITE_LANG) return resolved;
  return raw.toLowerCase().slice(0, 2) === DEFAULT_SITE_LANG ? DEFAULT_SITE_LANG : null;
}

export function resolveBrowserSiteLang(input: unknown): SiteLang | null {
  const values = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",").map((part) => part.split(";")[0]?.trim())
      : [];

  for (const value of values) {
    const resolved = resolveSiteLangOrNull(value);
    if (resolved) return resolved;
  }

  return null;
}

export function resolveCountrySiteLang(input: unknown): SiteLang | null {
  const country = String(input ?? "").trim().toUpperCase();
  if (!country) return null;
  return COUNTRY_TO_SITE_LANG[country] ?? null;
}

export function resolvePreferredSiteLang(args: {
  query?: unknown;
  stored?: unknown;
  cookie?: unknown;
  browser?: unknown;
  acceptLanguage?: unknown;
  country?: unknown;
  detected?: unknown;
}): SiteLang {
  return (
    resolveSiteLangOrNull(args.query) ??
    resolveSiteLangOrNull(args.stored) ??
    resolveSiteLangOrNull(args.cookie) ??
    resolveBrowserSiteLang(args.browser) ??
    resolveBrowserSiteLang(args.acceptLanguage) ??
    resolveCountrySiteLang(args.country) ??
    resolveSiteLangOrNull(args.detected) ??
    DEFAULT_SITE_LANG
  );
}

export const SITE_LANG_LABELS: Record<SiteLang, string> = {
  en: "English",
  pt: "Portugues",
  fr: "Francais",
};

export type Multilingual = Record<SiteLang, string> & Partial<Record<"es" | "de" | "it", string>>;

export type SupportedMultilingual = {
  en: string;
  pt: string;
  fr: string;
};

export function pickByLang(lang: unknown, text: Multilingual): string {
  const normalized = resolveSiteLangOrNull(lang);
  return normalized ? text[normalized] ?? text.en : text.en;
}
