import { z } from "zod";
import { currencyCode } from "./domain/money";

export const actorSchema = z.object({ userId: z.string().min(1), sessionId: z.string().min(1) });
export const accountIdSchema = z.string().uuid();
export const createAccountSchema = z.object({
  name: z.string().trim().min(1).max(120),
  baseCurrency: currencyCode,
});
/** Input contract only. This is not an authenticated or executable contribution operation. */
export const contributionSchema = z.object({
  accountId: accountIdSchema,
  idempotencyKey: z.string().min(16).max(128),
  currency: currencyCode,
  amountMinor: z.bigint().positive(),
  externalReference: z.string().trim().min(1).max(180),
});

export type Actor = z.infer<typeof actorSchema>;
export type CreateAccount = z.infer<typeof createAccountSchema>;
export type Contribution = z.infer<typeof contributionSchema>;
