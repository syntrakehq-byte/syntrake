import { z } from "zod";
import { currencyCode, type CurrencyCode } from "./money";

/** One journal operates within exactly one investment account, posting to
 * two or more distinct internal ledger accounts per currency. */
export const ledgerEntrySchema = z.object({
  investmentAccountId: z.string().uuid(),
  ledgerAccountId: z.string().uuid(),
  direction: z.enum(["debit", "credit"]),
  currency: currencyCode,
  minor: z.bigint().positive(),
});

export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

export function assertBalanced(entries: readonly LedgerEntry[]): void {
  if (!entries.length) throw new Error("ledger transaction cannot be empty");
  const account = entries[0].investmentAccountId;
  const totals = new Map<CurrencyCode, { debit: bigint; credit: bigint; accounts: Set<string>; count: number }>();
  for (const candidate of entries) {
    const entry = ledgerEntrySchema.parse(candidate);
    if (entry.investmentAccountId !== account) throw new Error("cross-investment-account journal");
    const total = totals.get(entry.currency) ?? { debit: 0n, credit: 0n, accounts: new Set<string>(), count: 0 };
    total[entry.direction] += entry.minor;
    total.accounts.add(entry.ledgerAccountId);
    total.count += 1;
    totals.set(entry.currency, total);
  }
  for (const [currency, total] of totals) {
    if (total.count < 2 || total.accounts.size < 2) throw new Error("journal needs distinct ledger accounts per currency");
    if (total.debit !== total.credit) throw new Error("unbalanced ledger for " + currency);
  }
}

export type SignedBalance = Readonly<{ currency: CurrencyCode; minor: bigint }>;

/** Bookkeeping amounts, not investment account cash balances. */
export function netByLedgerAccount(entries: readonly LedgerEntry[]): Map<string, SignedBalance> {
  assertBalanced(entries);
  const result = new Map<string, SignedBalance>();
  for (const entry of entries) {
    const signed = entry.direction === "debit" ? -entry.minor : entry.minor;
    const previous = result.get(entry.ledgerAccountId) ?? { currency: entry.currency, minor: 0n };
    if (previous.currency !== entry.currency) throw new Error("ledger account has multiple currencies");
    result.set(entry.ledgerAccountId, Object.freeze({ currency: entry.currency, minor: previous.minor + signed }));
  }
  return result;
}
