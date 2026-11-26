import { createDiscoveryResult, normalizeCatalogQuery, type CatalogCandidate, type CatalogQuery, type CatalogSource, type DiscoveryResult } from "./instrumentDiscovery";

export type CatalogConnectorErrorCode = "INVALID_REQUEST" | "PROVIDER_REJECTED" | "RATE_LIMITED" | "PROVIDER_UNAVAILABLE" | "INVALID_PROVIDER_RESPONSE" | "NO_RESULTS" | "LICENSE_BLOCKED";

export class CatalogConnectorError extends Error {
  readonly code: CatalogConnectorErrorCode;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;
  constructor(code: CatalogConnectorErrorCode, status: number | null = null, retryAfterSeconds: number | null = null) {
    super(code);
    this.name = "CatalogConnectorError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type CatalogConnector = Readonly<{
  providerKey: string;
  search(query: CatalogQuery): Promise<DiscoveryResult>;
  lookup(providerReference: string, scope?: "INSTRUMENT" | "LISTING"): Promise<DiscoveryResult>;
}>;

export type CatalogTransport = (url: string, init: RequestInit) => Promise<Response>;

export function requireCatalogLicense(source: CatalogSource): void {
  if (!source.storageAllowed || !source.sharingAllowed && !source.storageAllowed) {
    throw new CatalogConnectorError("LICENSE_BLOCKED");
  }
}

export function resultForCandidates(query: CatalogQuery, candidates: readonly CatalogCandidate[]): DiscoveryResult {
  const normalizedQuery = normalizeCatalogQuery(query);
  if (candidates.length === 0) return createDiscoveryResult(normalizedQuery, []);
  return createDiscoveryResult(normalizedQuery, candidates);
}

export function classifyCatalogResponse(response: Response): never | void {
  if (response.status === 429) {
    const raw = response.headers.get("retry-after");
    const seconds = raw && /^\d{1,5}$/.test(raw) ? Number(raw) : null;
    throw new CatalogConnectorError("RATE_LIMITED", 429, seconds !== null && seconds <= 86_400 ? seconds : null);
  }
  if (response.status === 401 || response.status === 403) throw new CatalogConnectorError("PROVIDER_REJECTED", response.status);
  if (response.status === 400 || response.status === 404 || response.status === 422) throw new CatalogConnectorError("INVALID_REQUEST", response.status);
  if (response.status >= 500 && response.status <= 599) throw new CatalogConnectorError("PROVIDER_UNAVAILABLE", response.status);
  if (!response.ok) throw new CatalogConnectorError("PROVIDER_UNAVAILABLE", response.status);
}
