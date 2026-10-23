import {pathToFileURL} from "node:url";
// SYNTRAKE R2-C2: read-only, REAL Clerk A/B authorization proof.
// Deliberately performs GET requests only. Never provision or write financial data.
// All JWTs are supplied through process environment, not command arguments or files.
const PROJECT_ORIGIN = "https://zkqgpejlkgootkvkebhd.supabase.co";
const MAX_ROWS = 101;
export class VerificationBlocked extends Error {
  constructor(code) { super(code); this.name = "VerificationBlocked"; this.code = code; }
}
function blocked(code) { throw new VerificationBlocked(code); }
function claimOf(jwt) {
  if (typeof jwt !== "string" || jwt.length > 8192 || !/^[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$/.test(jwt))
    blocked("INVALID_JWT_SHAPE");
  try {
    const claim = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    if (!claim || typeof claim !== "object" || Array.isArray(claim)
      || !/^user_[A-Za-z0-9_-]{5,120}$/.test(claim.sub ?? "")
      || claim.role !== "authenticated"
      || typeof claim.iss !== "string" || claim.iss.length < 8
      || !Number.isInteger(claim.exp) || claim.exp <= Date.now() / 1000)
      blocked("INVALID_CLAIMS_OR_EXPIRED");
    return { sub: claim.sub, iss: claim.iss, aud: JSON.stringify(claim.aud ?? null) };
  } catch (e) {
    if (e instanceof VerificationBlocked) throw e;
    blocked("UNREADABLE_JWT_CLAIMS");
  }
}
function corruptSignature(jwt) {
  const p = jwt.split(".");
  // Changing the first base64url character changes the signature bytes.
  const signature = p[2];
  p[2] = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
  return p.join(".");
}
function endpoint(origin, table, query) {
  const allowed = ["investment_accounts","portfolios","initial_portfolio_receipts","onboarding_intents"];
  if (!allowed.includes(table)) blocked("UNEXPECTED_TABLE");
  const url = new URL("/rest/v1/" + table, origin);
  for (const [key,value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}
function identityRows(rows, ownerField, sub) {
  if (!Array.isArray(rows)) blocked("NON_ARRAY_RESPONSE");
  if (rows.length >= MAX_ROWS) blocked("PAGINATED_RESULT_INCONCLUSIVE");
  if (rows.some(r => !r || typeof r !== "object" || r[ownerField] !== sub))
    blocked("CROSS_IDENTITY_DATA_DISCLOSED");
}
function ids(rows, field) {
  const out = rows.map(r => r[field]);
  if (out.some(id => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))
    blocked("INVALID_IDENTIFIER_IN_RESPONSE");
  return out;
}
export async function verifyClerkABReadOnly({
  projectUrl, publishableKey, tokenA, tokenB, fetchImpl = globalThis.fetch
}) {
  let origin;
  try { origin = new URL(projectUrl); } catch { blocked("INVALID_PROJECT_URL"); }
  if (origin.origin !== PROJECT_ORIGIN || origin.pathname !== "/" || origin.search || origin.hash)
    blocked("WRONG_PROJECT_OR_PRODUCTION_BLOCKED");
  if (!/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(publishableKey ?? ""))
    blocked("INVALID_PUBLISHABLE_KEY");
  if (typeof fetchImpl !== "function") blocked("FETCH_UNAVAILABLE");
  const a = claimOf(tokenA), b = claimOf(tokenB);
  if (a.sub === b.sub || a.iss !== b.iss || a.aud !== b.aud)
    blocked("A_AND_B_NOT_DISTINCT_COMPATIBLE_CLERK_SESSIONS");
  const fetchRead = async (table, query, token) => {
    const headers = {
      apikey: publishableKey, "Accept-Profile": "investing", Accept: "application/json",
      ...(token ? {Authorization: "Bearer " + token} : {})
    };
    let response;
    try {
      response = await fetchImpl(endpoint(origin,table,query), {
        method: "GET", headers, cache: "no-store", signal: AbortSignal.timeout(7000)
      });
    } catch { blocked("READ_NETWORK_UNAVAILABLE"); }
    if (!response || response.status !== 200)
      blocked("EXPECTED_SIGNED_GET_200");
    let rows;
    try { rows = await response.json(); } catch { blocked("UNREADABLE_JSON"); }
    if (!Array.isArray(rows)) blocked("NON_ARRAY_RESPONSE");
    return rows;
  };
  const rawStatus = async (token) => {
    let response;
    try {
      response = await fetchImpl(endpoint(origin, "investment_accounts", {
        select: "id", limit: "1"
      }), {
        method: "GET",
        headers: {
          apikey: publishableKey, "Accept-Profile": "investing", Accept: "application/json",
          ...(token ? {Authorization: "Bearer " + token} : {})
        },
        cache: "no-store", signal: AbortSignal.timeout(7000)
      });
    } catch { blocked("NEGATIVE_READ_NETWORK_UNAVAILABLE"); }
    if (!response || ![401,403].includes(response.status))
      blocked("UNSIGNED_OR_TAMPERED_JWT_NOT_REJECTED");
  };
  // Negative controls are non-mutating and require gateway rejection.
  await rawStatus(undefined);
  await rawStatus(corruptSignature(tokenA));
  await rawStatus(corruptSignature(tokenB));
  const readOwn = async (token,actor) => {
    const params = (select) => ({select,limit:String(MAX_ROWS)});
    const accounts=await fetchRead("investment_accounts",params("id,owner_user_id"),token);
    identityRows(accounts,"owner_user_id",actor.sub);
    const portfolios=await fetchRead("portfolios",params("id,investment_account_id"),token);
    if (portfolios.length >= MAX_ROWS) blocked("PAGINATED_RESULT_INCONCLUSIVE");
    const owned = new Set(ids(accounts,"id"));
    if (portfolios.some(row=>!owned.has(row?.investment_account_id)))
      blocked("CROSS_IDENTITY_PORTFOLIO_DISCLOSED");
    const receipts=await fetchRead("initial_portfolio_receipts",params("user_id,account_id"),token);
    identityRows(receipts,"user_id",actor.sub);
    if (receipts.some(r=>!owned.has(r.account_id))) blocked("RECEIPT_ACCOUNT_MISMATCH");
    const intents=await fetchRead("onboarding_intents",params("id,actor_user_id"),token);
    identityRows(intents,"actor_user_id",actor.sub);
    return {accounts,portfolios,receipts,intents};
  };
  const [ownA,ownB] = await Promise.all([readOwn(tokenA,a),readOwn(tokenB,b)]);
  if (!ownA.accounts.length || !ownB.accounts.length || !ownA.portfolios.length || !ownB.portfolios.length)
    blocked("INCONCLUSIVE_MISSING_OWN_ACCOUNTS_OR_PORTFOLIOS");
  const negativeCross = async (token, foreign, foreignOwner) => {
    for (const [table,field,idsFound] of [
      ["investment_accounts","id",ids(foreign.accounts,"id")],
      ["portfolios","id",ids(foreign.portfolios,"id")],
    ]) {
      if (!idsFound.length) blocked("INCONCLUSIVE_NO_FOREIGN_FIXTURE");
      const rows = await fetchRead(table,{select:"id",[field]:"in.("+idsFound.join(",")+")",limit:String(MAX_ROWS)},token);
      if (rows.length) blocked("CROSS_IDENTITY_RECORD_ACCESSIBLE");
    }
    for (const [table,field] of [
      ["initial_portfolio_receipts","user_id"],
      ["onboarding_intents","actor_user_id"],
    ]) {
      const rows=await fetchRead(table,{select:field,[field]:"eq."+foreignOwner.sub,limit:String(MAX_ROWS)},token);
      if (rows.length) blocked("CROSS_IDENTITY_PRIVATE_ROW_ACCESSIBLE");
    }
  };
  await negativeCross(tokenA,ownB,b);
  await negativeCross(tokenB,ownA,a);
  return {
    state:"PASS_READ_ONLY_AB", project:"PREVIEW_ONLY",
    checks:"unsigned/tampered denied; A and B distinct; signed own reads; cross-record denies",
    a:{accountCount:ownA.accounts.length,portfolioCount:ownA.portfolios.length,receiptCount:ownA.receipts.length},
    b:{accountCount:ownB.accounts.length,portfolioCount:ownB.portfolios.length,receiptCount:ownB.receipts.length},
    limitations:"No RPC POST, no writes, no production. Separate A/B first-portfolio provisioning and browser-session tests remain required."
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyClerkABReadOnly({
    projectUrl: process.env.SYNTRAKE_CLERK_AB_PREVIEW_URL,
    publishableKey: process.env.SYNTRAKE_CLERK_AB_PUBLISHABLE_KEY,
    tokenA: process.env.SYNTRAKE_CLERK_A_TOKEN,
    tokenB: process.env.SYNTRAKE_CLERK_B_TOKEN
  }).then(result => {
    console.log(JSON.stringify(result));
  }).catch(e=>{
    // Never log bearer tokens, URLs containing secrets, or response bodies.
    console.error(JSON.stringify({state:"BLOCKED",reason:e?.code||"UNEXPECTED_FAILURE"}));
    process.exitCode=1;
  });
}
