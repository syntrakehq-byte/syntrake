import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * User-reported onboarding declaration; NOT capital, holdings, an investment
 * account, risk mandate, portfolio allocation or approved automated execution.
 * Investing-only; trading cannot depend on this domain contract.
 */
const hasPortfolio = z.object({
  pathway: z.literal("HAS_PORTFOLIO"),
  importSource: z.enum(["MANUAL_ENTRY", "DOCUMENT_EXTRACTED", "BROKER_CONNECT_LATER"]),
}).strict();
const needsPortfolio = z.object({
  pathway: z.literal("NEEDS_PORTFOLIO"),
  objective: z.enum(["RETIREMENT", "WEALTH_GROWTH", "LARGE_PURCHASE", "OTHER"]),
  horizonYears: z.number().int().min(1).max(60),
  lossCapacity: z.enum(["LOW", "MEDIUM", "HIGH"]),
}).strict();

export const onboardingChoiceSchema = z.discriminatedUnion("pathway", [hasPortfolio,needsPortfolio]);
export type OnboardingChoice = z.infer<typeof onboardingChoiceSchema>;

export const onboardingCommandSchema = z.object({
  idempotencyKey: z.string().uuid(),
  choice: onboardingChoiceSchema,
}).strict();
export type OnboardingCommand = z.infer<typeof onboardingCommandSchema>;

export function canonicalOnboardingPayload(untrusted: unknown): OnboardingChoice {
  // Zod strips nothing: any account/broker/user/tenant/financial authority is
  // rejected, including user IDs embedded in a choice or command.
  return onboardingChoiceSchema.parse(untrusted);
}
export function onboardingFingerprint(choice: OnboardingChoice): string {
  const normalized = choice.pathway === "HAS_PORTFOLIO"
    ? {pathway:choice.pathway,importSource:choice.importSource}
    : {pathway:choice.pathway,objective:choice.objective,
       horizonYears:choice.horizonYears,lossCapacity:choice.lossCapacity};
  return createHash("sha256").update(JSON.stringify(normalized),"utf8").digest("hex");
}

export type OnboardingEvent = Readonly<{
  id: string;
  choice: OnboardingChoice;
  evidence: "USER_REPORTED";
  financialState: "NOT_PROVISIONED";
  createdAt: string;
}>;
export function parseStoredOnboardingRow(input: unknown): OnboardingEvent {
  const row = z.object({
    id: z.string().uuid(),
    pathway: z.enum(["HAS_PORTFOLIO","NEEDS_PORTFOLIO"]),
    import_source: z.string().nullable(),
    objective: z.string().nullable(),
    horizon_years: z.number().int().nullable(),
    loss_capacity: z.string().nullable(),
    evidence: z.literal("USER_REPORTED"),
    financial_state: z.literal("NOT_PROVISIONED"),
    created_at: z.string().datetime({offset:true}),
  }).strict().parse(input);
  const choice = canonicalOnboardingPayload(row.pathway==="HAS_PORTFOLIO"
    ? {pathway:row.pathway,importSource:row.import_source}
    : {pathway:row.pathway,objective:row.objective,
       horizonYears:row.horizon_years,lossCapacity:row.loss_capacity});
  return {id:row.id,choice,evidence:row.evidence,
    financialState:row.financial_state,createdAt:row.created_at};
}
