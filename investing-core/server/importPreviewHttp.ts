import {z} from "zod";
import type {Pool} from "pg";
import {isR2DImportReady,makeImportPool} from "./importPreviewRuntime";
import {savePortfolioImport,PortfolioImportBlocked} from "./savePortfolioImport";
import {readOwnPortfolioImport,PortfolioImportReadBlocked} from "./readOwnPortfolioImport";
import {listOwnPortfolioImports} from "./listOwnPortfolioImports";
import {compareImportDeclarations,ImportComparisonBlocked} from "../portfolio/compareImportDeclarations";

type Env=Readonly<Record<string,string|undefined>>;
export type ImportActor=Readonly<{userId:string|null;sessionId:string|null}>;
export type ImportActorProvider=()=>Promise<ImportActor>;
export type ImportPool=Pick<Pool,"connect"> & {end?:()=>Promise<void>};
export type ImportPoolFactory=(env:Env)=>ImportPool;

const postSchema=z.object({
  portfolioId:z.string().uuid(),
  idempotencyKey:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{15,127}$/),
  declaration:z.unknown(),
}).strict();
const uuid=z.string().uuid();
const MAX_BYTES=1024*1024;
const headers=Object.freeze({
  "Cache-Control":"private, no-store, max-age=0",
  Vary:"Cookie, Authorization",
  "X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer",
  "X-Robots-Tag":"noindex,nofollow,noarchive",
});
function json(status:number,body:unknown):Response {
  return Response.json(body,{status,headers});
}
async function readLimitedBody(request:Request):Promise<unknown>{
  if(!request.body)throw new Error("INVALID_INPUT");
  const reader=request.body.getReader();let total=0;
  const chunks:Uint8Array[]=[];
  try{
    while(true){
      const part=await reader.read();if(part.done)break;
      total+=part.value.byteLength;
      if(total>MAX_BYTES)throw new Error("PAYLOAD_TOO_LARGE");
      chunks.push(part.value);
    }
  }catch(error){await reader.cancel().catch(()=>undefined);throw error;}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let at=0;
  for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
  return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)) as unknown;
}
export async function handlePortfolioImportHttp(
  request:Request,env:Env,actorProvider:ImportActorProvider,
  factory:ImportPoolFactory=makeImportPool,
):Promise<Response>{
  // No credentials or auth() accessed when candidate gate is closed.
  if(!isR2DImportReady(env))return json(404,{error:"NOT_FOUND"});
  let url:URL;
  try{url=new URL(request.url);}catch{return json(400,{error:"INVALID_INPUT"});}
  if(url.pathname!=="/api/investing/portfolio/import"||url.hash||request.url.endsWith("?"))
    return json(400,{error:"INVALID_INPUT"});
  if(request.method!=="GET"&&request.method!=="POST")
    return json(405,{error:"METHOD_NOT_ALLOWED"});
  if(request.method==="POST"){
    if(url.search || request.headers.get("origin")!==url.origin ||
      request.headers.get("content-type")?.split(";")[0]?.trim()!=="application/json")
      return json(403,{error:"BLOCKED"});
    const len=request.headers.get("content-length");
    if(len!==null&&(!/^\d+$/.test(len)||Number(len)>MAX_BYTES))
      return json(413,{error:"PAYLOAD_TOO_LARGE"});
  }
  let command: z.infer<typeof postSchema>|undefined;
  let portfolioId:string|undefined,snapshotId:string|undefined,baselineSnapshotId:string|undefined;
  if(request.method==="POST"){
    let input:unknown;
    try{input=await readLimitedBody(request);}catch(error){
      return json(error instanceof Error && error.message==="PAYLOAD_TOO_LARGE"?413:400,
        {error:error instanceof Error && error.message==="PAYLOAD_TOO_LARGE"?
          "PAYLOAD_TOO_LARGE":"INVALID_INPUT"});
    }
    const parsed=postSchema.safeParse(input);
    if(!parsed.success)return json(400,{error:"INVALID_INPUT"});
    command=parsed.data;
  }else{
    const keys=[...url.searchParams.keys()];
    if(!keys.includes("portfolioId")||
      keys.some(k=>k!=="portfolioId"&&k!=="snapshotId"&&k!=="baselineSnapshotId")||
      keys.length>3||url.searchParams.getAll("portfolioId").length!==1||
      url.searchParams.getAll("snapshotId").length>1||
      url.searchParams.getAll("baselineSnapshotId").length>1) {
      return json(400,{error:"INVALID_INPUT"});
    }
    const p=uuid.safeParse(url.searchParams.get("portfolioId"));
    if(!p.success)return json(400,{error:"INVALID_INPUT"});
    portfolioId=p.data;
    const snapshot=url.searchParams.get("snapshotId");
    if(snapshot!==null){
      const parsed=uuid.safeParse(snapshot);
      if(!parsed.success)return json(400,{error:"INVALID_INPUT"});
      snapshotId=parsed.data;
    }
    const baseline=url.searchParams.get("baselineSnapshotId");
    if(baseline!==null){
      const parsed=uuid.safeParse(baseline);
      if(!parsed.success||!snapshotId||parsed.data===snapshotId)
        return json(400,{error:"INVALID_INPUT"});
      baselineSnapshotId=parsed.data;
    }
  }
  let actor:ImportActor;
  try{actor=await actorProvider();}catch{return json(503,{error:"AUTH_UNAVAILABLE"});}
  if(!actor.userId||!/^user_[A-Za-z0-9_-]{5,120}$/.test(actor.userId)||!actor.sessionId)
    return json(401,{error:"UNAUTHENTICATED"});
  let pool:ImportPool|undefined;
  try{
    pool=factory(env);
    if(command){
      const saved=await savePortfolioImport(pool,actor,command);
      return json(201,{state:"USER_REPORTED_UNVERIFIED_IMPORT",receipt:saved,
        financialTruth:"UNVERIFIED",financialMovementsCreated:false});
    }
    if(!portfolioId)return json(400,{error:"INVALID_INPUT"});
    if(snapshotId){
      if(baselineSnapshotId){
        // Both readbacks independently enforce real owner membership, actor
        // and finalized/immutable state. No inferred cash, fills or P&L.
        const before=await readOwnPortfolioImport(pool,actor,{
          portfolioId,snapshotId:baselineSnapshotId});
        const after=await readOwnPortfolioImport(pool,actor,{portfolioId,snapshotId});
        const comparison=compareImportDeclarations(before,after);
        return json(200,{state:"UNVERIFIED_DECLARATION_COMPARISON",
          comparison,financialMovementsCreated:false});
      }
      const data=await readOwnPortfolioImport(pool,actor,{portfolioId,snapshotId});
      // Lossless string encoding; native bigint cannot be JSON serialized.
      return json(200,{state:"UNVERIFIED_IMPORT_READBACK",
        snapshot:{
          ...data,
          cashBalances:data.cashBalances.map(c=>({...c,minor:c.minor.toString()})),
          positions:data.positions.map(p=>({...p,quantityAtoms:p.quantityAtoms.toString(),
            reportedCostBasis:p.reportedCostBasis===null?null:{
              ...p.reportedCostBasis,minor:p.reportedCostBasis.minor.toString(),
            }})),
          plannedContributions:data.plannedContributions.map(c=>({...c,minor:c.minor.toString()})),
        },financialMovementsCreated:false});
    }
    const history=await listOwnPortfolioImports(pool,actor,portfolioId);
    return json(200,{state:"UNVERIFIED_IMPORT_HISTORY",history,
      financialMovementsCreated:false});
  }catch(error){
    if(error instanceof ImportComparisonBlocked){
      if(error.code==="INVALID_CHRONOLOGY"||error.code==="IDENTICAL_SNAPSHOT")
        return json(409,{error:"COMPARISON_NOT_POSSIBLE"});
      return json(503,{error:"COMPARISON_UNAVAILABLE"});
    }
    if(error instanceof PortfolioImportBlocked){
      if(error.code==="INVALID_INPUT")return json(400,{error:"INVALID_INPUT"});
      if(error.code==="UNAUTHENTICATED")return json(401,{error:"UNAUTHENTICATED"});
      if(error.code==="NOT_AUTHORIZED")return json(403,{error:"NOT_AUTHORIZED"});
      if(error.code==="IDEMPOTENCY_CONFLICT")return json(409,{error:"IDEMPOTENCY_CONFLICT"});
      if(error.code==="SOURCE_CONFLICT")return json(409,{error:"SOURCE_CONFLICT"});
    }
    if(error instanceof PortfolioImportReadBlocked){
      if(error.code==="INVALID_INPUT")return json(400,{error:"INVALID_INPUT"});
      if(error.code==="UNAUTHENTICATED")return json(401,{error:"UNAUTHENTICATED"});
      if(error.code==="NOT_AUTHORIZED"||error.code==="NOT_FOUND")
        return json(404,{error:"NOT_FOUND"});
    }
    // Never leak SQL, connection strings, account IDs or cached financial state.
    return json(503,{error:"IMPORT_UNAVAILABLE"});
  }finally{await pool?.end?.().catch(()=>undefined);}
}
