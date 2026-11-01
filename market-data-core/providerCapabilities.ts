import type { CanonicalResolution } from "./canonicalIdentityResolver";
import type { TemporalValidity, MicRole } from "./instrumentDiscovery";

export type CapabilityService = "CATALOG_DISCOVERY" | "MARKET_DATA";
export type CapabilityKnowledge = "KNOWN" | "UNKNOWN";
export type OperationalState = "AVAILABLE" | "DEGRADED" | "UNAVAILABLE" | "BACKOFF" | "RATE_LIMITED";
export type Granularity = "1day" | "1hour" | "1min";
export type Adjustment = "none" | "splits" | "dividends" | "all";

export type ProviderRights = Readonly<{
  policyId: string;
  query: boolean;
  store: boolean;
  display: boolean;
  retain: boolean;
  share: boolean;
  valid: TemporalValidity;
}>;

export type ProviderCost = Readonly<{ currency: string; credits: number | null; knowledge: CapabilityKnowledge }>;
export type ProviderQuota = Readonly<{ remaining: number | null; knowledge: CapabilityKnowledge }>;
export type ProviderQuality = Readonly<{ coverage: "KNOWN" | "UNKNOWN"; freshness: "KNOWN" | "UNKNOWN"; integrity: "KNOWN" | "UNKNOWN"; score: number | null }>;

export type ProviderCapability = Readonly<{
  providerKey: string;
  service: CapabilityService;
  assetClasses: readonly ("EQUITY" | "ETF" | "FX")[] | null;
  markets: readonly Readonly<{ mic: string; role: MicRole | null }>[] | null;
  currencies: readonly string[] | null;
  coverage: TemporalValidity | null;
  granularities: readonly Granularity[] | null;
  adjustments: readonly Adjustment[] | null;
  operational: OperationalState;
  quality: ProviderQuality;
  rights: ProviderRights;
  cost: ProviderCost;
  quota: ProviderQuota;
  source: Readonly<{ sourceId: string; observedAt: string; snapshotId: string }>;
}>;

export type RoutingRequest = Readonly<{
  identity: CanonicalResolution;
  service: CapabilityService;
  mic: string;
  micRole: MicRole | null;
  assetClass: "EQUITY" | "ETF" | "FX";
  currency: string;
  from: string;
  to: string;
  granularity: Granularity;
  adjustment: Adjustment;
  asOf: string;
  rights: Readonly<{ query: boolean; store: boolean; display: boolean; retain: boolean; share: boolean; policyId?: string }>;
  maxCredits: number | null;
}>;

export type RoutingStatus = "READY" | "NO_ELIGIBLE_PROVIDER" | "LICENSE_BLOCKED" | "COST_UNKNOWN" | "QUOTA_UNAVAILABLE" | "PROVIDER_UNAVAILABLE" | "IDENTITY_UNRESOLVED";
export type ExclusionReason = "SERVICE_UNSUPPORTED" | "MARKET_UNSUPPORTED" | "ASSET_CLASS_UNSUPPORTED" | "CURRENCY_UNSUPPORTED" | "HISTORY_UNSUPPORTED" | "GRANULARITY_UNSUPPORTED" | "ADJUSTMENT_UNSUPPORTED" | "LICENSE_BLOCKED" | "COST_UNKNOWN" | "QUOTA_UNAVAILABLE" | "PROVIDER_UNAVAILABLE" | "IDENTITY_UNRESOLVED";
export type RoutingDecision = Readonly<{
  status: RoutingStatus;
  selected: ProviderCapability | null;
  alternatives: readonly ProviderCapability[];
  estimatedCost: ProviderCost | null;
  exclusions: readonly Readonly<{ providerKey: string; reason: ExclusionReason }>[];
  justification: string;
  demandKey: string;
}>;
