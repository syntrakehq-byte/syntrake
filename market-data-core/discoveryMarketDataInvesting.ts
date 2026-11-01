import { onboardCatalog, type CatalogOnboardingInput } from "./catalogOnboarding";
import { routeProvider } from "./providerRouter";
import type { ProviderCapability, RoutingDecision, RoutingRequest } from "./providerCapabilities";
import { instrumentIdentity, type InstrumentIdentity } from "./identity";
import type { CatalogCandidate, CatalogQuery } from "./instrumentDiscovery";
import type { CatalogConnector } from "./catalogConnector";
import type { CanonicalResolution } from "./canonicalIdentityResolver";
import type { OfflineProvider } from "./offlinePipeline";
import { fetchDailySeries, type DailyCandle } from "./twelveData";
import { validateEnvelope } from "./contracts";
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
  identityVerified: boolean;
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
function previewInstrument(candidate: CatalogCandidate): InstrumentIdentity {
  if (!candidate.listing?.mic || !candidate.instrument && !candidate.descriptiveAssetClass ||
      !(candidate.instrument?.denominationCurrency ?? candidate.descriptiveCurrency)) throw new Error("DISCOVERY_IDENTITY_INCOMPLETE");
  return instrumentIdentity({
    kind: candidate.instrument?.assetClass ?? candidate.descriptiveAssetClass,
    symbol: candidate.listing.ticker,
    mic: candidate.listing.mic,
    currency: candidate.listing.tradingCurrency,
  });
}
function quoteFromEnvelope(raw: unknown, expected: InstrumentIdentity, rightsPolicyId: string): { close: string; marketDate: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("INVALID_PROVIDER_RESPONSE");
  const envelope = validateEnvelope<readonly DailyCandle[]>(raw, (value): value is readonly DailyCandle[] => Array.isArray(value) && value.length === 1 && value.every(c => typeof c === "object" && c !== null && typeof (c as Record<string, unknown>).marketDate === "string" && typeof (c as Record<string, unknown>).close === "string"));
  if (envelope.status !== "AVAILABLE" || !envelope.value) throw new Error("INVALID_PROVIDER_RESPONSE");
  const candle = envelope.value[0];
  if (envelope.rights.policyId !== rightsPolicyId || !envelope.rights.display || envelope.quality.coverage !== "FULL" || envelope.sourceRefs.length === 0 || envelope.sourceRefs[0].provider !== "TWELVE_DATA" || envelope.marketDate !== candle.marketDate) throw new Error("INVALID_PROVIDER_RESPONSE");
  decimal(candle.close);
  return { close: candle.close, marketDate: candle.marketDate };
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
  if (onboarded.discovery.status === "AMBIGUOUS" || exact.length !== 1) {
    const status = resolutions.length === 0 ? "UNRESOLVED" : resolutions.some(x => x.status === "AMBIGUOUS") ? "AMBIGUOUS" : "REVIEW_REQUIRED";
    return { status, candidates: onboarded.discovery.candidates, resolutions, routing: null, providerKey: null, listingRef: null, quantityAtoms: null, close: null, positionValue: null, identityVerified: false, reason: "Canonical identity is not uniquely resolved; no market-data call is authorized." };
  }
  const identity = exact[0].identity!;
  const routing = routeProvider({ ...input.routing, identity: exact[0], mic: identity.listing.mic!, micRole: identity.listing.micRole, assetClass: identity.assetClass, currency: identity.listing.tradingCurrency }, input.capabilities);
  if (routing.status !== "READY" || !routing.selected) return { status: "ROUTING_BLOCKED", candidates: onboarded.discovery.candidates, resolutions, routing, providerKey: null, listingRef: identity.listingRef, quantityAtoms: null, close: null, positionValue: null, identityVerified: true, reason: routing.justification };
  if (input.claim.listing_id !== identity.listingRef || input.claim.provider_key !== routing.selected.providerKey || input.claim.provider_id !== input.selectedProviderId) return { status: "ROUTING_BLOCKED", candidates: onboarded.discovery.candidates, resolutions, routing, providerKey: routing.selected.providerKey, listingRef: identity.listingRef, quantityAtoms: null, close: null, positionValue: null, identityVerified: true, reason: "R3-C claim does not match the D3/D4 decision." };
  const quantityAtoms = quantityToAtoms(input.quantity);
  const expected = instrumentIdentity({ kind: identity.assetClass, symbol: identity.listing.ticker, mic: identity.listing.mic!, currency: identity.listing.tradingCurrency });
  const quote = quoteFromEnvelope(await input.provider(input.claim), expected, input.claim.rights_policy_id);
  const close = decimal(quote.close);
  return { status: "READY", candidates: onboarded.discovery.candidates, resolutions, routing, providerKey: routing.selected.providerKey, listingRef: identity.listingRef, quantityAtoms, close: quote.close, positionValue: formatScaled(close.units * quantityAtoms / close.scale), identityVerified: true, reason: "Discovery, canonical resolution, routing and offline price validation completed; position remains unverified." };
}

