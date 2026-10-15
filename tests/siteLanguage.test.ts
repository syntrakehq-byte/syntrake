import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SITE_LANG,
  resolveBrowserSiteLang,
  resolveCountrySiteLang,
  resolvePreferredSiteLang,
  resolveSiteLang,
  resolveSiteLangOrNull,
} from "@/lib/i18n/siteLanguage";

describe("site language resolution", () => {
  it("normalizes supported browser locale variants", () => {
    expect(resolveSiteLang("pt-PT")).toBe("pt");
    expect(resolveSiteLang("fr-CA")).toBe("fr");
  });

  it("returns null for unsupported languages before falling back", () => {
    expect(resolveSiteLangOrNull("es-MX")).toBe(null);
    expect(resolveSiteLangOrNull("de-AT")).toBe(null);
    expect(resolveSiteLangOrNull("it-CH")).toBe(null);
    expect(resolveSiteLangOrNull("zh-CN")).toBe(null);
    expect(resolveBrowserSiteLang("zh-CN,zh;q=0.9")).toBe(null);
  });

  it("uses country only for supported automatic language fallbacks", () => {
    expect(resolveCountrySiteLang("PT")).toBe("pt");
    expect(resolveCountrySiteLang("BR")).toBe("pt");
    expect(resolveCountrySiteLang("MX")).toBe(null);
    expect(resolveCountrySiteLang("FR")).toBe("fr");
    expect(resolveCountrySiteLang("CN")).toBe(null);
  });

  it("prioritizes explicit user preference over browser and country", () => {
    expect(
      resolvePreferredSiteLang({
        query: "pt",
        stored: "fr",
        cookie: "en",
        browser: ["fr-FR"],
        country: "PT",
      }),
    ).toBe("pt");

    expect(
      resolvePreferredSiteLang({
        stored: "fr",
        cookie: "en",
        browser: ["pt-PT"],
        country: "PT",
      }),
    ).toBe("fr");
  });

  it("keeps explicit user language preferences above detected French", () => {
    expect(
      resolvePreferredSiteLang({
        cookie: "en",
        browser: ["fr-FR"],
        detected: "fr",
      }),
    ).toBe("en");

    expect(
      resolvePreferredSiteLang({
        stored: "pt",
        cookie: null,
        browser: ["fr-FR"],
        detected: "fr",
      }),
    ).toBe("pt");
  });

  it("does not persist the default language before hydration resolves preference", () => {
    const source = readFileSync(join(process.cwd(), "components/SiteLanguageProvider.tsx"), "utf8");

    expect(source).toContain("readPreferredSiteLangFromBrowser");
    expect(source).toContain("hasResolvedInitialLang");
    expect(source).toContain("if (!hasResolvedInitialLang.current) return;");
    expect(source).toContain("persistSiteLang(normalized)");
  });

  it("falls back from browser to country to English", () => {
    expect(resolvePreferredSiteLang({ browser: ["fr-FR"], country: "PT" })).toBe("fr");
    expect(resolvePreferredSiteLang({ browser: ["zh-CN"], country: "PT" })).toBe("pt");
    expect(resolvePreferredSiteLang({ browser: ["zh-CN"], country: "CN" })).toBe(DEFAULT_SITE_LANG);
  });
});
