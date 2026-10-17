import { z } from "zod";

export const actorSchema = z.object({ userId: z.string().min(1), sessionId: z.string().min(1) });
export const accountIdSchema = z.string().uuid();
export const createAccountSchema = z.object({ name: z.string().trim().min(1).max(120), baseCurrency: z.string().regex(/^[A-Z]{3}$/) });
export const contributionSchema = z.object({ accountId: accountIdSchema, idempotencyKey: z.string().min(16).max(128), currency: z.string().regex(/^[A-Z]{3}$/), amountMinor: z.bigint().positive(), externalReference: z.string().trim().min(1).max(180) });

export type Actor = z.infer<typeof actorSchema>;
export type CreateAccount = z.infer<typeof createAccountSchema>;
export type Contribution = z.infer<typeof contributionSchema>;
