import { Pool } from "pg";
import { isR2CPreviewEnabled } from "./onboardingTransport";

/** Dedicated PREVIEW-only import capability; no financial posting authority. */
type Env = Readonly<Record<string, string | undefined>>;
export const R2D_BRANCH = "candidate/investing-r2d-import-flow-20261024";
const PROJECT = "zkqgpejlkgootkvkebhd";
const USER = "investing_import_preview_runtime";
export function isR2DImportReady(env:Env):boolean {
  if (!isR2CPreviewEnabled(env) || env.VERCEL_ENV!=="preview" ||
      env.VERCEL_GIT_COMMIT_REF!==R2D_BRANCH ||
      env.INVESTING_R2D_IMPORT_ENABLED!=="enabled" ||
      env.INVESTING_R2D_PROJECT_REF!==PROJECT) return false;
  const ca=env.INVESTING_R2D_PG_CA_PEM?.replace(/\\n/g,"\n");
  const raw=env.INVESTING_R2D_PG_DSN;
  if (!ca?.includes("-----BEGIN CERTIFICATE-----") ||
      !ca.includes("-----END CERTIFICATE-----") || !raw || raw.length>2048) return false;
  try {
    const url=new URL(raw);
    return url.protocol==="postgresql:" &&
      url.hostname==="db."+PROJECT+".supabase.co" &&
      url.port==="5432" && url.pathname==="/postgres" &&
      decodeURIComponent(url.username)===USER &&
      !!url.password && !url.search && !url.hash;
  }catch{return false;}
}
export function makeImportPool(env:Env):Pool {
  if(!isR2DImportReady(env))throw new Error("IMPORT_PREVIEW_NOT_AUTHORIZED");
  return new Pool({
    connectionString:env.INVESTING_R2D_PG_DSN!,
    ssl:{ca:env.INVESTING_R2D_PG_CA_PEM!.replace(/\\n/g,"\n"),rejectUnauthorized:true},
    max:2,connectionTimeoutMillis:3000,idleTimeoutMillis:2000,allowExitOnIdle:true,
  });
}
