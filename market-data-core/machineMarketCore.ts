import { createHash, timingSafeEqual } from "node:crypto";
import { MarketDataError } from "./identity";
import { classifyDynamicMarketError, type DynamicMarketHistory, type DynamicMarketQuote, type DynamicMarketCandidate } from "./dynamicMarketGateway";
import { isG3HostedPreviewReady } from "./g3HostedPreviewExecutor";
import { readMarketDataForCoreConsumer, type MarketConsumerQuotesResponse, type MarketConsumerInstrument } from "./consumerMarketService";

type Env = Readonly<Record<string,string | undefined>>;
type Core = Readonly<{
  discover(query:string):Promise<readonly DynamicMarketCandidate[]>;
  readInstrument(selected:MarketConsumerInstrument):Promise<DynamicMarketQuote>;
  readHistory(selected:MarketConsumerInstrument,start:string,end:string):Promise<DynamicMarketHistory>;
}>;
const TOKEN=/^[A-Za-z0-9_-]{48,256}$/;
const headers={
  "Cache-Control":"private, no-store, max-age=0",
  "X-Robots-Tag":"noindex, nofollow, noarchive",
  "Referrer-Policy":"no-referrer",
};
function response(status:number,body:unknown):Response {
  return Response.json(body,{status,headers});
}
function authenticated(authorization:string|null,expected:string|undefined):boolean {
  if(!expected||!TOKEN.test(expected))return false;
  const provided=/^Bearer ([A-Za-z0-9_-]{48,256})$/.exec(authorization??"")?.[1];
  if(!provided)return false;
  return timingSafeEqual(
    createHash("sha256").update(provided).digest(),
    createHash("sha256").update(expected).digest(),
  );
}
function object(input:unknown):input is Record<string,unknown> {
  return input!==null&&typeof input==="object"&&!Array.isArray(input);
}
function onlyKeys(o:Record<string,unknown>,allowed:readonly string[]):boolean {
  return Object.keys(o).every(k=>allowed.includes(k));
}

/**
 * Machine-to-machine Market Core API. It never checks browser cookies or
 * requires a Clerk session. The caller uses a dedicated capability token
 * and must send a verified instrument request; neither Investing nor Trading
 * ever contacts Twelve Data directly.
 *
 * Preview-gated, no scheduler, no automatic work, no portfolio/ledger writes.
 */
export async function handleMachineMarketCore(
  request:Request,env:Env,core:Core,
):Promise<Response> {
  let url:URL;
  try {url=new URL(request.url);} catch {return response(404,{error:"NOT_FOUND"});}
  if(request.method!=="POST"||url.pathname!=="/api/internal/market-core"||
      url.search!==""||!isG3HostedPreviewReady(env)||
      env.G3G_WORKER_MODE!=="disabled"||
      env.G3G_INTERNAL_MARKET_MODE!=="enabled"||
      !authenticated(request.headers.get("authorization"),env.G3G_MARKET_INTERNAL_TOKEN)) {
    return response(404,{error:"NOT_FOUND"});
  }
  if(!/^application\/json(?:;|$)/i.test(request.headers.get("content-type")??"")){
    return response(415,{error:"UNSUPPORTED_MEDIA_TYPE"});
  }
  let body:unknown;
  try {
    const raw=await request.text();
    if(raw.length>6500)throw new Error("OVERSIZE");
    body=JSON.parse(raw);
  } catch {return response(400,{error:"INVALID_REQUEST"});}
  if(!object(body)||typeof body.operation!=="string")return response(400,{error:"INVALID_REQUEST"});
  try {
    if(body.operation==="discover") {
      if(!onlyKeys(body,["operation","query"])||typeof body.query!=="string")return response(400,{error:"INVALID_REQUEST"});
      const candidates=await core.discover(body.query);
      return response(200,{status:candidates.length?"AVAILABLE":"UNAVAILABLE",candidates});
    }
    // A single provider-discovered listing can be resolved without a hard-coded catalog.
    // Multiple listings remain ambiguous; selecting one is the consumer's decision.
    if(body.operation==="resolveQuote") {
      if(!onlyKeys(body,["operation","query"])||typeof body.query!=="string")return response(400,{error:"INVALID_REQUEST"});
      const candidates=await core.discover(body.query);
      if(candidates.length===0)return response(200,{status:"UNAVAILABLE",candidates:[]});
      if(candidates.length!==1)return response(200,{status:"AMBIGUOUS",candidates});
      const first=candidates[0];
      return response(200,await core.readInstrument({
        kind:first.kind,symbol:first.symbol,mic:first.mic,
        currency:first.currency,name:first.name,
      }));
    }
    if(body.operation==="quotes") {
      if(!onlyKeys(body,["operation","consumer","interval","instruments"])||
         (body.consumer!=="INVESTING"&&body.consumer!=="TRADING")||
         body.interval!=="1day"||
         !Array.isArray(body.instruments)||body.instruments.length<1||body.instruments.length>20) {
        return response(400,{error:"INVALID_REQUEST"});
      }
      const result:MarketConsumerQuotesResponse=await readMarketDataForCoreConsumer({
        consumer:body.consumer,
        interval:"1day",
        instruments:body.instruments as MarketConsumerInstrument[],
      },core);
      return response(200,result);
    }
    if(body.operation==="history") {
      if(!onlyKeys(body,["operation","instrument","startDate","endDate"])||
          !object(body.instrument)||
          typeof body.startDate!=="string"||typeof body.endDate!=="string"||
          !onlyKeys(body.instrument,["kind","symbol","mic","currency","name"])) {
        return response(400,{error:"INVALID_REQUEST"});
      }
      const history=await core.readHistory(
        body.instrument as MarketConsumerInstrument,body.startDate,body.endDate,
      );
      return response(200,history);
    }
    return response(400,{error:"INVALID_REQUEST"});
  } catch(error) {
    if(error instanceof Error && error.message.startsWith("MARKET_CONSUMER_")){
      return response(400,{error:"INVALID_REQUEST"});
    }
    const status=classifyDynamicMarketError(error);
    // Return only sanitized numeric status to authenticated internal callers.
    // Never expose a provider body, URL, key, headers or exception message.
    const upstreamStatus=error instanceof MarketDataError ? error.providerStatus : null;
    return response(status.status,{
      error:status.error,
      ...(upstreamStatus===null?{}:{upstreamStatus}),
    });
  }
}
