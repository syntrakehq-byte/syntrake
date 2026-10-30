import { inspectOwnExistingInvestingAccounts } from "@/investing-core/server/existingAccountReview";
import { isR2COperationalReady } from "@/investing-core/server/onboardingTransport";

/**
 * Read-only workspace summary. This does not infer balances, holdings, money,
 * progress percentages, verification or missing data from a failed read.
 */
export type InvestingWorkspaceStatus =
  | Readonly<{ state: "observed"; portfolios: number }>
  | Readonly<{ state: "multiple" }>
  | Readonly<{ state: "none" }>
  | Readonly<{ state: "disabled" }>
  | Readonly<{ state: "unavailable" }>;

export async function readInvestingWorkspaceStatus(actor: {
  userId: string;
  sessionId: string;
  getToken: () => Promise<string | null>;
}): Promise<InvestingWorkspaceStatus> {
  if (!isR2COperationalReady(process.env)) return { state: "disabled" };
  try {
    const observed = await inspectOwnExistingInvestingAccounts(process.env, actor);
    if (!observed) return { state: "none" };
    if (observed.accountMultiplicity === "MULTIPLE") return { state: "multiple" };
    return { state: "observed", portfolios: observed.portfolioIds.length };
  } catch {
    // A failed signed Clerk + Supabase RLS read is unknown, NOT "zero accounts".
    return { state: "unavailable" };
  }
}
