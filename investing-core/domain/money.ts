import { z } from "zod";

export const currencyCode = z.string().regex(/^[A-Z]{3}$/, "currency must be ISO-4217 uppercase");
export const minorAmount = z.bigint().refine((value) => value >= 0n, "amount must be non-negative");

export type Money = Readonly<{ currency: string; minor: bigint }>;

export function money(currency: string, minor: bigint): Money {
  const parsed = currencyCode.parse(currency);
  if (minor < 0n) throw new Error("amount must be non-negative");
  return Object.freeze({ currency: parsed, minor });
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
