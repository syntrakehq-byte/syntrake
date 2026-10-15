import type { AutopilotMode } from "@/lib/signalcore/modes";

export type LegacyPortfolioBoundary = {
  canonicalSource: "investing_positions" | "portfolio_items";
  canonicalReadEndpoint: "/api/investing/dashboard" | "/api/portfolio-items";
  canonicalWriteEndpoint: "/api/investing/accounts" | "/api/portfolio-items";
  canonicalProjectionEndpoint: "/api/investing/dashboard" | "/api/daily-bundle";
  canonicalNote: string;
};

export function legacyPortfolioBoundary(mode: AutopilotMode | string | null | undefined): LegacyPortfolioBoundary {
  if (mode === "investing") {
    return {
      canonicalSource: "investing_positions",
      canonicalReadEndpoint: "/api/investing/dashboard",
      canonicalWriteEndpoint: "/api/investing/accounts",
      canonicalProjectionEndpoint: "/api/investing/dashboard",
      canonicalNote:
        "This endpoint is legacy compatibility. Investing customer state is read from /api/investing/dashboard and operational positions live in investing_positions.",
    };
  }

  return {
    canonicalSource: "portfolio_items",
    canonicalReadEndpoint: "/api/portfolio-items",
    canonicalWriteEndpoint: "/api/portfolio-items",
    canonicalProjectionEndpoint: "/api/daily-bundle",
    canonicalNote:
      "This endpoint is legacy compatibility. Trading/shared holdings remain canonical in portfolio_items via /api/portfolio-items.",
  };
}

export function legacyPortfolioBoundaryHeaders(boundary: LegacyPortfolioBoundary) {
  return {
    "Cache-Control": "no-store",
    "X-SignalCore-Deprecated": "true",
    "X-SignalCore-Canonical-Endpoint": boundary.canonicalReadEndpoint,
  };
}

export function attachLegacyPortfolioBoundary(body: Record<string, unknown>, mode: AutopilotMode | string | null | undefined) {
  const boundary = legacyPortfolioBoundary(mode);
  return {
    deprecated: true,
    ...boundary,
    ...body,
  };
}
