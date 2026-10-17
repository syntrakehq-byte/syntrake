import { z } from "zod";

/** Explicit supported subset of ISO 4217; no implied support for every A-Z code. */
export const currencyCode = z.enum(["EUR", "USD", "GBP", "CHF", "JPY", "KWD"]);
export type CurrencyCode = z.infer<typeof currencyCode>;

export const currencyMinorDigits: Readonly<Record<CurrencyCode, 0 | 2 | 3>> = Object.freeze({
  EUR: 2, USD: 2, GBP: 2, CHF: 2, JPY: 0, KWD: 3,
});

export const minorAmount = z.bigint().refine((value) => value >= 0n, "amount must be non-negative");
export type Money = Readonly<{ currency: CurrencyCode; minor: bigint }>;

export function money(currency: string, minor: bigint): Money {
  const parsed = currencyCode.parse(currency);
  const parsedMinor = minorAmount.parse(minor);
  return Object.freeze({ currency: parsed, minor: parsedMinor });
}

export function addMoney(left: Money, right: Money): Money {
  if (left.currency !== right.currency) throw new Error("currency mismatch");
  return money(left.currency, left.minor + right.minor);
}

export function subtractMoney(left: Money, right: Money): Money {
  if (left.currency !== right.currency) throw new Error("currency mismatch");
  if (right.minor > left.minor) throw new Error("insufficient balance");
  return money(left.currency, left.minor - right.minor);
}
