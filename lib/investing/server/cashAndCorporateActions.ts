import { randomUUID } from "node:crypto";

import { toMoney } from "@/lib/investing/money/decimal";
import { getInvestingSupabaseAdmin } from "@/lib/investing/repository/admin";
import { readInvestingPaperConfig } from "@/lib/investing/server/config";

function resultOrThrow(result: { data?: unknown; error?: { message?: string } | null }, fallback: string) {
  if (result.error) throw new Error(String(result.error.message || fallback).split("\n", 1)[0]);
  return result.data;
}

export async function recordPersistentPaperCashMovement(args: {
  userId: string;
  accountId: string;
  action: "deposit" | "withdrawal" | "dividend";
  amount: string;
  currency: string;
  symbol?: string | null;
  clientRequestId: string;
}) {
  readInvestingPaperConfig();
  const database = getInvestingSupabaseAdmin() as any;
  return resultOrThrow(await database.rpc("investing_record_cash_movement_v2", {
    p_actor_user_id: args.userId,
    p_account_id: args.accountId,
    p_movement_type: args.action,
    p_amount: toMoney(args.amount, 8),
    p_currency: args.currency.toUpperCase(),
    p_symbol: args.symbol?.trim().toUpperCase() || null,
    p_idempotency_key: args.clientRequestId,
    p_correlation_id: `investing_cash_${randomUUID()}`,
  }), "investing_cash_movement_failed");
}

export async function reversePersistentPaperCashMovement(args: {
  userId: string;
  accountId: string;
  movementId: string;
  clientRequestId: string;
  reason: string;
}) {
  readInvestingPaperConfig();
  const database = getInvestingSupabaseAdmin() as any;
  return resultOrThrow(await database.rpc("investing_reverse_cash_movement_v2", {
    p_actor_user_id: args.userId,
    p_account_id: args.accountId,
    p_original_movement_id: args.movementId,
    p_idempotency_key: args.clientRequestId,
    p_correlation_id: `investing_reversal_${randomUUID()}`,
    p_reason: args.reason,
  }), "investing_cash_reversal_failed");
}

export async function importPersistentPaperOpeningPosition(args: {
  userId: string;
  accountId: string;
  symbol: string;
  quantity: string;
  totalCost: string;
  currency: string;
  acquiredAt: string;
  clientRequestId: string;
}) {
  const database = getInvestingSupabaseAdmin() as any;
  return resultOrThrow(await database.rpc("investing_import_opening_position_v1", {
    p_actor_user_id: args.userId,
    p_account_id: args.accountId,
    p_symbol: args.symbol.trim().toUpperCase(),
    p_quantity: toMoney(args.quantity, 12),
    p_total_cost: toMoney(args.totalCost, 8),
    p_currency: args.currency.toUpperCase(),
    p_acquired_at: args.acquiredAt,
    p_idempotency_key: args.clientRequestId,
    p_correlation_id: `investing_opening_position_${randomUUID()}`,
  }), "investing_opening_position_import_failed");
}

export async function applyPersistentPaperSplit(args: {
  userId: string;
  accountId: string;
  symbol: string;
  ratio: string;
  action: "split" | "reverse_split";
  clientRequestId: string;
  effectiveAt?: string | null;
}) {
  readInvestingPaperConfig();
  const database = getInvestingSupabaseAdmin() as any;
  return resultOrThrow(await database.rpc("investing_apply_split_v2", {
    p_actor_user_id: args.userId,
    p_account_id: args.accountId,
    p_symbol: args.symbol.trim().toUpperCase(),
    p_ratio: toMoney(args.ratio, 12),
    p_action_type: args.action,
    p_idempotency_key: args.clientRequestId,
    p_correlation_id: `investing_corporate_action_${randomUUID()}`,
    p_effective_at: args.effectiveAt || new Date().toISOString(),
  }), "investing_corporate_action_failed");
}
