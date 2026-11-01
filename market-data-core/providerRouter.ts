import { createHash } from "node:crypto";
import type { CanonicalIdentity } from "./canonicalIdentityResolver";
import { type ProviderCapability, type RoutingDecision, type RoutingRequest, type ExclusionReason } from "./providerCapabilities";

const day = /^\d{4}-\d{2}-\d{2}$/;
function validDay(value: string): boolean { if (!day.test(value)) return false; const d = new Date(`${value}T00:00:00.000Z`); return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === value; }
function validTimestamp(value: string): boolean { if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false; const d = new Date(value); return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 19) === value.replace(/\.\d{1,3}Z$/, "Z").slice(0, 19); }
function validWindow(value: { validFrom: string | null; validTo: string | null } | null): boolean { return value !== null && (value.validFrom === null || validDay(value.validFrom)) && (value.validTo === null || validDay(value.validTo)) && (value.validFrom === null || value.validTo === null || value.validFrom < value.validTo); }
function inWindow(asOf: string, value: { validFrom: string | null; validTo: string | null } | null): boolean { const d = validDay(asOf) ? asOf : validTimestamp(asOf) ? asOf.slice(0, 10) : null; if (!value || d === null || value.validFrom !== null && !validDay(value.validFrom) || value.validTo !== null && !validDay(value.validTo)) return false; return (value.validFrom === null || d >= value.validFrom) && (value.validTo === null || d < value.validTo); }
function routingDecisionKey(input: RoutingRequest): string { return createHash("sha256").update(JSON.stringify({ listing: input.identity?.identity?.listingRef ?? null, service: input.service, mic: input.mic, micRole: input.micRole, asset: input.assetClass, currency: input.currency, from: input.from, to: input.to, granularity: input.granularity, adjustment: input.adjustment, asOf: input.asOf, rights: input.rights, quality: input.quality, maxEconomicCost: input.maxEconomicCost })).digest("hex"); }
function identityReady(input: RoutingRequest): input is RoutingRequest & { identity: { status: "EXACT"; identity: CanonicalIdentity } } { return input.identity?.status === "EXACT" && input.identity.identity !== null; }
function identityMatches(input: RoutingRequest): boolean {
  if (!validTimestamp(input.asOf) || !validDay(input.from) || !validDay(input.to) || input.from > input.to) return false;
  const identity = input.identity?.identity;
  if (!identity || identity.listing.mic !== input.mic || identity.listing.micRole !== input.micRole || identity.assetClass !== input.assetClass || identity.listing.tradingCurrency !== input.currency) return false;
  return inWindow(input.asOf, identity.validity) && inWindow(input.asOf, identity.listing.validity) && inWindow(input.from, identity.validity) && inWindow(input.to, identity.validity) && inWindow(input.from, identity.listing.validity) && inWindow(input.to, identity.listing.validity);
}
function marketMatches(cap: ProviderCapability, input: RoutingRequest): boolean { return cap.markets !== null && cap.markets.some(x => x.mic === input.mic && x.role === input.micRole); }
function capabilityShapeValid(cap: ProviderCapability, input: RoutingRequest): boolean {
  const amount = cap.cost.nativeAmount; const remaining = cap.quota.remaining; const economic = cap.cost.economic;
  return cap.providerKey.length > 0 && cap.source.sourceId.length > 0 && cap.source.snapshotId.length > 0 && validTimestamp(cap.source.observedAt) && new Date(cap.source.observedAt) <= new Date(input.asOf) && validWindow(cap.coverage) && cap.cost.nativeUnit.length > 0 && cap.quota.nativeUnit === cap.cost.nativeUnit && (cap.cost.knowledge === "UNKNOWN" ? amount === null : amount !== null && Number.isSafeInteger(amount) && amount >= 0) && (cap.quota.knowledge === "UNKNOWN" ? remaining === null : remaining !== null && Number.isSafeInteger(remaining) && remaining >= 0) && (economic === null || /^[A-Z]{3}$/.test(economic.currency) && Number.isFinite(economic.amount) && economic.amount >= 0) && (cap.quality.score === null || Number.isFinite(cap.quality.score) && cap.quality.score >= 0 && cap.quality.score <= 100);
}
function requestShapeValid(input: RoutingRequest): boolean {
  const max = input.maxEconomicCost; const score = input.quality?.minScore;
  return validTimestamp(input.asOf) && validDay(input.from) && validDay(input.to) && input.from <= input.to && (max === null || /^[A-Z]{3}$/.test(max.currency) && Number.isFinite(max.amount) && max.amount >= 0) && (score === null || Number.isFinite(score) && score >= 0 && score <= 100);
}
function qualityMatches(cap: ProviderCapability, input: RoutingRequest): boolean { return (!input.quality.requireCoverage || cap.quality.coverage === "KNOWN") && (!input.quality.requireFreshness || cap.quality.freshness === "KNOWN") && (!input.quality.requireIntegrity || cap.quality.integrity === "KNOWN") && (input.quality.minScore === null || cap.quality.score !== null && cap.quality.score >= input.quality.minScore); }
function rightsMatch(cap: ProviderCapability, input: RoutingRequest): boolean { return cap.rights.policyId === (input.rights.policyId ?? cap.rights.policyId) && (!input.rights.query || cap.rights.query) && (!input.rights.store || cap.rights.store) && (!input.rights.display || cap.rights.display) && (!input.rights.retain || cap.rights.retain) && (!input.rights.share || cap.rights.share) && inWindow(input.asOf, cap.rights.valid) && inWindow(input.from, cap.rights.valid) && inWindow(input.to, cap.rights.valid); }
function exclusion(cap: ProviderCapability, input: RoutingRequest): ExclusionReason | null {
  if (!capabilityShapeValid(cap, input)) return "INVALID_CAPABILITY";
  if (cap.service !== input.service) return "SERVICE_UNSUPPORTED";
  if (!qualityMatches(cap, input)) return "QUALITY_UNPROVEN";
  if (!marketMatches(cap, input)) return "MARKET_UNSUPPORTED";
  if (cap.assetClasses === null || !cap.assetClasses.includes(input.assetClass)) return "ASSET_CLASS_UNSUPPORTED";
  if (cap.currencies === null || !cap.currencies.includes(input.currency)) return "CURRENCY_UNSUPPORTED";
  if (!validDay(input.from) || !validDay(input.to) || input.from > input.to || cap.coverage === null || cap.coverage.validFrom !== null && input.from < cap.coverage.validFrom || cap.coverage.validTo !== null && input.to >= cap.coverage.validTo) return "HISTORY_UNSUPPORTED";
  if (!inWindow(input.asOf, { validFrom: cap.source.observedAt.slice(0, 10), validTo: null })) return "INVALID_CAPABILITY";
  if (cap.granularities === null || !cap.granularities.includes(input.granularity)) return "GRANULARITY_UNSUPPORTED";
  if (cap.adjustments === null || !cap.adjustments.includes(input.adjustment)) return "ADJUSTMENT_UNSUPPORTED";
  if (!rightsMatch(cap, input)) return "LICENSE_BLOCKED";
  if (cap.cost.knowledge === "UNKNOWN") return "COST_UNKNOWN";
  if (cap.quota.knowledge === "UNKNOWN") return "QUOTA_UNAVAILABLE";
  if (cap.quota.remaining! < cap.cost.nativeAmount!) return "QUOTA_UNAVAILABLE";
  if (cap.operational !== "AVAILABLE") return "PROVIDER_UNAVAILABLE";
  if (input.maxEconomicCost !== null && (cap.cost.economic === null || cap.cost.economic.currency !== input.maxEconomicCost.currency)) return "COST_UNKNOWN";
  if (input.maxEconomicCost !== null && cap.cost.economic!.amount > input.maxEconomicCost.amount) return "COST_LIMIT";
  return null;
}
function statusFor(reasons: readonly ExclusionReason[]): RoutingDecision["status"] { if (reasons.includes("LICENSE_BLOCKED")) return "LICENSE_BLOCKED"; if (reasons.includes("COST_UNKNOWN")) return "COST_UNKNOWN"; if (reasons.includes("QUOTA_UNAVAILABLE")) return "QUOTA_UNAVAILABLE"; if (reasons.includes("PROVIDER_UNAVAILABLE")) return "PROVIDER_UNAVAILABLE"; return "NO_ELIGIBLE_PROVIDER"; }
export function routeProvider(input: RoutingRequest, capabilities: readonly ProviderCapability[]): RoutingDecision {
  const key = routingDecisionKey(input);
  if (!requestShapeValid(input)) return { status: "NO_ELIGIBLE_PROVIDER", selected: null, alternatives: [], estimatedCost: null, exclusions: [], justification: "Invalid routing limits, quality threshold or temporal input; decision fails closed.", routingDecisionKey: key, coordinatorDemandKey: null };
  if (input.service === "MARKET_DATA" && (!identityReady(input) || !identityMatches(input))) return { status: "IDENTITY_UNRESOLVED", selected: null, alternatives: [], estimatedCost: null, exclusions: [], justification: "Canonical identity is not EXACT or does not match the requested listing scope.", routingDecisionKey: key, coordinatorDemandKey: null };
  if (input.service === "CATALOG_DISCOVERY" && input.identity?.status === "EXACT") return { status: "NO_ELIGIBLE_PROVIDER", selected: null, alternatives: [], estimatedCost: null, exclusions: [], justification: "Catalog discovery is independent of canonical identity and does not consume an EXACT resolution.", routingDecisionKey: key, coordinatorDemandKey: null };
  const eligible: ProviderCapability[] = []; const exclusions: { providerKey: string; reason: ExclusionReason }[] = [];
  for (const cap of capabilities) { const reason = exclusion(cap, input); if (reason) exclusions.push({ providerKey: cap.providerKey, reason }); else eligible.push(cap); }
  if (eligible.length === 0) return { status: statusFor(exclusions.map(x => x.reason)), selected: null, alternatives: [], estimatedCost: null, exclusions, justification: "No provider satisfies every mandatory requirement; no call or reservation is authorized.", routingDecisionKey: key, coordinatorDemandKey: null };
  const comparableCurrency = eligible[0].cost.economic?.currency; const comparable = comparableCurrency !== undefined && eligible.every(x => x.cost.economic?.currency === comparableCurrency);
  eligible.sort((a, b) => comparable ? a.cost.economic!.amount - b.cost.economic!.amount || a.providerKey.localeCompare(b.providerKey) : a.providerKey.localeCompare(b.providerKey)); const [selected, ...alternatives] = eligible;
  return { status: "READY", selected, alternatives, estimatedCost: selected.cost, exclusions, justification: comparable ? `Selected ${selected.providerKey} by comparable economic cost, then provider key deterministic tie-break.` : `Selected ${selected.providerKey} by deterministic provider key; native provider units are not comparable and no cheapest claim is made.`, routingDecisionKey: key, coordinatorDemandKey: null };
}
