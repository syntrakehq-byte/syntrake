import { discoverMarketDataPreview, type InvestingDiscoveryQuote } from "../market-data-core/discoveryMarketDataInvesting";
import type { CatalogConnector } from "../market-data-core/catalogConnector";
import type { CatalogSource } from "../market-data-core/instrumentDiscovery";

export type InvestingDeclaredHolding = Readonly<{
  query: Readonly<{ name: string }>;
  quantity: string;
}>;

export type InvestingMarketDataPreviewInput = Readonly<{
  connector: CatalogConnector;
  source: CatalogSource;
  price: Parameters<typeof discoverMarketDataPreview>[0]["price"];
  selectedCandidateIndex?: number;
}>;

export function parseInvestingDeclaredHolding(text: string): InvestingDeclaredHolding {
  const match = /^\s*Tenho\s+([0-9]+(?:\.[0-9]{1,12})?)\s+(?:ações?|shares?)\s+da\s+(.+?)\.?\s*$/iu.exec(text);
  if (!match || match[2].trim().length === 0) throw new Error("INVESTING_DECLARATION_INVALID");
  return Object.freeze({ query: { name: match[2].trim() }, quantity: match[1] });
}

/**
 * Server-side Investing seam. It delegates all discovery, pricing, rights and
 * quota checks to R3 and never writes the ledger or accepts browser credentials.
 */
export async function previewInvestingDeclaredHolding(
  declaration: string,
  input: InvestingMarketDataPreviewInput,
): Promise<InvestingDiscoveryQuote & Readonly<{ declaration: InvestingDeclaredHolding }>> {
  const parsed = parseInvestingDeclaredHolding(declaration);
  const quote = await discoverMarketDataPreview({
    connector: input.connector,
    query: parsed.query,
    quantity: parsed.quantity,
    price: input.price,
    selectedCandidateIndex: input.selectedCandidateIndex,
  });
  return Object.freeze({ ...quote, declaration: parsed });
}
