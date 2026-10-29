/**
 * R2 Preview deployment authority: a deliberate server-side approval of one
 * exact Git commit SHA. No candidate branch is trusted merely for its name.
 */
type Env=Readonly<Record<string,string|undefined>>;
const sha=/^[0-9a-f]{40}$/;
const branch=/^(?:candidate\/investing-r2[a-z0-9\/_-]*|feat\/bl2bl3-canonical-draft|release\/r2-main-candidate-20261029)$/;

export function isApprovedR2PreviewDeployment(env:Env):boolean{
  const actual=env.VERCEL_GIT_COMMIT_SHA;
  const approved=env.INVESTING_R2_APPROVED_PREVIEW_SHA;
  return env.VERCEL_ENV==="preview" &&
    branch.test(env.VERCEL_GIT_COMMIT_REF||"") &&
    !!actual && sha.test(actual) &&
    !!approved && sha.test(approved) &&
    actual===approved;
}
