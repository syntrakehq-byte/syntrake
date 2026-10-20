/**
 * Offline precondition for the FIRST, read-only Investing release.
 * This is a release-engineering control, not an API or database authority.
 *
 * The snapshot is a verified Supabase Production migration history observed
 * on 2026-10-20. Operator must RE-READ remote history before any real apply.
 * Never mutate or "repair" remote history to make this check pass.
 */
export const FIRST_INVESTING_RELEASE_VERSION = "20261020180000" as const;
export const FIRST_INVESTING_RELEASE_NAME = "investing_first_readonly_release" as const;
export type MigrationVersionName = Readonly<{ version: string; name: string | null }>;

const acceptedProdBaseline: readonly MigrationVersionName[] = [
  { version: "20261017191056", name: "remote_schema" },
] as const;

export class ReleaseHistoryBlocked extends Error {
  constructor() {
    super("MIGRATION_HISTORY_DRIFT");
    this.name = "ReleaseHistoryBlocked";
  }
}

/** Deny missing, unexpected, reordered, renamed or duplicate migrations. */
export function assertFirstInvestingReleasePredecessor(
  remote: readonly MigrationVersionName[],
): void {
  if (
    remote.length !== acceptedProdBaseline.length ||
    remote.some((row, index) =>
      row.version !== acceptedProdBaseline[index].version ||
      row.name !== acceptedProdBaseline[index].name
    )
  ) {
    throw new ReleaseHistoryBlocked();
  }
  if (!(FIRST_INVESTING_RELEASE_VERSION > remote[remote.length - 1].version)) {
    throw new ReleaseHistoryBlocked();
  }
}

export function assertFirstInvestingReleaseApplied(
  remote: readonly MigrationVersionName[],
): void {
  const [first, ...after] = remote;
  if (
    first?.version !== acceptedProdBaseline[0].version ||
    first?.name !== acceptedProdBaseline[0].name ||
    after.length !== 1 ||
    after[0].version !== FIRST_INVESTING_RELEASE_VERSION ||
    after[0].name !== FIRST_INVESTING_RELEASE_NAME
  ) {
    throw new ReleaseHistoryBlocked();
  }
}
