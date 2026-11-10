import type { Client } from "pg";
import { ContinuousWorkerService, type WorkerServiceConfig } from "./continuousWorkerService";
import { createLicensedG3TwelveDataProvider, type StorageAttestation } from "./g3LicensedTwelveData";
import { isG3PreviewProviderReady } from "./gate";

type Env = Readonly<Record<string, string | undefined>>;
const WORKER_ID = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * One bounded execution unit. An external scheduler may invoke this factory
 * repeatedly only after verified retention/purge, registered worker identity,
 * provider budget and licensed source have been approved. No scheduler or
 * background activity starts at module import time.
 *
 * Reader and writer are distinct least-privilege PostgreSQL identities.
 */
export function createG3BoundedMarketWorker(config: Readonly<{
  env: Env;
  readerFactory: () => Promise<Client>;
  workerFactory: () => Promise<Client>;
  attestation: StorageAttestation | null;
  workerId: string;
  instanceId: string;
  capabilityToken: string;
  exchangeTimezone: string;
  transport?: Parameters<typeof createLicensedG3TwelveDataProvider>[0]["transport"];
  clock?: () => Date;
  onEvent?: WorkerServiceConfig["onEvent"];
}>): ContinuousWorkerService {
  if (!isG3PreviewProviderReady(config.env)) {
    throw new Error("G3_WORKER_DISABLED");
  }
  if (!config.attestation || !config.attestation.purgeVerified ||
      config.attestation.scope !== "internal-non-display") {
    throw new Error("G3_WORKER_LICENSE_UNVERIFIED");
  }
  if (!WORKER_ID.test(config.workerId) || !WORKER_ID.test(config.instanceId) ||
      config.capabilityToken.length < 32 || config.capabilityToken.length > 256 ||
      typeof config.readerFactory !== "function" ||
      typeof config.workerFactory !== "function") {
    throw new Error("G3_WORKER_IDENTITY_INVALID");
  }
  return new ContinuousWorkerService({
    workerId: config.workerId,
    instanceId: config.instanceId,
    capabilityToken: config.capabilityToken,
    clientFactory: config.workerFactory,
    provider: createLicensedG3TwelveDataProvider({
      env: config.env,
      readerFactory: config.readerFactory,
      attestation: config.attestation,
      ...(config.transport ? { transport: config.transport } : {}),
      ...(config.clock ? { clock: config.clock } : {}),
    }),
    exchangeTimezone: config.exchangeTimezone,
    consumedCredits: "1",
    maxTasks: 1,
    maxPolls: 1,
    heartbeatIntervalMs: 5_000,
    ...(config.onEvent ? { onEvent: config.onEvent } : {}),
  });
}
