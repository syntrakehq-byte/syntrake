import { describe, expect, it } from "vitest";
import {
  buildModeAwareNavItems,
  buildShellCopy,
  inferModeFromView,
  isAuxiliarySurfaceMode,
  resolveModeAwareView,
  toModeAwareTab,
} from "@/app/app/navigationModel";

describe("app navigation model", () => {
  it("keeps investing and trading as separate workspaces", () => {
    expect(buildModeAwareNavItems({ mode: "investing", lang: "en" })).toEqual([
      { key: "daily", label: "Today" },
      { key: "portfolio", label: "Portfolio" },
      { key: "broker", label: "Broker" },
      { key: "planning", label: "Plan" },
      { key: "research", label: "Research" },
      { key: "reports", label: "Reports" },
      { key: "autonomy", label: "Copilot" },
      { key: "settings", label: "Settings" },
    ]);

    expect(buildModeAwareNavItems({ mode: "trading", lang: "en" })).toEqual([
      { key: "trading", label: "Trading" },
      { key: "alerts", label: "Alerts" },
      { key: "journal", label: "Journal" },
    ]);
  });

  it("keeps mode-local tabs and falls back invalid tabs to each workspace home", () => {
    expect(resolveModeAwareView({ rawView: "trading", mode: "investing" })).toBe("daily");
    expect(resolveModeAwareView({ rawView: "planning", mode: "investing" })).toBe("planning");
    expect(resolveModeAwareView({ rawView: "advisor", mode: "investing" })).toBe("research");
    expect(resolveModeAwareView({ rawView: "research", mode: "investing" })).toBe("research");
    expect(resolveModeAwareView({ rawView: "reports", mode: "investing" })).toBe("reports");
    expect(resolveModeAwareView({ rawView: "settings", mode: "investing" })).toBe("settings");
    expect(resolveModeAwareView({ rawView: "portfolio", mode: "investing" })).toBe("portfolio");
    expect(resolveModeAwareView({ rawView: "broker", mode: "investing" })).toBe("broker");
    expect(resolveModeAwareView({ rawView: "autonomy", mode: "investing" })).toBe("autonomy");
    expect(resolveModeAwareView({ rawView: "copilot", mode: "investing" })).toBe("autonomy");
    expect(resolveModeAwareView({ rawView: "unknown", mode: "investing" })).toBe("daily");
    expect(resolveModeAwareView({ rawView: "execution", mode: "trading" })).toBe("trading");
    expect(resolveModeAwareView({ rawView: "opportunities", mode: "trading" })).toBe("trading");
    expect(resolveModeAwareView({ rawView: "risk", mode: "trading" })).toBe("trading");
    expect(resolveModeAwareView({ rawView: "portfolio", mode: "trading" })).toBe("trading");
  });

  it("writes tabs back through the current workspace rules", () => {
    expect(toModeAwareTab({ view: "trading", mode: "investing" })).toBe("daily");
    expect(toModeAwareTab({ view: "planning", mode: "investing" })).toBe("planning");
    expect(toModeAwareTab({ view: "advisor", mode: "investing" })).toBe("research");
    expect(toModeAwareTab({ view: "research", mode: "investing" })).toBe("research");
    expect(toModeAwareTab({ view: "autonomy", mode: "investing" })).toBe("autonomy");
    expect(toModeAwareTab({ view: "daily", mode: "investing" })).toBe("daily");
    expect(toModeAwareTab({ view: "portfolio", mode: "trading" })).toBe("trading");
    expect(toModeAwareTab({ view: "risk", mode: "trading" })).toBe("trading");
  });

  it("can infer the workspace mode directly from a tab key", () => {
    expect(inferModeFromView("trading")).toBe("trading");
    expect(inferModeFromView("execution")).toBe("trading");
    expect(inferModeFromView("portfolio")).toBe("investing");
    expect(inferModeFromView("broker")).toBe("investing");
    expect(inferModeFromView("planning")).toBe("investing");
    expect(inferModeFromView("copilot")).toBe("investing");
    expect(inferModeFromView("research")).toBe("investing");
    expect(inferModeFromView("reports")).toBe("investing");
    expect(inferModeFromView("settings")).toBe("investing");
    expect(inferModeFromView("unknown")).toBeNull();
  });

  it("exposes dedicated shell copy for each workspace", () => {
    expect(buildShellCopy({ mode: "investing", view: "planning", lang: "en" })).toEqual({
      title: "Investing Plan",
      subtitle: "Translate goals, risk, and horizon into a capital plan that the daily loop can actually enforce.",
    });
    expect(buildShellCopy({ mode: "trading", view: "execution", lang: "en" })).toEqual({
      title: "Trading Execution",
      subtitle: "Turn setups into a calm execution pack with sizing, simulation, and fewer mistakes.",
    });
  });

  it("never marks investing as an auxiliary surface", () => {
    expect(isAuxiliarySurfaceMode("investing")).toBe(false);
  });
});
