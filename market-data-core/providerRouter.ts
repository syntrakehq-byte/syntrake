import { createHash } from "node:crypto";
import type { CanonicalIdentity } from "./canonicalIdentityResolver";
import { type ProviderCapability, type RoutingDecision, type RoutingRequest, type ExclusionReason } from "./providerCapabilities";

const day = /^\d{4}-\d{2}-\d{2}$/;
function inWindow(asOf: string, value: { validFrom: string | null; validTo: string | null } | null): boolean {
  const asOfDay = day.test(asOf) ? asOf : /^\d{4}-\d{2}-\d{2}T/.test(asOf) ? asOf.slice(0, 10) : null;
  if (!value || asOfDay === null) return false;
  return (value.validFrom === null || asOfDay >= value.validFrom) && (value.validTo === null || asOfDay < value.validTo);
}
function demandKey(input: RoutingRequest): string {
  return createHash("sha256").update(JSON.stringify({ listing: input.identity.identity?.listingRef ?? null, service: input.service, mic: input.mic, micRole: input.micRole, asset: input.assetClass, currency: input.currency, from: input.from, to: input.to, granularity: input.granularity, adjustment: input.adjustment, asOf: input.asOf, rights: input.rights })).digest("hex");
}
function identityReady(input: RoutingRequest): input is RoutingRequest & { identity: { status: "EXACT"; identity: CanonicalIdentity } } {
  return input.identity.status === "EXACT" && input.identity.identity !== null;
}
function marketMatches(cap: ProviderCapability, input: RoutingRequest): boolean {
  return cap.markets !== null && cap.markets.some(x => x.mic === input.mic && (input.micRole === null || x.role === input.micRole));
}
function rightsMatch(cap: ProviderCapability, input: RoutingRequest): boolean {
  return cap.rights.policyId === (input.rights.policyId ?? cap.rights.policyId) &&
    (!input.rights.query || cap.rights.query) && (!input.rights.store || cap.rights.store) &&
    (!input.rights.display || cap.rights.display) && (!input.rights.retain || cap.rights.retain) && (!input.rights.share || cap.rights.share) &&
    inWindow(input.asOf, cap.rights.valid);
}
function exclusion(cap: ProviderCapability, input: RoutingRequest): ExclusionReason | null {
  if (cap.service !== input.service) return "SERVICE_UNSUPPORTED";
  if (!marketMatches(cap, input)) return "MARKET_UNSUPPORTED";
  if (cap.assetClasses === null || !cap.assetClasses.includes(input.assetClass)) return "ASSET_CLASS_UNSUPPORTED";
  if (cap.currencies === null || !cap.currencies.includes(input.currency)) return "CURRENCY_UNSUPPORTED";
  if (!inWindow(input.asOf, cap.coverage) || input.from > input.to || cap.coverage !== null && (input.from < (cap.coverage.validFrom ?? input.from) || cap.coverage.validTo !== null && input.to >= cap.coverage.validTo)) return "HISTORY_UNSUPPORTED";
  if (cap.granularities === null || !cap.granularities.includes(input.granularity)) return "GRANULARITY_UNSUPPORTED";
  if (cap.adjustments === null || !cap.adjustments.includes(input.adjustment)) return "ADJUSTMENT_UNSUPPORTED";
  if (!rightsMatch(cap, input)) return "LICENSE_BLOCKED";
  if (cap.cost.knowledge !== "KNOWN" || cap.cost.credits === null) return "COST_UNKNOWN";
  if (input.maxCredits !== null && cap.cost.credits > input.maxCredits) return "COST_UNKNOWN";
  if (cap.quota.knowledge !== "KNOWN" || cap.quota.remaining === null || cap.quota.remaining < cap.cost.credits) return "QUOTA_UNAVAILABLE";
  if (cap.operational === "UNAVAILABLE" || cap.operational === "BACKOFF" || cap.operational === "RATE_LIMITED") return "PROVIDER_UNAVAILABLE";
  return null;
}
function statusFor(reasons: readonly ExclusionReason[]): RoutingDecision["status"] {
  if (reasons.includes("LICENSE_BLOCKED")) return "LICENSE_BLOCKED";
  if (reasons.includes("COST_UNKNOWN")) return "COST_UNKNOWN";
  if (reasons.includes("QUOTA_UNAVAILABLE")) return "QUOTA_UNAVAILABLE";
  if (reasons.includes("PROVIDER_UNAVAILABLE")) return "PROVIDER_UNAVAILABLE";
  return "NO_ELIGIBLE_PROVIDER";
}
export function routeProvider(input: RoutingRequest, capabilities: readonly ProviderCapability[]): RoutingDecision {
  const key = demandKey(input);
  if (!identityReady(input)) return { status: "IDENTITY_UNRESOLVED", selected: null, alternatives: [], estimatedCost: null, exclusions: [], justification: "Canonical identity is not EXACT; routing fails closed.", demandKey: key };
  const eligible: ProviderCapability[] = [];
  const exclusions: { providerKey: string; reason: ExclusionReason }[] = [];
  for (const cap of capabilities) { const reason = exclusion(cap, input); if (reason) exclusions.push({ providerKey: cap.providerKey, reason }); else eligible.push(cap); }
  if (eligible.length === 0) return { status: statusFor(exclusions.map(x => x.reason)), selected: null, alternatives: [], estimatedCost: null, exclusions, justification: "No provider satisfies every mandatory requirement; no call or reservation is authorized.", demandKey: key };
  eligible.sort((a, b) => (a.cost.credits! - b.cost.credits!) || a.providerKey.localeCompare(b.providerKey));
  const [selected, ...alternatives] = eligible;
  return { status: "READY", selected, alternatives, estimatedCost: selected.cost, exclusions, justification: `Selected ${selected.providerKey} by known cost, then provider key deterministic tie-break.`, demandKey: key };
}
