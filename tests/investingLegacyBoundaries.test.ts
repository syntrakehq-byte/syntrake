import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { legacyPortfolioBoundary } from "@/lib/signalcore/legacyPortfolioBoundary";

function read(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("investing legacy boundaries", () => {
  it("keeps legacy portfolio endpoints mode-aware about the canonical source", () => {
    for (const path of ["app/api/portfolio/route.ts", "app/api/portfolio/save/route.ts", "app/api/portfolio-meta/route.ts"]) {
      const source = read(path);
      expect(source).toContain("legacyPortfolioBoundary");
    }
    expect(read("lib/signalcore/legacyPortfolioBoundary.ts")).toContain('"X-SignalCore-Deprecated": "true"');

    expect(legacyPortfolioBoundary("investing")).toMatchObject({
      canonicalSource: "investing_positions",
      canonicalReadEndpoint: "/api/investing/dashboard",
      canonicalWriteEndpoint: "/api/investing/accounts",
      canonicalProjectionEndpoint: "/api/investing/dashboard",
    });
    expect(legacyPortfolioBoundary("trading")).toMatchObject({
      canonicalSource: "portfolio_items",
      canonicalReadEndpoint: "/api/portfolio-items",
      canonicalWriteEndpoint: "/api/portfolio-items",
      canonicalProjectionEndpoint: "/api/daily-bundle",
    });
  });

  it("keeps Investing surface on the canonical dashboard projection", () => {
    const appShell = read("app/app/ui.tsx");
    const investingSurface = read("app/app/tabs/InvestingDashboardSurface.tsx");
    const dashboard = read("lib/investing/server/dashboard.ts");

    expect(appShell).toContain("<InvestingDashboardSurface page=\"daily\" />");
    expect(appShell).toContain("<InvestingDashboardSurface page=\"portfolio\" />");
    expect(appShell).toContain("<InvestingDashboardSurface page=\"autonomy\" />");
    expect(investingSurface).toContain("/api/investing/dashboard?mode=investing");
    expect(investingSurface).not.toContain("/api/daily-bundle");
    expect(investingSurface).not.toContain("/api/portfolio-items");
    expect(dashboard).toContain("buildCustomerDecisionProjection");
    expect(dashboard).toContain("customerDecisionSource");
  });

  it("uses a real dynamic holdings autocomplete in the Investing portfolio import", () => {
    const investingSurface = read("app/app/tabs/InvestingDashboardSurface.tsx");

    expect(investingSurface).toContain("filteredHoldingSuggestions");
    expect(investingSurface).toContain('role="combobox"');
    expect(investingSurface).toContain('role="listbox"');
    expect(investingSurface).toContain("chooseHoldingSuggestion");
    expect(investingSurface).toContain("setOpeningSymbol(event.target.value)");
    expect(investingSurface).not.toContain("<datalist");
    expect(investingSurface).not.toContain('list="opening-holding-suggestions"');
    expect(investingSurface).not.toContain("event.target.value.toUpperCase()");
  });

  it("does not render a duplicate internal tab sidebar inside Investing", () => {
    const investingSurface = read("app/app/tabs/InvestingDashboardSurface.tsx");
    const shellStart = investingSurface.indexOf("function Shell");
    const shellEnd = investingSurface.indexOf("function TopMetrics");
    const shell = investingSurface.slice(shellStart, shellEnd);

    expect(shell).not.toContain("<aside");
    expect(shell).not.toContain("<nav");
    expect(shell).not.toContain("navItems.map");
    expect(shell).not.toContain("router.push(`/app?tab=${item.key}&mode=investing`)");
    expect(shell).toContain("<main");
  });

  it("formats Investing dates and money with the selected site language", () => {
    const investingSurface = read("app/app/tabs/InvestingDashboardSurface.tsx");

    expect(investingSurface).toContain("useSiteLanguage");
    expect(investingSurface).toContain("currentFormattingLocale");
    expect(investingSurface).toContain("new Intl.NumberFormat(currentFormattingLocale()");
    expect(investingSurface).toContain("date.toLocaleString(currentFormattingLocale()");
    expect(investingSurface).not.toContain("new Intl.NumberFormat(undefined");
    expect(investingSurface).not.toContain("toLocaleString(undefined");
  });

  it("documents portfolios writes as compatibility mirrors, not canonical holdings", () => {
    const brokerSync = read("lib/broker/sync.ts");
    const repo = read("lib/signalcore/supabaseRepo.ts");
    expect(brokerSync).toContain("Compatibility mirror only");
    expect(repo).toContain("Trading/shared runtime holdings are canonical in portfolio_items");
    expect(repo).toContain("Investing runtime holdings are canonical in investing_positions");
  });

  it("does not call the removed standalone opportunities API from the legacy panel", () => {
    const panel = read("components/opportunities/OpportunitiesPanel.tsx");
    expect(panel).not.toContain('fetch("/api/opportunities"');
    expect(panel).toContain('fetch("/api/investing/dashboard?mode=investing"');
    expect(panel).not.toContain("/api/daily-bundle");
    expect(panel).not.toContain("demoOpportunities");
    expect(panel).not.toContain("demoPortfolio");
    expect(panel).not.toContain("@/lib/execution/store");
    expect(panel).not.toContain("mode=trading");
    expect(panel).not.toContain("opportunity_sent_to_execution");
    expect(panel).toContain("investing_opportunity_reviewed");
  });

  it("keeps the old opportunities engine outside the active app and shared bundle routes", () => {
    const activeFiles = [
      "app/api/daily-bundle/route.ts",
      "components/opportunities/OpportunitiesPanel.tsx",
    ].map(read).join("\n");
    const legacyRepo = read("lib/opportunities/supabaseRepo.ts");

    expect(activeFiles).not.toContain("@/lib/opportunities/supabaseRepo");
    expect(activeFiles).not.toContain("@/lib/opportunities/realEngine");
    expect(legacyRepo).toContain("Active Investing opportunities are served");
    expect(legacyRepo).toContain("/api/investing/dashboard");
  });
});
