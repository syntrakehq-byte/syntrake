import assert from "node:assert/strict";
import test from "node:test";
import { writerReadProbeVerdict } from "../server/writerReadProbeVerdict";

const A = { id: "f886c954-0a0f-419c-890a-b77ecb0c36cf", name: "R0-A Clerk A - PREVIEW TEST 2026-10-18" };
const C = { id: "676ae244-9ead-449c-861d-2f34a81285e3", name: "R0-A Clerk C - PREVIEW TEST 2026-10-18" };

test("exactly one own RLS fixture succeeds, missing or multiple accounts stay blocked", () => {
  assert.equal(writerReadProbeVerdict([A]), "OWNED_TEST_ACCOUNT");
  assert.equal(writerReadProbeVerdict([C]), "OWNED_TEST_ACCOUNT");
  assert.equal(writerReadProbeVerdict([]), "NO_OWNED_TEST_ACCOUNT");
  assert.equal(writerReadProbeVerdict([A, C]), "AMBIGUOUS_TEST_ACCOUNTS");
  assert.equal(writerReadProbeVerdict([A, A]), "AMBIGUOUS_TEST_ACCOUNTS");
  assert.equal(writerReadProbeVerdict([{ ...A, name: "tampered" }]), "TEST_FIXTURE_MISMATCH");
  assert.equal(writerReadProbeVerdict([{ ...A, id: C.id }]), "TEST_FIXTURE_MISMATCH");
  assert.equal(writerReadProbeVerdict([{ id: "other", name: "other" }]), "TEST_FIXTURE_MISMATCH");
});
