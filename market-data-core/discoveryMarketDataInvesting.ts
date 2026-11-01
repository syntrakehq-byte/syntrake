import { onboardCatalog, type CatalogOnboardingInput } from "./catalogOnboarding";
import { routeProvider } from "./providerRouter";
import type { ProviderCapability, RoutingDecision, RoutingRequest } from "./providerCapabilities";
import type { CatalogCandidate } from "./instrumentDiscovery";
import type { CanonicalResolution } from "./canonicalIdentityResolver";
import type { OfflineProvider } from "./offlinePipeline";
import { quantityToAtoms } from "../investing-core/portfolio/portfolioImportDraft";

export type InvestingDiscoveryQuote = Readonly<{
  status: "READY" | "AMBIGUOUS" | "REVIEW_REQUIRED" | "UNRESOLVED" | "ROUTING_BLOCKED";
  candidates: readonly CatalogCandidate[];
  resolutions: readonly CanonicalResolution[];
  routing: RoutingDecision | null;
  providerKey: string | null;
  listingRef: string | null;
  quantityAtoms: bigint | null;
  close: string | null;
  positionValue: string | null;
  reason: string;
}>;

type Decimal = Readonly<{ units: bigint; scale: bigint }>;
function decimal(value: string): Decimal {
  if (!/^(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/.test(value)) throw new Error("INVALID_PRICE");
  const [whole, fraction = ""] = value.split(".");
  return { units: BigInt(whole) * 1_000_000_000_000n + BigInt(fraction.padEnd(12, "0")), scale: 1_000_000_000_000n };
}
function formatScaled(units: bigint): string {
  const whole = units / 1_000_000_000_000n;
  const fraction = (units % 1_000_000_000_000n).toString().padStart(12, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/**
 * Offline composition seam: D2 onboarding -> D3 resolution -> D4 routing ->
 * existing R3-C provider seam. It never writes a ledger and never chooses an
 * ambiguous candidate. The caller supplies the already-authorized R3-C claim.
 */
export async function discoverMarketDataForInvesting(input: Readonly<{
  onboarding: CatalogOnboardingInput;
  capabilities: readonly ProviderCapability[];
  routing: Omit<RoutingRequest, "identity" | "mic" | "micRole" | "assetClass" | "currency">;
  provider: OfflineProvider;
  claim: Parameters<OfflineProvider>[0];
  selectedProviderId: string;
  quantity: string;
}>): Promise<InvestingDiscoveryQuote> {
  const onboarded = await onboardCatalog(input.onboarding);
  const resolutions = onboarded.resolutions;
  const exact = resolutions.filter(x => x.status === "EXACT" && x.identity !== null);
  if (exact.length !== 1) {
    const status = resolutions.length === 0 ? "UNRESOLVED" : resolutions.some(x => x.status === "AMBIGUOUS") ? "AMBIGUOUS" : "REVIEW_REQUIRED";
    return { status, candidates: onboarded.discovery.candidates, resolutions, routing: null, providerKey: null, listingRef: null, quantityAtoms: null, close: null, positionValue: null, reason: "Canonical identity is not uniquely resolved; no market-data call is authorized." };
  }
  const identity = exact[0].identity!;
  const routing = routeProvider({ ...input.routing, identity: exact[0], mic: identity.listing.mic!, micRole: identity.listing.micRole, assetClass: identity.assetClass, currency: identity.listing.tradingCurrency }, input.capabilities);
  if (routing.status !== "READY" || !routing.selected) return { status: "ROUTING_BLOCKED", candidates: onboarded.discovery.candidates, resolutions, routing, providerKey: null, listingRef: identity.listingRef, quantityAtoms: null, close: null, positionValue: null, reason: routing.justification };
  if (input.claim.listing_id !== identity.listingRef || input.claim.provider_key !== routing.selected.providerKey || input.claim.provider_id !== input.selectedProviderId) return { status: "ROUTING_BLOCKED", candidates: onboarded.discovery.candidates, resolutions, routing, providerKey: routing.selected.providerKey, listingRef: identity.listingRef, quantityAtoms: null, close: null, positionValue: null, reason: "R3-C claim does not match the D3/D4 decision." };
  const quantityAtoms = quantityToAtoms(input.quantity);
  const envelope = await input.provider(input.claim);
  const candle = (envelope as { value?: readonly { close: string }[] }).value?.[0];
  if (!candle) return { status: "ROUTING_BLOCKED", candidates: onboarded.discovery.candidates, resolutions, routing, providerKey: routing.selected.providerKey, listingRef: identity.listingRef, quantityAtoms, close: null, positionValue: null, reason: "Provider returned no validated candle." };
  const close = decimal(candle.close);
  return { status: "READY", candidates: onboarded.discovery.candidates, resolutions, routing, providerKey: routing.selected.providerKey, listingRef: identity.listingRef, quantityAtoms, close: candle.close, positionValue: formatScaled(close.units * quantityAtoms / close.scale), reason: "Discovery, canonical resolution, routing and offline price validation completed; position remains unverified." };
}
