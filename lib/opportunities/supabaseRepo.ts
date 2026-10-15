// Legacy opportunity snapshot helpers.
//
// Legacy opportunity snapshot helpers. Active Investing opportunities are served
// by /api/investing/dashboard from investing_positions/customerDecisionProjection.
// Keep this file only for compatibility until the old OpportunitiesPanel stack is
// fully removed.
import { supabaseAdmin } from "@/lib/_legacy/supabaseAdmin";

export async function readUserSettingsSB(userId: string) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data ?? {};
}

export async function readPortfolioSnapshotSB(userId: string) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("portfolios")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  // Accept common shapes:
  // row.snapshot (json) OR row.portfolio (json) OR row.data (json)
  const snap = row.snapshot ?? row.portfolio ?? row.data ?? null;
  return snap;
}
