import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { TRADING_LIGHT_SCANNER_ACTIONABLE_MAX_AGE_MS } from "@/lib/trading/scannerFreshness";
import type { ComposeTradingLiveDecisionInput } from "@/lib/trading/state";

export const TRADING_SCANNER_SNAPSHOT_TABLE = "trading_scanner_snapshots";
export const TRADING_SCANNER_STORED_SNAPSHOT_MAX_AGE_MS =
  TRADING_LIGHT_SCANNER_ACTIONABLE_MAX_AGE_MS;
export const TRADING_SCANNER_LAST_VALID_SNAPSHOT_MAX_AGE_MS =
  36 * 60 * 60 * 1000;

type TradingScannerSnapshotRow = {
  instrument: string;
  snapshot_at: string;
  generated_at: string;
  source: string;
  market_open: boolean;
  actionable_freshness: boolean;
  provider_error: string | null;
  payload: ComposeTradingLiveDecisionInput;
};

export type TradingScannerSnapshotWriteResult = {
  schemaReady: boolean;
  persisted: boolean;
  count: number;
  skippedStaleOpenCount: number;
  error: string | null;
};

export type TradingScannerSnapshotReadResult = {
  schemaReady: boolean;
  inputs: ComposeTradingLiveDecisionInput[];
  generatedAt: string | null;
  excludedStaleOpenCount: number;
  error: string | null;
};

function isMissingSchemaError(error: unknown) {
  const message = String((error as any)?.message ?? error ?? "").toLowerCase();
  return (
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("unknown column") ||
    message.includes("could not find the table")
  );
}

function normalizeIso(input: string | number | Date | null | undefined) {
  const value = input instanceof Date ? input.getTime() : typeof input === "number" ? input : Date.parse(String(input ?? ""));
  return Number.isFinite(value) ? new Date(value).toISOString() : new Date().toISOString();
}

function normalizeInstrument(input: unknown) {
  return String(input ?? "").trim().toUpperCase();
}

function isMarketOpenScannerInput(input: ComposeTradingLiveDecisionInput) {
  return (input as any)?.market?.session?.marketOpen === true;
}

function isScannerInput(value: unknown): value is ComposeTradingLiveDecisionInput {
  const input = value as ComposeTradingLiveDecisionInput | null;
  return Boolean(
    input &&
      typeof input === "object" &&
      input.snapshot &&
      typeof input.snapshot === "object" &&
      normalizeInstrument(input.snapshot.instrument).length > 0 &&
      typeof (input as any).market?.session?.marketOpen === "boolean",
  );
}

function isFreshOpenScannerInput(
  input: ComposeTradingLiveDecisionInput,
  asOf: string,
  maxAgeMs: number,
) {
  if (!isMarketOpenScannerInput(input)) {
    return true;
  }

  if (input.scannerSnapshot?.actionableFreshness !== true) {
    return false;
  }

  const asOfMs = Date.parse(asOf);
  const snapshotAtMs = Date.parse(String(input.snapshot.snapshotAt ?? ""));

  if (!Number.isFinite(asOfMs) || !Number.isFinite(snapshotAtMs)) {
    return false;
  }

  return Math.max(0, asOfMs - snapshotAtMs) <= maxAgeMs;
}

function rowFromScannerInput(
  input: ComposeTradingLiveDecisionInput,
  generatedAt: string,
): TradingScannerSnapshotRow {
  const instrument = normalizeInstrument(input.snapshot.instrument);
  const scannerSnapshot = input.scannerSnapshot ?? null;

  return {
    instrument,
    snapshot_at: normalizeIso(input.snapshot.snapshotAt),
    generated_at: generatedAt,
    source: scannerSnapshot?.source ?? "unknown",
    market_open: input.market.session.marketOpen === true,
    actionable_freshness: scannerSnapshot?.actionableFreshness === true,
    provider_error: scannerSnapshot?.providerError ?? null,
    payload: input,
  };
}

export async function writeTradingScannerSnapshots(args: {
  inputs: ComposeTradingLiveDecisionInput[];
  generatedAt?: string | Date | null;
}): Promise<TradingScannerSnapshotWriteResult> {
  const generatedAt = normalizeIso(args.generatedAt);
  let skippedStaleOpenCount = 0;
  const rows = args.inputs
    .filter(isScannerInput)
    .filter((input) => {
      if (isFreshOpenScannerInput(input, generatedAt, TRADING_SCANNER_STORED_SNAPSHOT_MAX_AGE_MS)) {
        return true;
      }

      skippedStaleOpenCount += 1;
      return false;
    })
    .map((input) => rowFromScannerInput(input, generatedAt));

  if (rows.length === 0) {
    return {
      schemaReady: true,
      persisted: true,
      count: 0,
      skippedStaleOpenCount,
      error: null,
    };
  }

  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb
      .from(TRADING_SCANNER_SNAPSHOT_TABLE)
      .upsert(rows as any, { onConflict: "instrument" } as any);

    if (error) {
      if (isMissingSchemaError(error)) {
        return {
          schemaReady: false,
          persisted: false,
          count: 0,
          skippedStaleOpenCount,
          error: error.message ?? "missing_trading_scanner_snapshot_schema",
        };
      }
      throw new Error(error.message ?? "trading_scanner_snapshot_write_failed");
    }

    return {
      schemaReady: true,
      persisted: true,
      count: rows.length,
      skippedStaleOpenCount,
      error: null,
    };
  } catch (error: any) {
    if (isMissingSchemaError(error)) {
      return {
        schemaReady: false,
        persisted: false,
        count: 0,
        skippedStaleOpenCount,
        error: error?.message ?? "missing_trading_scanner_snapshot_schema",
      };
    }

    return {
      schemaReady: true,
      persisted: false,
      count: 0,
      skippedStaleOpenCount,
      error: error?.message ?? "trading_scanner_snapshot_write_failed",
    };
  }
}

