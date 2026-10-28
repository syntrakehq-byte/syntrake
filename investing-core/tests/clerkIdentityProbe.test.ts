import assert from "node:assert/strict";
import test from "node:test";
import { handleClerkABIdentityProbe, isClerkABReadOnlyProbeEnabled } from "../server/clerkIdentityProbe";

const sha = "a".repeat(40);
const env = {
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "feat/bl2bl3-canonical-draft",
  VERCEL_GIT_COMMIT_SHA: sha,
  SYNTRAKE_CLERK_AB_PROBE_APPROVED_SHA: sha,
  SYNTRAKE_CLERK_AB_PROBE_ENABLED: "enabled",
};
const url = "https://preview.example/api/investing/rehearsal/clerk-identity";
const actorA = { userId: "user_AAAAAAAAA", sessionId: "sess_AAAAAAAAA" };
const actorB = { userId: "user_BBBBBBBBB", sessionId: "sess_BBBBBBBBB" };

test("read-only Clerk probe is disabled outside the exact authorized Preview commit", () => {
  assert.equal(isClerkABReadOnlyProbeEnabled(env), true);
  const failures = [
    { ...env, VERCEL_ENV: "production" },
    { ...env, VERCEL_ENV: undefined },
    { ...env, VERCEL_GIT_COMMIT_REF: "main" },
    { ...env, VERCEL_GIT_COMMIT_SHA: "b".repeat(40) },
    { ...env, SYNTRAKE_CLERK_AB_PROBE_APPROVED_SHA: undefined },
    { ...env, SYNTRAKE_CLERK_AB_PROBE_ENABLED: "disabled" },
  ];
  for (const bad of failures)
    assert.equal(isClerkABReadOnlyProbeEnabled(bad), false);
});

test("disabled read-only Clerk probe does not call Clerk", async () => {
  let called = 0;
  const reply = await handleClerkABIdentityProbe(new Request(url),
    { ...env, SYNTRAKE_CLERK_AB_PROBE_ENABLED: "disabled" },
    async () => { called++; return actorA; });
  assert.equal(reply.status, 404);
  assert.equal(called, 0);
});

test("A and B are authenticated with distinct pseudonymous tags", async () => {
  const a = await handleClerkABIdentityProbe(new Request(url), env, async () => actorA);
  const b = await handleClerkABIdentityProbe(new Request(url), env, async () => actorB);
  const a2 = await handleClerkABIdentityProbe(new Request(url), env, async () => actorA);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const one = await a.json() as { authenticated: boolean; identityTag: string };
  const two = await b.json() as { authenticated: boolean; identityTag: string };
  const replay = await a2.json() as { authenticated: boolean; identityTag: string };
  assert.equal(one.authenticated, true);
  assert.equal(two.authenticated, true);
  assert.match(one.identityTag, /^[a-f0-9]{16}$/);
  assert.notEqual(one.identityTag, two.identityTag);
  assert.equal(one.identityTag, replay.identityTag);
  assert.equal(a.headers.get("cache-control"), "private, no-store, max-age=0");
  for (const secret of [actorA.userId, actorA.sessionId, actorB.userId, actorB.sessionId])
    assert.equal(JSON.stringify([one, two]).includes(secret), false);
});

test("unauthenticated and failed Clerk are denied without secrets", async () => {
  const unsigned = await handleClerkABIdentityProbe(new Request(url), env, async () => {
    throw new Error("UNAUTHENTICATED");
  });
  assert.equal(unsigned.status, 401);
  assert.deepEqual(await unsigned.json(), { authenticated: false });
  const down = await handleClerkABIdentityProbe(new Request(url), env, async () => {
    throw new Error("CLERK_SECRET_KEY_LEAK");
  });
  assert.equal(down.status, 503);
  assert.ok(!(await down.text()).includes("CLERK_SECRET_KEY_LEAK"));
});

test("forged query and extra path are rejected before Clerk", async () => {
  for (const target of [url + "?userId=user_forged", url + "/other"]) {
    let called = 0;
    const reply = await handleClerkABIdentityProbe(new Request(target), env, async () => {
      called++;
      return actorA;
    });
    assert.equal(reply.status, 400);
    assert.equal(called, 0);
  }
});
