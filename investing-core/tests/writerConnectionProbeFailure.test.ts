import assert from "node:assert/strict";
import test from "node:test";
import { connectionProbeFailureKind } from "../server/writerConnectionProbeFailure";

test("safe PostgreSQL writer probe errors are classified without exposing messages or connection details", () => {
  const examples = {
    "28P01": "AUTH_REJECTED",
    "28000": "AUTH_REJECTED",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE": "TLS_REJECTED",
    "ERR_TLS_CERT_ALTNAME_INVALID": "TLS_REJECTED",
    "CERT_HAS_EXPIRED": "TLS_REJECTED",
    "ETIMEDOUT": "NETWORK_FAILED",
    "ECONNREFUSED": "NETWORK_FAILED",
    "EAI_AGAIN": "NETWORK_FAILED",
    "42501": "DB_PERMISSION_DENIED",
    "42703": "DATABASE_REJECTED",
    "57P03": "DATABASE_REJECTED",
    "EUNKNOWN": "INTERNAL_ERROR",
  } as const;
  for (const [code, expected] of Object.entries(examples)) {
    const malicious = { code, message: "mydb-secret-postgresql://user:pass@localhost/db", detail: "sensitive" };
    const kind = connectionProbeFailureKind(malicious);
    assert.equal(kind, expected, code);
    assert.ok(!JSON.stringify(kind).includes("pass"));
    assert.ok(!JSON.stringify(kind).includes("sensitive"));
  }
  assert.equal(connectionProbeFailureKind(null), "INTERNAL_ERROR");
  assert.equal(connectionProbeFailureKind({}), "INTERNAL_ERROR");
  assert.equal(connectionProbeFailureKind({ message: "no code: password secret" }), "INTERNAL_ERROR");
  assert.equal(connectionProbeFailureKind({ code: 42 }), "INTERNAL_ERROR");
});