export async function readFreshTradingScannerSnapshots(args: {
  asOf?: string | Date | null;
  maxAgeMs?: number;
} = {}): Promise<TradingScannerSnapshotReadResult> {
  const asOfIso = normalizeIso(args.asOf);
  const maxAgeMs = Math.max(
    30_000,
    Math.round(args.maxAgeMs ?? TRADING_SCANNER_STORED_SNAPSHOT_MAX_AGE_MS),
  );
  const cutoffIso = new Date(Date.parse(asOfIso) - maxAgeMs).toISOString();

  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from(TRADING_SCANNER_SNAPSHOT_TABLE)
      .select("instrument,generated_at,payload")
      .gte("generated_at", cutoffIso)
      .order("generated_at", { ascending: false });

    if (error) {
      if (isMissingSchemaError(error)) {
        return {
          schemaReady: false,
          inputs: [],
          generatedAt: null,
          excludedStaleOpenCount: 0,
          error: error.message ?? "missing_trading_scanner_snapshot_schema",
        };
      }
      throw new Error(error.message ?? "trading_scanner_snapshot_read_failed");
    }

    const rows = Array.isArray(data) ? data : [];
    let excludedStaleOpenCount = 0;
    const validRows = rows.filter((row: any) => {
      const input = row?.payload;
      if (!isScannerInput(input)) {
        return false;
      }

      const freshEnough = isFreshOpenScannerInput(input, asOfIso, maxAgeMs);
      if (!freshEnough && isMarketOpenScannerInput(input)) {
        excludedStaleOpenCount += 1;
      }

      return freshEnough;
    });
    const inputs = validRows.map((row: any) => row.payload);
    const generatedAt =
      validRows
        .map((row: any) => String(row?.generated_at ?? ""))
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;

    return {
      schemaReady: true,
      inputs,
      generatedAt,
      excludedStaleOpenCount,
      error: null,
    };
  } catch (error: any) {
    if (isMissingSchemaError(error)) {
      return {
        schemaReady: false,
        inputs: [],
        generatedAt: null,
        excludedStaleOpenCount: 0,
        error: error?.message ?? "missing_trading_scanner_snapshot_schema",
      };
    }

    return {
      schemaReady: true,
      inputs: [],
      generatedAt: null,
      excludedStaleOpenCount: 0,
      error: error?.message ?? "trading_scanner_snapshot_read_failed",
    };
  }
}

export async function readLatestTradingScannerSnapshots(args: {
  asOf?: string | Date | null;
  maxAgeMs?: number;
} = {}): Promise<TradingScannerSnapshotReadResult> {
  const asOfIso = normalizeIso(args.asOf);
  const maxAgeMs = Math.max(
    TRADING_SCANNER_STORED_SNAPSHOT_MAX_AGE_MS,
    Math.round(args.maxAgeMs ?? TRADING_SCANNER_LAST_VALID_SNAPSHOT_MAX_AGE_MS),
  );
  const cutoffIso = new Date(Date.parse(asOfIso) - maxAgeMs).toISOString();

  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from(TRADING_SCANNER_SNAPSHOT_TABLE)
      .select("instrument,generated_at,payload")
      .gte("generated_at", cutoffIso)
      .order("generated_at", { ascending: false });

    if (error) {
      if (isMissingSchemaError(error)) {
        return {
          schemaReady: false,
          inputs: [],
          generatedAt: null,
          excludedStaleOpenCount: 0,
          error: error.message ?? "missing_trading_scanner_snapshot_schema",
        };
      }
      throw new Error(error.message ?? "trading_scanner_snapshot_read_failed");
    }

    const rows = Array.isArray(data) ? data : [];
    const validRows = rows.filter((row: any) => isScannerInput(row?.payload));
    const seen = new Set<string>();
    const inputs: ComposeTradingLiveDecisionInput[] = [];

    for (const row of validRows) {
      const input = row.payload as ComposeTradingLiveDecisionInput;
      const instrument = normalizeInstrument(input.snapshot.instrument);
      if (!instrument || seen.has(instrument)) continue;
      seen.add(instrument);
      inputs.push(input);
    }

    const generatedAt =
      validRows
        .map((row: any) => String(row?.generated_at ?? ""))
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;

    return {
      schemaReady: true,
      inputs,
      generatedAt,
      excludedStaleOpenCount: 0,
      error: null,
    };
  } catch (error: any) {
    if (isMissingSchemaError(error)) {
      return {
        schemaReady: false,
        inputs: [],
        generatedAt: null,
        excludedStaleOpenCount: 0,
        error: error?.message ?? "missing_trading_scanner_snapshot_schema",
      };
    }

    return {
      schemaReady: true,
      inputs: [],
      generatedAt: null,
      excludedStaleOpenCount: 0,
      error: error?.message ?? "trading_scanner_snapshot_read_failed",
    };
  }
}