/**
 * Provider discovery preview. It deliberately does not call persistence or D3:
 * a user may inspect/confirm a provider candidate before any canonical registry
 * onboarding. It is never a substitute for D4/R3-C on a sensitive operation.
 */
export async function discoverMarketDataPreview(input: Readonly<{
  connector: CatalogConnector;
  query: CatalogQuery;
  price: Readonly<{ env: Readonly<Record<string, string | undefined>>; transport?: Parameters<typeof fetchDailySeries>[0]["transport"]; clock?: Parameters<typeof fetchDailySeries>[0]["clock"]; quotaRemaining: number; estimatedCredits: number; rights: Readonly<{ policyId: string; query: boolean; display: boolean; retentionUntil: string | null }> }>;
  quantity: string;
  selectedCandidateIndex?: number;
}>): Promise<InvestingDiscoveryQuote> {
  const discovery = await input.connector.search(input.query);
  if (discovery.candidates.length === 0) return { status: "UNRESOLVED", candidates: [], resolutions: [], routing: null, providerKey: null, listingRef: null, quantityAtoms: null, close: null, positionValue: null, identityVerified: false, reason: "Provider returned no candidates." };
  if (discovery.candidates.length > 1 && input.selectedCandidateIndex === undefined) return { status: "AMBIGUOUS", candidates: discovery.candidates, resolutions: [], routing: null, providerKey: null, listingRef: null, quantityAtoms: null, close: null, positionValue: null, identityVerified: false, reason: "Multiple provider candidates require explicit user confirmation." };
  const index = input.selectedCandidateIndex ?? 0;
  const candidate = discovery.candidates[index];
  if (!candidate) return { status: "UNRESOLVED", candidates: discovery.candidates, resolutions: [], routing: null, providerKey: null, listingRef: null, quantityAtoms: null, close: null, positionValue: null, identityVerified: false, reason: "Selected candidate is not part of the provider result." };
  const instrument = previewInstrument(candidate);
  if (candidate.source.providerKey !== "TWELVE_DATA" || !input.price.rights.query || !input.price.rights.display || !Number.isSafeInteger(input.price.quotaRemaining) || input.price.quotaRemaining < 0 || !Number.isSafeInteger(input.price.estimatedCredits) || input.price.estimatedCredits < 0 || input.price.estimatedCredits > input.price.quotaRemaining) return { status: "ROUTING_BLOCKED", candidates: discovery.candidates, resolutions: [], routing: null, providerKey: candidate.source.providerKey, listingRef: candidate.listing?.listingRef ?? null, quantityAtoms: null, close: null, positionValue: null, identityVerified: false, reason: "Preview price request lacks authorized query/display rights or quota." };
  const quantityAtoms = quantityToAtoms(input.quantity);
  const series = await fetchDailySeries({ env: input.price.env, instrument, outputSize: 1, transport: input.price.transport, clock: input.price.clock, rights: { policyId: input.price.rights.policyId, display: true, retentionUntil: input.price.rights.retentionUntil } });
  const quote = quoteFromEnvelope(series.envelope, instrument, input.price.rights.policyId);
  const close = decimal(quote.close);
  return { status: "READY", candidates: discovery.candidates, resolutions: [], routing: null, providerKey: candidate.source.providerKey, listingRef: candidate.listing?.listingRef ?? null, quantityAtoms, close: quote.close, positionValue: formatScaled(close.units * quantityAtoms / close.scale), identityVerified: false, reason: "Provider discovery preview completed; candidate is descriptive/unverified and not eligible for sensitive execution." };
}
