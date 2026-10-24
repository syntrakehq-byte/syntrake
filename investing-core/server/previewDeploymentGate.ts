/**
 * R2 Preview deployment authority: a deliberate server-side approval of one
 * exact Git commit SHA. No candidate branch is trusted merely for its name.
 *
 * VERCEL_GIT_COMMIT_SHA / VERCEL_GIT_COMMIT_REF are build-platform inputs.
 * INVESTING_R2_APPROVED_PREVIEW_SHA is separately set by the operator on the
 * selected Preview environment after exact-SHA review. It is NEVER sent to
 * the browser and must not exist as a code or CI default.
 *
 * Changing any file creates a new SHA and fails closed until re-approved.
 */
type Env=Readonly<Record<string,string|undefined>>;
const sha=/^[0-9a-f]{40}$/;
const branch=/^candidate\/investing-r2[a-z0-9/_-]*$/;

export function isApprovedR2PreviewDeployment(env:Env):boolean{
  const actual=env.VERCEL_GIT_COMMIT_SHA;
  const approved=env.INVESTING_R2_APPROVED_PREVIEW_SHA;
  return env.VERCEL_ENV==="preview" &&
    branch.test(env.VERCEL_GIT_COMMIT_REF||"") &&
    !!actual && sha.test(actual) &&
    !!approved && sha.test(approved) &&
    actual===approved;
}
