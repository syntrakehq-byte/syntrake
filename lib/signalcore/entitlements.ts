import type { AutopilotMode } from "@/lib/signalcore/modes";

export type AccessTier = "free" | "trial" | "pro";

export type EntitledViewKey =
  | "daily"
  | "planning"
  | "advisor"
  | "research"
  | "reports"
  | "settings"
  | "portfolio"
  | "broker"
  | "autonomy"
  | "trading"
  | "opportunities"
  | "execution"
  | "risk"
  | "journal"
  | "alerts";

export type AccessEntitlements = {
  tier: AccessTier;
  allowedModes: AutopilotMode[];
  investingViews: EntitledViewKey[];
  tradingViews: EntitledViewKey[];
  lockedTradingViews: EntitledViewKey[];
  trading: {
    discoveryInstrumentLimit: number | null;
    visibleHistoryDays: number | null;
    weeklyOpportunityBudget: number | null;
    executionEnabled: boolean;
    riskEnabled: boolean;
    journalEnabled: boolean;
    alertsEnabled: boolean;
    marketCoverage: "discovery" | "full";
  };
};

const INVESTING_VIEWS: EntitledViewKey[] = ["daily", "portfolio", "broker", "planning", "research", "reports", "autonomy", "settings"];
const FULL_TRADING_VIEWS: EntitledViewKey[] = ["trading", "opportunities", "execution", "risk", "journal", "alerts"];
const DISCOVERY_TRADING_VIEWS: EntitledViewKey[] = ["trading", "opportunities"];
const LOCKED_DISCOVERY_TRADING_VIEWS: EntitledViewKey[] = ["execution", "risk", "journal", "alerts"];

const ENTITLEMENTS_BY_TIER: Record<AccessTier, AccessEntitlements> = {
  free: {
    tier: "free",
    allowedModes: ["investing", "trading"],
    investingViews: INVESTING_VIEWS,
    tradingViews: DISCOVERY_TRADING_VIEWS,
    lockedTradingViews: LOCKED_DISCOVERY_TRADING_VIEWS,
    trading: {
      discoveryInstrumentLimit: 3,
      visibleHistoryDays: 7,
      weeklyOpportunityBudget: 3,
      executionEnabled: false,
      riskEnabled: false,
      journalEnabled: false,
      alertsEnabled: false,
      marketCoverage: "discovery",
    },
  },
  trial: {
    tier: "trial",
    allowedModes: ["investing", "trading"],
    investingViews: INVESTING_VIEWS,
    tradingViews: FULL_TRADING_VIEWS,
    lockedTradingViews: [],
    trading: {
      discoveryInstrumentLimit: null,
      visibleHistoryDays: null,
      weeklyOpportunityBudget: null,
      executionEnabled: true,
      riskEnabled: true,
      journalEnabled: true,
      alertsEnabled: true,
      marketCoverage: "full",
    },
  },
  pro: {
    tier: "pro",
    allowedModes: ["investing", "trading"],
    investingViews: INVESTING_VIEWS,
    tradingViews: FULL_TRADING_VIEWS,
    lockedTradingViews: [],
    trading: {
      discoveryInstrumentLimit: null,
      visibleHistoryDays: null,
      weeklyOpportunityBudget: null,
      executionEnabled: true,
      riskEnabled: true,
      journalEnabled: true,
      alertsEnabled: true,
      marketCoverage: "full",
    },
  },
};

export function resolveAccessTier(args: {
  billingPaid?: boolean | null;
  hasProAccess?: boolean | null;
  trialActive?: boolean | null;
}): AccessTier {
  if (args.billingPaid || (args.hasProAccess && !args.trialActive)) {
    return "pro";
  }

  if (args.trialActive) {
    return "trial";
  }

  return "free";
}

export function getEntitlementsForTier(tier: AccessTier): AccessEntitlements {
  return ENTITLEMENTS_BY_TIER[tier];
}

export function getAllowedModesForTier(tier: AccessTier): AutopilotMode[] {
  return getEntitlementsForTier(tier).allowedModes;
}

export function canAccessMode(args: {
  tier: AccessTier;
  mode: AutopilotMode;
}): boolean {
  return getAllowedModesForTier(args.tier).includes(args.mode);
}

export function canAccessView(args: {
  tier: AccessTier;
  mode: AutopilotMode;
  view: EntitledViewKey;
}): boolean {
  const entitlements = getEntitlementsForTier(args.tier);
  const allowedViews = args.mode === "trading" ? entitlements.tradingViews : entitlements.investingViews;
  return allowedViews.includes(args.view);
}

export function getLockedViewsForMode(args: {
  tier: AccessTier;
  mode: AutopilotMode;
}): EntitledViewKey[] {
  const entitlements = getEntitlementsForTier(args.tier);
  return args.mode === "trading" ? entitlements.lockedTradingViews : [];
}

