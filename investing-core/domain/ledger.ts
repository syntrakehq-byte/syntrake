import { z } from "zod";

export const ledgerEntrySchema = z.object({
  accountId: z.string().uuid(),
  direction: z.enum(["debit", "credit"]),
  currency: z.string().regex(/^[A-Z]{3}$/),
  minor: z.bigint().positive(),
});

export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

export function assertBalanced(entries: readonly LedgerEntry[]): void {
  if (entries.length < 2) throw new Error("ledger transaction needs at least two entries");
  const totals = new Map<string, { debit: bigint; credit: bigint }>();
  for (const entry of entries.map((candidate) => ledgerEntrySchema.parse(candidate))) {
    const total = totals.get(entry.currency) ?? { debit: 0n, credit: 0n };
    total[entry.direction] += entry.minor;
    totals.set(entry.currency, total);
  }
  for (const [currency, total] of totals) {
    if (total.debit !== total.credit) throw new Error(`unbalanced ledger for ${currency}`);
  }
}

export type SignedBalance = Readonly<{ currency: string; minor: bigint }>;

export function netByAccount(entries: readonly LedgerEntry[]): Map<string, SignedBalance> {
  assertBalanced(entries);
  const result = new Map<string, SignedBalance>();
  for (const entry of entries) {
    const signed = entry.direction === "debit" ? -entry.minor : entry.minor;
    const previous = result.get(entry.accountId) ?? { currency: entry.currency, minor: 0n };
    if (previous.currency !== entry.currency) throw new Error("account has multiple currencies");
    result.set(entry.accountId, Object.freeze({ currency: entry.currency, minor: previous.minor + signed }));
  }
  return result;
}
