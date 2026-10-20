import { z } from "zod";

/**
 * Untrusted response boundary for the client-facing R1-B account list.
 * An HTTP success is NOT evidence of financial balance, holdings or broker
 * reconciliation; invalid or contradictory data always fails closed.
 */
const account = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  baseCurrency: z.string().regex(/^[A-Z]{3}$/),
}).strict();

const payload = z.object({
  state: z.enum(["AVAILABLE", "EMPTY_OR_UNPROVISIONED"]),
  accounts: z.array(account).max(50),
  source: z.literal("SUPABASE_RLS_READ"),
  financialState: z.literal("NOT_INCLUDED"),
}).strict().superRefine((input, ctx) => {
  const consistent =
    input.state === "AVAILABLE" ? input.accounts.length > 0 :
    input.accounts.length === 0;
  if (!consistent) {
    ctx.addIssue({ code: "custom", message: "Account state/rows mismatch" });
  }
  if (new Set(input.accounts.map((entry) => entry.id)).size !== input.accounts.length) {
    ctx.addIssue({ code: "custom", message: "Duplicate account identity" });
  }
});

export type AccountDiscoveryView =
  | Readonly<{ kind: "AVAILABLE"; accounts: readonly z.infer<typeof account>[] }>
  | Readonly<{ kind: "EMPTY_OR_UNPROVISIONED" }>
  | Readonly<{ kind: "UNAUTHENTICATED" }>
  | Readonly<{ kind: "BLOCKED" }>
  | Readonly<{ kind: "UNAVAILABLE" }>
  | Readonly<{ kind: "NOT_ENABLED" }>;

/** No raw error text or upstream payload is displayed in the interface. */
export function classifyAccountDiscoveryResponse(
  status: number,
  untrustedBody: unknown,
): AccountDiscoveryView {
  if (status === 401) return { kind: "UNAUTHENTICATED" };
  if (status === 403) return { kind: "BLOCKED" };
  if (status === 404) return { kind: "NOT_ENABLED" };
  if (status !== 200) return { kind: "UNAVAILABLE" };

  const parsed = payload.safeParse(untrustedBody);
  if (!parsed.success) return { kind: "UNAVAILABLE" };
  if (parsed.data.state === "EMPTY_OR_UNPROVISIONED") {
    return { kind: "EMPTY_OR_UNPROVISIONED" };
  }
  return {
    kind: "AVAILABLE",
    accounts: parsed.data.accounts,
  };
}
