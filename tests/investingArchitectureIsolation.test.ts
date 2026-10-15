import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const prohibited = [
  "@/lib/broker",
  "@/lib/trading",
  "@/lib/signalcore",
  "@/lib/supabase/admin",
  "lib/broker",
  "lib/trading",
  "lib/signalcore",
];

function listTsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return listTsFiles(path);
    return path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
  });
}

describe("investing architecture isolation", () => {
  it("keeps lib/investing independent from broker, trading, signalcore and shared admin boundaries", () => {
    const files = listTsFiles(join(process.cwd(), "lib/investing"));
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const token of prohibited) {
        if (source.includes(token)) violations.push(`${relative(process.cwd(), file)}:${token}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps historical_raw access read-only by contract", () => {
    const source = readFileSync(join(process.cwd(), "lib/investing/historical-market-data/reader.ts"), "utf8");
    expect(source).toContain("readHistoricalRaw");
    expect(source).toContain("investing_historical_raw_is_read_only");
  });

  it("keeps the transitive Investing runtime graph outside Trading, Broker and SignalCore", () => {
    const root = process.cwd();
    const queue = [
      ...listTsFiles(join(root, "lib/investing")),
      ...listTsFiles(join(root, "app/api/investing")),
      join(root, "app/app/tabs/DailyTab.tsx"),
      join(root, "app/app/tabs/InvestingDashboardSurface.tsx"),
      join(root, "app/app/tabs/dailyDecisionViewModel.ts"),
      ...listTsFiles(join(root, "components/investing")),
    ];
    const visited = new Set<string>();
    const violations: string[] = [];
    while (queue.length) {
      const file = queue.pop()!;
      if (visited.has(file)) continue;
      visited.add(file);
      const source = readFileSync(file, "utf8");
      const imports = [...source.matchAll(/(?:from\s+|import\s*\()(["'])([^"']+)\1/g)].map((match) => match[2]!);
      for (const specifier of imports) {
        if (specifier.startsWith("@/lib/broker") || specifier.startsWith("@/lib/trading") || specifier.startsWith("@/lib/signalcore")) {
          violations.push(`${relative(root, file)} -> ${specifier}`);
          continue;
        }
        const base = specifier.startsWith("@/") ? join(root, specifier.slice(2)) : specifier.startsWith(".") ? resolve(dirname(file), specifier) : null;
        if (!base) continue;
        const candidate = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((path) => existsSync(path) && statSync(path).isFile());
        if (candidate && (candidate.endsWith(".ts") || candidate.endsWith(".tsx"))) queue.push(candidate);
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps the Investing UI off shared broker, snapshot, journal and auto-fix APIs", () => {
    const source = readFileSync(join(process.cwd(), "app/app/tabs/DailyTab.tsx"), "utf8");
    for (const endpoint of ["/api/broker/", "/api/daily-bundle", "/api/daily-snapshot", "/api/journal/", "/api/fix-now/"]) {
      expect(source).not.toContain(endpoint);
    }
    expect(source).toContain("/api/investing/dashboard");
    expect(source).toContain("/api/investing/daily-cycle");
    expect(source).toContain("/api/investing/paper/accounts");
  });

  it("keeps the Investing portfolio tab on canonical Investing APIs", () => {
    const source = readFileSync(join(process.cwd(), "app/app/tabs/PortfolioTab.tsx"), "utf8");
    for (const endpoint of ["/api/daily-bundle", "/api/portfolio-items", "/api/fix-now/"]) {
      expect(source).not.toContain(endpoint);
    }
    expect(source).toContain("/api/investing/dashboard");
    expect(source).toContain("/api/investing/paper/accounts");
  });

  it("keeps all primary Investing tabs off legacy shared automation APIs", () => {
    const tabFiles = ["DailyTab.tsx", "PlanningTab.tsx", "PortfolioTab.tsx", "AdvisorTab.tsx", "AutonomyTab.tsx", "InvestingDashboardSurface.tsx"];
    for (const tabFile of tabFiles) {
      const source = readFileSync(join(process.cwd(), "app/app/tabs", tabFile), "utf8");
      for (const endpoint of ["/api/daily-bundle", "/api/portfolio-items", "/api/fix-now/", "/api/broker/", "/api/daily/close", "@/lib/broker"]) {
        expect(source, `${tabFile} should not call ${endpoint}`).not.toContain(endpoint);
      }
      expect(source, `${tabFile} should read the canonical Investing dashboard`).toContain("/api/investing/dashboard");
    }
  });

  it("does not expose fake disabled action buttons on the unified Investing dashboard", () => {
    const source = readFileSync(join(process.cwd(), "app/app/tabs/InvestingDashboardSurface.tsx"), "utf8");
    expect(source).not.toMatch(/<button[^>]*\sdisabled[\s=>]/i);
    expect(source).not.toContain("disabled in audit build");
  });

  it("does not mount shared broker setup inside the Investing workspace", () => {
    const source = readFileSync(join(process.cwd(), "app/app/ui.tsx"), "utf8");
    expect(source).not.toContain("BrokerPageClient");
    expect(source).not.toMatch(/view === "autonomy"[\s\S]*brokerSetupRequested/);
  });

  it("does not present fabricated operational health or security claims on the Investing surface", () => {
    const source = readFileSync(join(process.cwd(), "app/app/tabs/InvestingDashboardSurface.tsx"), "utf8");
    expect(source).not.toContain(">OK<");
    expect(source).not.toContain('value="Operational"');
    expect(source).not.toContain('["Paper account active", true]');
    expect(source).not.toContain('["Security posture", "Good"]');
    expect(source).not.toContain('["Daily reminders", "Enabled"]');
    expect(source).not.toContain("Read-only disabled");
    expect(source).not.toContain("Provider quotes operational");
    expect(source).not.toContain("Environment: Paper</div>");
  });

  it("keeps customer Investing provenance free of raw technical fingerprints", () => {
    const source = readFileSync(join(process.cwd(), "app/app/tabs/InvestingDashboardSurface.tsx"), "utf8");
    expect(source).toContain("Decision & Data Lineage");
    expect(source).not.toContain("hash?.slice");
    expect(source).not.toContain("snapshotId");
    expect(source).not.toContain("projectionId");
  });

  it("routes Portfolio broker actions through canonical Investing broker APIs", () => {
    const source = readFileSync(join(process.cwd(), "app/app/tabs/InvestingDashboardSurface.tsx"), "utf8");
    expect(source).toContain("/api/investing/plan");
    expect(source).toContain("Investment Policy");
    expect(source).not.toContain("Plan Editor");
    expect(source).toContain("/api/investing/accounts");
    expect(source).toContain("/api/investing/broker/connections");
    expect(source).toContain("Broker Connection");
    expect(source).toContain("What To Do Today");
    expect(source).toContain("Exactly what the client should do, how to do it, and why");
    expect(source).toContain("How to do it");
    expect(source).toContain("Decision Evidence");
    expect(source).toContain("No trade needed today. Keep the plan active and keep the monthly contribution");
    expect(source).toContain("Portfolio Alignment To Plan");
    expect(source).toContain("How the current portfolio compares with the selected plan");
    expect(source).toContain("What the client must know and do");
    expect(source).toContain("Automated guidance without automatic execution");
    expect(source).toContain("Start manual tracking");
    expect(source).toContain("Manual tracking");
    expect(source).toContain("Connect demo broker");
    expect(source).toContain("Connect live broker");
    expect(source).toContain("Live broker connector required");
    expect(source).toContain("Syntrake does not create a fake broker account here.");
    expect(source).not.toContain("Paper only");
    expect(source).not.toContain("/api/investing/daily-cycle");
    expect(source).not.toContain("/api/investing/paper/orders");
    expect(source).toContain("Import existing holdings or review a Syntrake prepared portfolio from the saved plan");
    expect(source).toContain("Prepare portfolio");
    expect(source).toContain("Broker connection stays in Broker");
    expect(source).toContain("action: \"opening_position\"");
    expect(source).toContain("Import existing holding");
    expect(source).not.toContain("/api/portfolio-items");
  });

  it("exposes a normal Investing Broker tab without autonomous live execution claims", () => {
    const nav = readFileSync(join(process.cwd(), "app/app/navigationModel.ts"), "utf8");
    const shell = readFileSync(join(process.cwd(), "app/app/ui.tsx"), "utf8");
    const surface = readFileSync(join(process.cwd(), "app/app/tabs/InvestingDashboardSurface.tsx"), "utf8");
    expect(nav).toContain('"broker"');
    expect(nav).toContain("Copilot");
    expect(nav).toContain('raw === "copilot"');
    expect(nav).toContain('"autonomy"');
    expect(shell).toContain('view === "broker"');
    expect(shell).toContain('page="broker"');
    expect(surface).toContain('page === "broker"');
    expect(surface).toContain("Only the client presses the broker submit button");
    expect(surface).toContain("Syntrake does not auto-send live orders");
    expect(surface).not.toContain("Live investing is blocked");
  });

  it("keeps the summary KPI strip out of workflow tabs and only in Settings", () => {
    const surface = readFileSync(join(process.cwd(), "app/app/tabs/InvestingDashboardSurface.tsx"), "utf8");
    const topMetricUses = surface.match(/<TopMetrics vm=\{vm\} \/>/g) ?? [];
    expect(topMetricUses).toHaveLength(1);
    expect(surface.indexOf("<TopMetrics vm={vm} />")).toBeGreaterThan(surface.indexOf("function SettingsPage"));
    expect(surface).toContain('page === "broker" || page === "settings" ? <Badge tone={vm.brokerConnectionTone}>');
    expect(surface).toContain('page === "broker" || page === "settings" ? <Badge tone={vm.hasLiveBroker ? "good" : "warn"}>');
  });

  it("keeps demo and live broker controls out of the Portfolio workflow", () => {
    const surface = readFileSync(join(process.cwd(), "app/app/tabs/InvestingDashboardSurface.tsx"), "utf8");
    const portfolioStart = surface.indexOf("function PortfolioFundingPanel");
    const portfolioEnd = surface.indexOf("function PortfolioPage");
    const brokerStart = surface.indexOf("function BrokerPage");
    const brokerEnd = surface.indexOf("function ResearchPage");
    const portfolio = surface.slice(portfolioStart, portfolioEnd);
    const broker = surface.slice(brokerStart, brokerEnd);

    expect(portfolio).toContain("Start manual tracking");
    expect(portfolio).toContain("Prepare portfolio");
    expect(portfolio).not.toContain("Connect demo broker");
    expect(portfolio).not.toContain("Connect live broker");
    expect(portfolio).not.toContain("Submit {tradeSymbol}");
    expect(broker).toContain("Connect demo broker");
    expect(broker).toContain("Connect live broker");
    expect(broker).not.toContain("Add demo cash");
    expect(broker).not.toContain("Create demo proposal");
    expect(broker).not.toContain("Submit {tradeSymbol} manually");
  });

  it("exposes the guided Investing mission from Plan to Portfolio to Today", () => {
    const surface = readFileSync(join(process.cwd(), "app/app/tabs/InvestingDashboardSurface.tsx"), "utf8");
    expect(surface).toContain("function GuidedMissionPanel");
    expect(surface).toContain("function guidedRedirectPage");
    expect(surface).toContain("1. Plan");
    expect(surface).toContain("2. Portfolio");
    expect(surface).toContain("3. Today");
    expect(surface).toContain("Continue setup");
    expect(surface).toContain("Unlocked after plan and portfolio evidence.");
    expect(surface).toContain('if (page !== "daily") return null');
    expect(surface).toContain("if (!mission.hasPlan) return \"planning\"");
    expect(surface).toContain("if (!mission.hasPortfolioEvidence) return \"portfolio\"");
    expect(surface).toContain('router.replace(`/app?tab=${redirectPage}&mode=investing`)');
    expect(surface).toContain("Guided setup required");
  });

  it("shows clickable holding detail with position-level P/L and price provenance", () => {
    const surface = readFileSync(join(process.cwd(), "app/app/tabs/InvestingDashboardSurface.tsx"), "utf8");
    expect(surface).toContain("setSelectedSymbol(symbol)");
    expect(surface).toContain("Holding Detail");
    expect(surface).toContain("Unrealized P/L");
    expect(surface).toContain("Price source");
    expect(surface).toContain("Price time");
    expect(surface).toContain("This holding is using stored cost basis");
  });

  it("keeps customer Research as safe opportunities instead of exposing raw lab output", () => {
    const surface = readFileSync(join(process.cwd(), "app/app/tabs/InvestingDashboardSurface.tsx"), "utf8");
    const dashboard = readFileSync(join(process.cwd(), "lib/investing/server/dashboard.ts"), "utf8");
    expect(surface).toContain("Research Opportunities");
    expect(surface).toContain("Customer-safe ideas that may improve the selected plan and portfolio");
    expect(surface).toContain("Lab promotion pending");
    expect(surface).toContain("No customer-safe opportunities yet");
    expect(dashboard).toContain("investing-customer-research-opportunity/v1");
    expect(dashboard).toContain('labValidation: "not_connected"');
    expect(dashboard).not.toContain("@/lib/ops");
    expect(dashboard).not.toContain("@/lib/trading");
  });

  it("exposes monthly and quarterly Investing reports from receipts without pretending full performance attribution", () => {
    const surface = readFileSync(join(process.cwd(), "app/app/tabs/InvestingDashboardSurface.tsx"), "utf8");
    const dashboard = readFileSync(join(process.cwd(), "lib/investing/server/dashboard.ts"), "utf8");
    expect(dashboard).toContain("investing-report-summary/v1");
    expect(dashboard).toContain("monthToDate");
    expect(dashboard).toContain("quarterToDate");
    expect(surface).toContain("Monthly & Quarterly Report");
    expect(surface).toContain("Built from saved daily-cycle receipts and the latest portfolio snapshot");
    expect(surface).toContain("Report Limitations");
    expect(surface).toContain("It does not yet compute full time-weighted return");
  });

  it("exposes a beginner/pro Investing mission brief across the guided workflow", () => {
    const surface = readFileSync(join(process.cwd(), "app/app/tabs/InvestingDashboardSurface.tsx"), "utf8");
    const migration = readFileSync(join(process.cwd(), "supabase/migrations/20260812120000_investing_ui_state.sql"), "utf8");
    expect(surface).toContain("function MissionBriefPanel");
    expect(surface).toContain("function buildMissionBrief");
    expect(surface).toContain("Mission brief");
    expect(surface).toContain("beginner");
    expect(surface).toContain("pro");
    expect(surface).toContain("/api/investing/preferences");
    expect(surface).toContain("Show mission brief");
    expect(surface).toContain("Saving preference...");
    expect(surface).toContain("Define the investment contract");
    expect(surface).toContain("Give Syntrake portfolio evidence");
    expect(surface).toContain("Follow today's decision");
    expect(surface).toContain("Done when:");
    expect(surface).toContain("Broker is isolated so execution controls never leak into Portfolio, Today, or Research.");
    expect(migration).toContain("add column if not exists investing_ui_state jsonb");
  });
});
