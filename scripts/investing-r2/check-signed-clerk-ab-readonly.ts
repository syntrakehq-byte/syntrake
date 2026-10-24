import {verifySignedClerkRlsAB} from "../../investing-core/security/verifySignedClerkRlsAB";

/**
 * OPERATOR-ONLY manual invocation. This script is NEVER run by CI or a
 * Vercel route. All provided session tokens must be ephemeral and supplied
 * only through the operator's local secret environment, not GitHub.
 *
 * It executes exactly five GETs against the historical Preview PostgREST.
 * It writes no R2 financial state and is NOT a paid Supabase rehearsal.
 */
async function main():Promise<void>{
  const e=process.env;
  if(e.CI==="true"||e.INVESTING_R2F_MANUAL_READ_ONLY!=="explicitly_enabled")
    throw Error("R2F_MANUAL_READ_ONLY_NOT_AUTHORIZED");
  const get=(name:string)=>{
    const result=e[name];
    if(!result)throw Error("R2F_MISSING_REQUIRED_ENV");
    return result;
  };
  const evidence=await verifySignedClerkRlsAB({
    projectUrl:get("INVESTING_R2F_SUPABASE_URL"),
    publishableKey:get("INVESTING_R2F_SUPABASE_PUBLISHABLE_KEY"),
    actorA:{
      userId:get("INVESTING_R2F_CLERK_USER_A"),
      accountId:get("INVESTING_R2F_OWN_ACCOUNT_A"),
      jwt:get("INVESTING_R2F_SIGNED_JWT_A"),
    },
    actorB:{
      userId:get("INVESTING_R2F_CLERK_USER_B"),
      accountId:get("INVESTING_R2F_OWN_ACCOUNT_B"),
      jwt:get("INVESTING_R2F_SIGNED_JWT_B"),
    },
  });
  // Evidence deliberately excludes actor IDs, account IDs, JWT, response
  // bodies, cash, portfolios and secrets.
  process.stdout.write(JSON.stringify(evidence)+"\n");
}
void main().catch(()=>{
  process.stderr.write("R2F_SIGNED_CLERK_A_B_READ_ONLY_BLOCKED\n");
  process.exitCode=1;
});
