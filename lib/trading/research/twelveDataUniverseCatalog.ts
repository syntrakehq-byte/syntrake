import path from "node:path";
import { writeFile } from "node:fs/promises";

import { ensureDirectory, writeJsonAtomic } from "./fs";

export const TWELVEDATA_UNIVERSE_ENDPOINTS = [
  "forex_pairs",
  "cryptocurrencies",
  "stocks",
  "indices",
  "etf",
] as const;

export type TwelveDataUniverseEndpoint = (typeof TWELVEDATA_UNIVERSE_ENDPOINTS)[number];

export type TwelveDataUniverseEntry = {
  endpoint: TwelveDataUniverseEndpoint;
  symbol: string;
  name: string | null;
  exchange: string | null;
  micCode: string | null;
  country: string | null;
  currency: string | null;
  marketType: "forex" | "crypto" | "equities" | "indices" | "etf";
  raw: Record<string, unknown>;
};

export type TwelveDataUniverseCatalogReport = {
  reportId: string;
  generatedAt: string;
  storage: {
    outputDir: string;
    jsonPath: string;
    markdownPath: string;
  };
  summary: {
    totalSymbols: number;
    endpoints: Record<TwelveDataUniverseEndpoint, number>;
  };
  samples: Partial<Record<TwelveDataUniverseEndpoint, TwelveDataUniverseEntry>>;
};

type TwelveDataReferencePayload = {
  data?: Record<string, unknown>[];
};

function apiKey(): string {
  const key = process.env.TWELVEDATA_API_KEY?.trim();
  if (!key) {
    throw new Error("Missing TWELVEDATA_API_KEY for Twelve Data universe catalog.");
  }
  return key;
}

function resolveOutputDir(customDir?: string | null): string {
  const configured = customDir?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(process.cwd(), "artifacts", "trading-research", "reports", "datasets");
}

function marketTypeForEndpoint(endpoint: TwelveDataUniverseEndpoint): TwelveDataUniverseEntry["marketType"] {
  switch (endpoint) {
    case "forex_pairs":
      return "forex";
    case "cryptocurrencies":
      return "crypto";
    case "stocks":
      return "equities";
    case "indices":
      return "indices";
    case "etf":
      return "etf";
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeEntry(endpoint: TwelveDataUniverseEndpoint, raw: Record<string, unknown>): TwelveDataUniverseEntry | null {
  const symbol = readString(raw.symbol);
  if (!symbol) {
    return null;
  }

  return {
    endpoint,
    symbol,
    name: readString(raw.name) ?? readString(raw.currency_base),
    exchange: readString(raw.exchange),
    micCode: readString(raw.mic_code),
    country: readString(raw.country),
    currency: readString(raw.currency) ?? readString(raw.currency_quote),
    marketType: marketTypeForEndpoint(endpoint),
    raw,
  };
}

async function fetchEndpoint(endpoint: TwelveDataUniverseEndpoint): Promise<TwelveDataUniverseEntry[]> {
  const url = new URL(`https://api.twelvedata.com/${endpoint}`);
  url.searchParams.set("apikey", apiKey());

  const response = await fetch(url.toString(), { cache: "no-store" });
  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(`Twelve Data reference request failed for ${endpoint} (${response.status}): ${rawText}`);
  }

  let payload: TwelveDataReferencePayload | null = null;
  try {
    payload = JSON.parse(rawText) as TwelveDataReferencePayload;
  } catch {
    throw new Error(`Invalid JSON returned by Twelve Data reference endpoint: ${endpoint}`);
  }

  const rows = Array.isArray(payload.data) ? payload.data : [];
  return rows
    .map((row) => normalizeEntry(endpoint, row))
    .filter((row): row is TwelveDataUniverseEntry => row !== null);
}

function renderMarkdown(report: TwelveDataUniverseCatalogReport): string {
  const lines = [
    "# Twelve Data Universe Catalog",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Total symbols: ${report.summary.totalSymbols}`,
    "",
    "## Endpoints",
  ];

  for (const endpoint of TWELVEDATA_UNIVERSE_ENDPOINTS) {
    lines.push(`- ${endpoint}: ${report.summary.endpoints[endpoint] ?? 0}`);
  }

  lines.push("", "## Samples");

  for (const endpoint of TWELVEDATA_UNIVERSE_ENDPOINTS) {
    const sample = report.samples[endpoint];
    if (!sample) {
      lines.push(`- ${endpoint}: none`);
      continue;
    }
    lines.push(`- ${endpoint}: ${sample.symbol} | ${sample.name ?? "n/a"} | ${sample.exchange ?? "n/a"} | ${sample.country ?? "n/a"}`);
  }

  return `${lines.join("\n")}\n`;
}

export async function runTwelveDataUniverseCatalog(args?: {
  outputDir?: string | null;
}): Promise<TwelveDataUniverseCatalogReport> {
  const generatedAt = new Date().toISOString();
  const reportId = `twelvedata-universe-${generatedAt}`;
  const outputDir = resolveOutputDir(args?.outputDir);
  await ensureDirectory(outputDir);

  const allEntries: TwelveDataUniverseEntry[] = [];
  const summary = {
    totalSymbols: 0,
    endpoints: {
      forex_pairs: 0,
      cryptocurrencies: 0,
      stocks: 0,
      indices: 0,
      etf: 0,
    } satisfies Record<TwelveDataUniverseEndpoint, number>,
  };
  const samples: Partial<Record<TwelveDataUniverseEndpoint, TwelveDataUniverseEntry>> = {};

  for (const endpoint of TWELVEDATA_UNIVERSE_ENDPOINTS) {
    const entries = await fetchEndpoint(endpoint);
    summary.endpoints[endpoint] = entries.length;
    summary.totalSymbols += entries.length;
    if (entries[0]) {
      samples[endpoint] = entries[0];
    }
    for (const entry of entries) {
      allEntries.push(entry);
    }
  }

  const jsonPath = path.join(outputDir, "twelvedata-universe-latest.json");
  const markdownPath = path.join(outputDir, "twelvedata-universe-latest.md");

  const report: TwelveDataUniverseCatalogReport = {
    reportId,
    generatedAt,
    storage: {
      outputDir,
      jsonPath,
      markdownPath,
    },
    summary,
    samples,
  };

  await writeJsonAtomic(jsonPath, {
    ...report,
    entries: allEntries,
  });
  await writeFile(markdownPath, renderMarkdown(report), "utf8");

  return report;
}
