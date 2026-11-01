import { normalizeCatalogCandidate, type CatalogCandidate, type CatalogQuery, type CatalogSource, type MicRole } from "./instrumentDiscovery";
import { CatalogConnectorError, classifyCatalogResponse, requireCatalogLicense, resultForCandidates, type CatalogConnector, type CatalogTransport } from "./catalogConnector";

type JsonRecord = Record<string, unknown>;
function record(value: unknown): JsonRecord | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null; }
function text(value: unknown, field: string): string { if (typeof value !== "string" || value.trim().length === 0) throw new CatalogConnectorError("INVALID_PROVIDER_RESPONSE"); return value.trim(); }
function optionalText(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function validMicRole(value: unknown): value is MicRole { return value === "OPERATING" || value === "SEGMENT"; }

export function createTwelveDataCatalogConnector(input: Readonly<{
  env: Readonly<Record<string, string | undefined>>;
  source: CatalogSource;
  transport?: CatalogTransport;
  endpoint?: string;
  apiKeyEnv?: string;
}>): CatalogConnector {
  if (!input.transport) throw new CatalogConnectorError("PROVIDER_UNAVAILABLE");
  const transport = input.transport;
  const endpoint = input.endpoint ?? "https://api.twelvedata.com/symbol_search";
  if (input.source.providerKey !== "TWELVE_DATA" || new URL(endpoint).origin !== "https://api.twelvedata.com") throw new CatalogConnectorError("INVALID_REQUEST");
  requireCatalogLicense(input.source);
  const request = async (params: URLSearchParams, query: CatalogQuery, lookupReference?: string): Promise<ReturnType<typeof resultForCandidates>> => {
    const apiKey = input.env[input.apiKeyEnv ?? "TWELVE_DATA_API_KEY"];
    if (!apiKey) throw new CatalogConnectorError("PROVIDER_REJECTED", 401);
    const url = new URL(endpoint);
    for (const [key, value] of params) url.searchParams.set(key, value);
    let response: Response;
    try { response = await transport(url.toString(), { method: "GET", headers: { Accept: "application/json", Authorization: `apikey ${apiKey}` }, cache: "no-store", redirect: "error" }); }
    catch { throw new CatalogConnectorError("PROVIDER_UNAVAILABLE"); }
    classifyCatalogResponse(response);
    let body: unknown;
    try { body = JSON.parse(await response.text()) as unknown; } catch { throw new CatalogConnectorError("INVALID_PROVIDER_RESPONSE"); }
    const root = record(body);
    if (!root || root.status !== "ok" || !Array.isArray(root.data)) throw new CatalogConnectorError("INVALID_PROVIDER_RESPONSE");
    const candidates = root.data.map(item => fromTwelveData(item, input.source));
    if (lookupReference && !candidates.some(candidate => candidate.providerReference.providerReference === lookupReference)) throw new CatalogConnectorError("NO_RESULTS");
    return resultForCandidates(query, candidates);
  };
  return {
    providerKey: "TWELVE_DATA",
    search: async query => {
      const normalized = { ...query, ...(query.ticker ? { ticker: query.ticker } : {}) };
      const params = new URLSearchParams();
      const searchTerm = normalized.ticker ?? normalized.name ?? normalized.identifiers?.[0]?.value;
      if (!searchTerm) throw new CatalogConnectorError("INVALID_REQUEST");
      params.set("symbol", searchTerm);
      params.set("outputsize", "100");
      return request(params, normalized);
    },
    lookup: async (providerReference, scope = "LISTING") => request(new URLSearchParams({ symbol: providerReference }), { ticker: providerReference, identifiers: [{ type: "PROVIDER_NATIVE", value: providerReference, scope }] }, providerReference),
  };
}

function fromTwelveData(value: unknown, source: CatalogSource): CatalogCandidate {
  const row = record(value);
  if (!row) throw new CatalogConnectorError("INVALID_PROVIDER_RESPONSE");
  const symbol = text(row.symbol, "symbol");
  const mic = optionalText(row.mic_code)?.toUpperCase() ?? null;
  const micRole = row.mic_role === null || row.mic_role === undefined ? null : row.mic_role;
  if (micRole !== null && !validMicRole(micRole)) throw new CatalogConnectorError("INVALID_PROVIDER_RESPONSE");
  const currency = text(row.currency, "currency").toUpperCase();
  const type = text(row.instrument_type, "instrument_type");
  const assetClass = type === "ETF" ? "ETF" : type === "Common Stock" ? "EQUITY" : type === "Physical Currency" ? "FX" : null;
  if (!assetClass) throw new CatalogConnectorError("INVALID_PROVIDER_RESPONSE");
  const listingRef = `${source.providerKey}:${symbol}:${mic ?? "NO_MIC"}`;
  const candidate: CatalogCandidate = {
    issuer: null,
    instrument: null,
    listing: { listingRef, ticker: symbol, mic, micRole: micRole as MicRole | null, tradingCurrency: currency, validity: { validFrom: null, validTo: null } },
    providerReference: { providerKey: source.providerKey, providerReference: symbol, identifierType: "PROVIDER_NATIVE", scope: "LISTING", source, validity: { validFrom: null, validTo: null } },
    identifiers: [{ type: "PROVIDER_NATIVE", value: symbol, scope: "LISTING", source, evidenceKind: "PROVIDER_CATALOG", strength: "STRONG", verified: false, validity: { validFrom: null, validTo: null }, marketMic: mic }],
    descriptiveName: text(row.instrument_name, "instrument_name"),
    descriptiveAssetClass: assetClass,
    descriptiveCurrency: currency,
    source,
  };
  return normalizeCatalogCandidate(candidate);
}
