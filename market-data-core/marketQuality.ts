/**
 * G2-C: source-evidenced trading-calendar sessions and daily-close quality.
 * Pure and provider-neutral. No guessed weekends, holidays, sessions or real-time prices.
 */
import { MarketDataError, validMarketDate } from "./identity";
import { createHistoricalMarketDataResult, type HistoricalMarketDataResult } from "./contracts";

export type TradingCalendarRequest = Readonly<{
  listingId: string; providerId: string; startDate: string; endDate: string; asOf: string;
}>;
export type CalendarEvidence = "SCHEDULED" | "SOURCE_CONFIRMED";
export type CalendarState = "OPEN" | "SHORT_SESSION" | "CLOSED" | "HALTED";
export type CalendarSession = Readonly<{
  marketDate: string;
  state: CalendarState | null;
  evidence: CalendarEvidence | null;
  timezone: string | null;
  closeAt: string | null;
  revisionId: string | null;
  sourceRevision: string | null;
  asKnownAt: string | null;
  publishedAt: string | null;
}>;
export type TradingCalendarResult = Readonly<{
  request: TradingCalendarRequest;
  status: "AVAILABLE" | "PARTIAL" | "LICENSE_BLOCKED" | "UNAVAILABLE";
  rightsPolicyId: string | null;
  sessions: readonly CalendarSession[];
}>;
export type MarketQualityResult = Readonly<{
  state: "COMPLETE" | "PARTIAL" | "STALE" | "NO_DUE_SESSIONS" |
    "CALENDAR_UNVERIFIED" | "CALENDAR_CONFLICT" | "LICENSE_BLOCKED";
  coverage: "FULL" | "PARTIAL" | "NONE" | "UNKNOWN";
  freshness: "DAILY_CLOSE_CURRENT" | "DAILY_CLOSE_LAGGING" |
    "NOT_APPLICABLE" | "UNKNOWN";
  integrity: "SOURCE_FLAGS_PRESENT" | "NOT_EXTERNALLY_VERIFIED" | "UNKNOWN";
  dueSessions: number | null;
  coveredSessions: number | null;
  lastDueSessionDate: string | null;
  lastAvailableSessionDate: string | null;
}>;
const bad = (): never => { throw new MarketDataError("INVALID_PROVIDER_RESPONSE"); };
const object = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const uuid = (x: unknown): x is string => typeof x === "string" &&
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(x);
function utc(x: unknown): x is string {
  if (typeof x !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(x)) return false;
  const d = new Date(x);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,19) === x.slice(0,19);
}
function dayFromPg(x: unknown): string {
  if (typeof x === "string") return x;
  if (!(x instanceof Date) || Number.isNaN(x.getTime())) bad();
  return [String(x.getFullYear()).padStart(4,"0"),String(x.getMonth()+1).padStart(2,"0"),
    String(x.getDate()).padStart(2,"0")].join("-");
}
function utcFromPg(x: unknown): string | null {
  if (x === null) return null;
  if (typeof x === "string") return x;
  if (!(x instanceof Date) || Number.isNaN(x.getTime())) bad();
  return x.toISOString();
}
function validTimezone(x: unknown): x is string {
  if (typeof x !== "string" || x.length<1 || x.length>70 ||
      !/^[A-Za-z0-9_+\-/]+$/.test(x)) return false;
  try { new Intl.DateTimeFormat("en-US",{timeZone:x});return true; }
  catch {return false;}
}
function zoneDate(iso:string,zone:string):string {
  const parts=new Intl.DateTimeFormat("en-US",{
    timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",
  }).formatToParts(new Date(iso));
  const map=new Map(parts.map(p=>[p.type,p.value]));
  return [map.get("year"),map.get("month"),map.get("day")].join("-");
}
function requestValid(v:unknown):v is TradingCalendarRequest {
  return object(v) && uuid(v.listingId) && uuid(v.providerId) &&
    validMarketDate(v.startDate) && validMarketDate(v.endDate) &&
    v.startDate<=v.endDate && utc(v.asOf);
}
/** Limits date expansion; no implicit rule that Saturday or Sunday is CLOSED. */
function daysBetween(start:string,end:string):string[] {
  const from=Date.parse(start+"T00:00:00Z"),to=Date.parse(end+"T00:00:00Z");
  if(!Number.isFinite(from)||!Number.isFinite(to)||to<from||(to-from)/86400000>370)bad();
  const out:string[]=[];
  for(let n=from;n<=to;n+=86400000)out.push(new Date(n).toISOString().slice(0,10));
  return out;
}
function sessionValid(s:CalendarSession):boolean {
  if(!object(s)||!validMarketDate(s.marketDate))return false;
  if(s.state===null)return s.evidence===null&&s.timezone===null&&s.closeAt===null&&
    s.revisionId===null&&s.sourceRevision===null&&s.asKnownAt===null&&s.publishedAt===null;
  if(!["OPEN","SHORT_SESSION","CLOSED","HALTED"].includes(s.state)||
     !["SCHEDULED","SOURCE_CONFIRMED"].includes(String(s.evidence))||
     !validTimezone(s.timezone)||!uuid(s.revisionId)||
     typeof s.sourceRevision!=="string"||!/^[a-f0-9]{64}$/.test(s.sourceRevision)||
     !utc(s.asKnownAt)||!utc(s.publishedAt)||Date.parse(s.publishedAt)>Date.parse(s.asKnownAt))return false;
  if(s.state==="OPEN"||s.state==="SHORT_SESSION"){
    if(!utc(s.closeAt)||zoneDate(s.closeAt,s.timezone)!==s.marketDate)return false;
    if(s.evidence==="SOURCE_CONFIRMED"&&Date.parse(s.asKnownAt)<Date.parse(s.closeAt))return false;
  }else if(s.closeAt!==null)return false;
  return true;
}
function validateCalendar(result:TradingCalendarResult):TradingCalendarResult {
  if(!object(result)||!requestValid(result.request)||!Array.isArray(result.sessions)||
    !["AVAILABLE","PARTIAL","LICENSE_BLOCKED","UNAVAILABLE"].includes(result.status))bad();
  daysBetween(result.request.startDate,result.request.endDate);
  const seen=new Set<string>();let available=0,blocked=0;
  for(const s of result.sessions){
    if(!sessionValid(s)||s.marketDate<result.request.startDate||
       s.marketDate>result.request.endDate||seen.has(s.marketDate)||
       (s.asKnownAt!==null&&Date.parse(s.asKnownAt)>Date.parse(result.request.asOf))||
       (s.publishedAt!==null&&Date.parse(s.publishedAt)>Date.parse(result.request.asOf)))bad();
    seen.add(s.marketDate);if(s.state===null)blocked++;else available++;
  }
  if((result.status==="UNAVAILABLE"&&(result.sessions.length!==0||result.rightsPolicyId!==null))||
     (result.status==="AVAILABLE"&&(available===0||blocked!==0))||
     (result.status==="PARTIAL"&&(available===0||blocked===0))||
     (result.status==="LICENSE_BLOCKED"&&(blocked===0||available!==0))||
     (result.status!=="UNAVAILABLE"&&!uuid(result.rightsPolicyId)))bad();
  return result;
}
/** Convert rows from private read_trading_calendar; unknown data is fail-closed. */
export function tradingCalendarFromRows(
  request:TradingCalendarRequest,rows:readonly unknown[],
):TradingCalendarResult {
  if(!requestValid(request)||!Array.isArray(rows)||!rows.every(object))bad();
  daysBetween(request.startDate,request.endDate);
  if(rows.length===0)return Object.freeze({
    request,status:"UNAVAILABLE" as const,rightsPolicyId:null,sessions:Object.freeze([]),
  });
  const rights=rows[0].rights_policy_id;
  if(!uuid(rights))bad();
  const sessions:CalendarSession[]=rows.map(row=>{
    if(row.listing_id!==request.listingId||row.provider_id!==request.providerId||
       row.rights_policy_id!==rights||
       !["AVAILABLE","LICENSE_BLOCKED"].includes(String(row.status)))bad();
    const marketDate=dayFromPg(row.market_date);
    if(!validMarketDate(marketDate))bad();
    const visible=row.status==="AVAILABLE";
    if(!visible&&[
      row.session_state,row.evidence_state,row.exchange_timezone,row.session_close_at,
      row.calendar_revision_id,row.as_known_at,row.source_published_at,row.source_revision,
    ].some(v=>v!==null))bad();
    return {
      marketDate,state:visible?row.session_state as CalendarState:null,
      evidence:visible?row.evidence_state as CalendarEvidence:null,
      timezone:visible?row.exchange_timezone as string:null,
      closeAt:visible?utcFromPg(row.session_close_at):null,
      revisionId:visible?row.calendar_revision_id as string:null,
      asKnownAt:visible?utcFromPg(row.as_known_at):null,
      publishedAt:visible?utcFromPg(row.source_published_at):null,
      sourceRevision:visible?row.source_revision as string:null,
    };
  });
  const blocked=sessions.filter(s=>s.state===null).length;
  const status=blocked===sessions.length?"LICENSE_BLOCKED":
    blocked>0?"PARTIAL":"AVAILABLE";
  validateCalendar({request,status,rightsPolicyId:rights,sessions});
  return Object.freeze({
    request,status,rightsPolicyId:rights,
    sessions:Object.freeze(sessions.map(s=>Object.freeze(s))),
  });
}
function concealed(state:MarketQualityResult["state"]):MarketQualityResult {
  return Object.freeze({state,coverage:"UNKNOWN",freshness:"UNKNOWN",integrity:"UNKNOWN",
    dueSessions:null,coveredSessions:null,
    lastDueSessionDate:null,lastAvailableSessionDate:null});
}
/** Assesses only known daily closes, NOT intraday liquidity, tradability or price accuracy. */
export function assessHistoricalDailyClose(input:Readonly<{
  historical:HistoricalMarketDataResult;
  calendar:TradingCalendarResult;
  rights:Readonly<{marketPolicyId:string;calendarPolicyId:string}>;
  closeGraceMinutes:number;
}>):MarketQualityResult {
  if(!object(input)||!object(input.rights)||!uuid(input.rights.marketPolicyId)||
     !uuid(input.rights.calendarPolicyId)||!Number.isSafeInteger(input.closeGraceMinutes)||
     input.closeGraceMinutes<0||input.closeGraceMinutes>1440)bad();
  const history=createHistoricalMarketDataResult(input.historical);
  const calendar=validateCalendar(input.calendar);
  if(history.listingId!==calendar.request.listingId||
     history.request.startDate!==calendar.request.startDate||
     history.request.endDate!==calendar.request.endDate||
     history.request.asOf!==calendar.request.asOf)bad();
  if(["LICENSE_BLOCKED","PARTIAL"].includes(history.status)||
     ["LICENSE_BLOCKED","PARTIAL"].includes(calendar.status)||
     (history.rightsPolicyId!==null&&history.rightsPolicyId!==input.rights.marketPolicyId)||
     (calendar.rightsPolicyId!==null&&calendar.rightsPolicyId!==input.rights.calendarPolicyId))
    return concealed("LICENSE_BLOCKED");
  if(calendar.status==="UNAVAILABLE")return concealed("CALENDAR_UNVERIFIED");
  const cutoff=Date.parse(history.request.asOf);
  const lastDay=history.request.endDate<history.request.asOf.slice(0,10)?
    history.request.endDate:history.request.asOf.slice(0,10);
  if(lastDay<history.request.startDate)return concealed("CALENDAR_UNVERIFIED");
  const dates=daysBetween(history.request.startDate,lastDay);
  const lookup=new Map(calendar.sessions.map(s=>[s.marketDate,s]));
  if(dates.some(d=>!lookup.has(d)))return concealed("CALENDAR_UNVERIFIED");
  const due:string[]=[];
  for(const day of dates){
    const s=lookup.get(day)!;
    if(s.state===null)return concealed("LICENSE_BLOCKED");
    if(s.evidence!=="SOURCE_CONFIRMED"){
      // A source schedule is a prediction; after the due close it cannot prove closure.
      if(s.closeAt===null||Date.parse(s.closeAt)+input.closeGraceMinutes*60000<=cutoff)
        return concealed("CALENDAR_UNVERIFIED");
      continue;
    }
    if((s.state==="OPEN"||s.state==="SHORT_SESSION")&&s.closeAt!==null&&
       Date.parse(s.closeAt)+input.closeGraceMinutes*60000<=cutoff)due.push(day);
  }
  const observed=new Map(history.points.filter(p=>p.close!==null).map(p=>[p.marketDate,p]));
  // Quotes on explicitly closed/halted sessions conflict with calendar evidence.
  if([...observed.keys()].some(day=>!due.includes(day)))return concealed("CALENDAR_CONFLICT");
  const covered=due.filter(day=>observed.has(day));
  const missing=due.length-covered.length;
  const coverage=due.length===0?"NONE":missing===0?"FULL":covered.length===0?"NONE":"PARTIAL";
  const lastDue=due.at(-1)??null,lastCovered=covered.at(-1)??null;
  const integrity=history.points.some(p=>p.qualityFlags.length>0)?
    "SOURCE_FLAGS_PRESENT":"NOT_EXTERNALLY_VERIFIED";
  if(due.length===0)return Object.freeze({
    state:"NO_DUE_SESSIONS",coverage,freshness:"NOT_APPLICABLE",integrity,
    dueSessions:0,coveredSessions:0,
    lastDueSessionDate:null,lastAvailableSessionDate:null,
  });
  return Object.freeze({
    state:missing===0?"COMPLETE":lastCovered!==lastDue?"STALE":"PARTIAL",
    coverage,freshness:lastCovered===lastDue?"DAILY_CLOSE_CURRENT":"DAILY_CLOSE_LAGGING",
    integrity,dueSessions:due.length,coveredSessions:covered.length,
    lastDueSessionDate:lastDue,lastAvailableSessionDate:lastCovered,
  });
}
