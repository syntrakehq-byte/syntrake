/**
 * Temporary PREVIEW-ONLY, non-sensitive classification of a read-only
 * PostgreSQL writer RLS account visibility check.
 *
 * No actor identity, account UUID, session, raw SQL result or credentials
 * are returned. Exact fixture name checking occurs after RLS.
 */
export type WriterProbeFixtureRow = Readonly<{ id: string; name: string }>;

export type WriterProbeBlockedReason =
  | "NO_OWNED_TEST_ACCOUNT"
  | "AMBIGUOUS_TEST_ACCOUNTS"
  | "TEST_FIXTURE_MISMATCH";

export function writerReadProbeVerdict(
  rows: readonly WriterProbeFixtureRow[],
): "OWNED_TEST_ACCOUNT" | WriterProbeBlockedReason {
  if (rows.length === 0) return "NO_OWNED_TEST_ACCOUNT";
  if (rows.length !== 1) return "AMBIGUOUS_TEST_ACCOUNTS";
  const { id, name } = rows[0];
  if (
    (id === "f886c954-0a0f-419c-890a-b77ecb0c36cf" &&
      name === "R0-A Clerk A - PREVIEW TEST 2026-10-18") ||
    (id === "676ae244-9ead-449c-861d-2f34a81285e3" &&
      name === "R0-A Clerk C - PREVIEW TEST 2026-10-18")
  ) return "OWNED_TEST_ACCOUNT";
  return "TEST_FIXTURE_MISMATCH";
}
