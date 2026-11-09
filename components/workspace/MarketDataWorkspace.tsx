"use client";

import { useRef, useState } from "react";
import { Search, ShieldAlert, SlidersHorizontal } from "lucide-react";
import type { SiteLang } from "@/lib/i18n/siteLanguage";
import { buildMarketDataUrl, canPresentMarketData, LatestMarketRequest } from "./marketDataWorkspaceLogic";

type MarketResponse = Readonly<{
  status: string;
  listingId: string;
  current?: { instrument: { symbol: string; kind: string; mic: string | null; currency: string; }; revisionId: string; price: string; currency: string; marketDate: string; asOf: string; quality: { coverage: string; freshness: string }; sourceRefs: readonly { provider: string; originalSourceId: string }[]; } | null;
  history?: { request: { startDate: string; endDate: string; asOf: string; interval: string; adjustment: string }; points: readonly { marketDate: string; close: string | null; revisionId: string | null; asKnownAt: string | null; qualityFlags: readonly string[] }[] } | null;
}>;

const text = {
  pt: { eyebrow: "Market Data · G3-D", title: "Dados de mercado", intro: "Consulta técnica de uma listing canónica persistida. O identificador é usado apenas para pedir dados ao servidor.", listing: "Listing ID", listingHint: "UUID canónico da listing", from: "Início", to: "Fim", asOf: "Conhecido até", search: "Consultar dados", loading: "A consultar…", unavailable: "Os dados de mercado não estão disponíveis neste ambiente.", login: "A sessão expirou. Inicia sessão novamente.", invalid: "Pedido inválido. Confirma a listing e as datas.", blocked: "Os direitos de utilização não permitem apresentar estes dados.", partial: "Os dados estão incompletos ou não têm qualidade suficiente para uma cotação validada.", stale: "Os dados não são suficientemente recentes para serem apresentados como atuais.", noData: "Não existem dados persistidos para este pedido.", quote: "Último valor persistido", history: "Histórico diário", quality: "Qualidade e proveniência", priceDate: "Data do preço", known: "Conhecido em", provider: "Fonte", coverage: "Cobertura", freshness: "Frescura", revision: "Revisão", pit: "Cutoff PIT", noHistory: "Sem pontos históricos autorizados." },
  en: { eyebrow: "Market Data · G3-D", title: "Market data", intro: "Technical query for a persisted canonical listing. The identifier is used only to request data from the server.", listing: "Listing ID", listingHint: "Canonical listing UUID", from: "From", to: "To", asOf: "Known through", search: "Query data", loading: "Querying…", unavailable: "Market data is not available in this environment.", login: "Your session expired. Please sign in again.", invalid: "Invalid request. Check the listing and dates.", blocked: "Usage rights do not allow these data to be displayed.", partial: "Data are incomplete or lack sufficient quality for a validated quote.", stale: "Data are not fresh enough to be shown as current.", noData: "No persisted data exists for this request.", quote: "Last persisted value", history: "Daily history", quality: "Quality and provenance", priceDate: "Price date", known: "Known at", provider: "Source", coverage: "Coverage", freshness: "Freshness", revision: "Revision", pit: "PIT cutoff", noHistory: "No authorized historical points." },
  fr: { eyebrow: "Market Data · G3-D", title: "Données de marché", intro: "Consultation technique d'une cotation canonique persistée. L'identifiant sert uniquement à demander les données au serveur.", listing: "Listing ID", listingHint: "UUID canonique de la cotation", from: "Début", to: "Fin", asOf: "Connu jusqu'au", search: "Consulter", loading: "Consultation…", unavailable: "Les données de marché ne sont pas disponibles dans cet environnement.", login: "La session a expiré. Veuillez vous reconnecter.", invalid: "Requête invalide. Vérifiez la cotation et les dates.", blocked: "Les droits d'utilisation n'autorisent pas l'affichage de ces données.", partial: "Les données sont incomplètes ou leur qualité est insuffisante pour une cotation validée.", stale: "Les données ne sont pas assez fraîches pour être présentées comme actuelles.", noData: "Aucune donnée persistée n'existe pour cette requête.", quote: "Dernière valeur persistée", history: "Historique quotidien", quality: "Qualité et provenance", priceDate: "Date du prix", known: "Connu le", provider: "Source", coverage: "Couverture", freshness: "Fraîcheur", revision: "Révision", pit: "Cutoff PIT", noHistory: "Aucun point historique autorisé." },
} as const;

const personalProbeText = {
  pt: { title: "Verificar ligação Twelve Data", action: "Testar uma consulta real", busy: "A verificar…", ok: "A API respondeu com dados validados", failed: "A consulta não foi validada", detail: "Teste privado de uma observação diária AAPL. Não altera a carteira nem guarda preços." },
  en: { title: "Verify Twelve Data connection", action: "Test one real request", busy: "Verifying…", ok: "API returned validated data", failed: "Request was not validated", detail: "Private AAPL daily-observation diagnostic. Does not modify a portfolio or store prices." },
  fr: { title: "Vérifier la connexion Twelve Data", action: "Tester une requête réelle", busy: "Vérification…", ok: "L'API a retourné des données validées", failed: "Requête non validée", detail: "Diagnostic privé sur une observation quotidienne AAPL. Aucune écriture de portefeuille ni stockage de prix." },
} as const;

function message(lang: SiteLang, status: string): string {
  const t = text[lang];
  return status === "LICENSE_BLOCKED" ? t.blocked : status === "PARTIAL" ? t.partial : status === "STALE" ? t.stale : status === "UNAVAILABLE" || status === "REFRESH_REQUIRED" ? t.noData : t.unavailable;
}

export function MarketDataWorkspace({ lang }: { lang: SiteLang }) {
  const t = text[lang];
  const [listingId, setListingId] = useState("");
  const [from, setFrom] = useState("2026-01-01");
  const [to, setTo] = useState("2026-01-31");
  const [asOf, setAsOf] = useState("2026-02-01T00:00:00Z");
  const [result, setResult] = useState<MarketResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [probe, setProbe] = useState<{ pending: boolean; message: string | null }>({ pending: false, message: null });
  const probeCopy = personalProbeText[lang];

  const requestGate = useRef<LatestMarketRequest | null>(null);
  if (requestGate.current === null) requestGate.current = new LatestMarketRequest();

  function changeQueryValue(setter: (value: string) => void, value: string): void {
    requestGate.current?.invalidate();
    setter(value);
    setResult(null);
    setError(null);
    setLoading(false);
  }

  async function runPersonalProbe(): Promise<void> {
    setProbe({ pending: true, message: null });
    try {
      const response = await fetch("/api/internal/g3-personal-probe", {
        method: "POST", credentials: "include", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const body = await response.json() as { status?: string; error?: string; marketDate?: string };
      setProbe({
        pending: false,
        message: response.ok && body.status === "PROVIDER_VALIDATED"
          ? probeCopy.ok + (body.marketDate ? " · " + body.marketDate : "")
          : probeCopy.failed + (body.error ? " · " + body.error : ""),
      });
    } catch {
      setProbe({ pending: false, message: probeCopy.failed });
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null); setError(null); setLoading(true);
    const request = requestGate.current!.begin();
    try {
      const response = await fetch(buildMarketDataUrl("/api/investing/market-data", { listingId: listingId.trim(), startDate: from, endDate: to, asOf }), { method: "GET", credentials: "include", cache: "no-store", signal: request.signal });
      const body = await response.json() as { error?: string } & Partial<MarketResponse>;
      if (!requestGate.current!.accepts(request.generation)) return;
      if (response.status === 401) setError(t.login);
      else if (response.status === 400) setError(t.invalid);
      else if (response.status === 404 || response.status === 503) setError(t.unavailable);
      else if (!response.ok) setError(t.unavailable);
      else if (body.status && canPresentMarketData(body.status)) setResult(body as MarketResponse);
      else setResult(body as MarketResponse);
    } catch (cause) { if (requestGate.current!.accepts(request.generation) && !(cause instanceof DOMException && cause.name === "AbortError")) { setResult(null); setError(t.unavailable); } }
    finally { if (requestGate.current!.accepts(request.generation)) setLoading(false); }
  }

  const current = result?.status === "AVAILABLE" ? result.current : null;
  const history = result?.status === "AVAILABLE" ? result.history : null;

  return <div className="space-y-8">
    <section className="rounded-[26px] border border-[#33465e] bg-gradient-to-br from-[#153a41] to-[#112637] px-7 py-10 sm:px-10">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#e9c68b]">{t.eyebrow}</p>
      <h1 className="mt-4 text-4xl font-semibold text-white">{t.title}</h1>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-[#c0cce0]">{t.intro}</p>
    </section>
    <section className="rounded-[22px] border border-[#293850] bg-[#111d31] p-6">
      <h2 className="text-lg font-semibold text-white">{probeCopy.title}</h2>
      <p className="mt-2 text-sm text-[#a9b7cc]">{probeCopy.detail}</p>
      <button
        type="button"
        onClick={() => { void runPersonalProbe(); }}
        disabled={probe.pending}
        className="mt-4 rounded-xl border border-[#d8bc82] px-4 py-3 text-sm font-semibold text-[#d8bc82] disabled:opacity-60"
      >{probe.pending ? probeCopy.busy : probeCopy.action}</button>
      {probe.message && <p role="status" className="mt-3 text-sm text-[#e1e8f5]">{probe.message}</p>}
    </section>
    <section className="rounded-[22px] border border-[#293850] bg-[#111d31] p-6" aria-labelledby="market-query-title">
      <div className="flex items-center gap-3"><SlidersHorizontal size={19} className="text-[#d8bc82]" aria-hidden="true"/><h2 id="market-query-title" className="text-lg font-semibold text-white">{t.listing}</h2></div>
      <form onSubmit={submit} className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <label className="lg:col-span-2"><span className="mb-2 block text-xs text-[#a9b7cc]">{t.listingHint}</span><input required value={listingId} onChange={e => changeQueryValue(setListingId, e.target.value)} className="w-full rounded-xl border border-[#3a4963] bg-[#0b1424] px-3 py-3 text-sm text-white outline-none focus:border-[#d8bc82]" /></label>
        <label><span className="mb-2 block text-xs text-[#a9b7cc]">{t.from}</span><input required type="date" value={from} onChange={e => changeQueryValue(setFrom, e.target.value)} className="w-full rounded-xl border border-[#3a4963] bg-[#0b1424] px-3 py-3 text-sm text-white outline-none focus:border-[#d8bc82]" /></label>
        <label><span className="mb-2 block text-xs text-[#a9b7cc]">{t.to}</span><input required type="date" value={to} onChange={e => changeQueryValue(setTo, e.target.value)} className="w-full rounded-xl border border-[#3a4963] bg-[#0b1424] px-3 py-3 text-sm text-white outline-none focus:border-[#d8bc82]" /></label>
        <label><span className="mb-2 block text-xs text-[#a9b7cc]">{t.asOf} (UTC)</span><input required type="text" inputMode="text" placeholder="2026-02-01T00:00:00Z" value={asOf} onChange={e => changeQueryValue(setAsOf, e.target.value)} className="w-full rounded-xl border border-[#3a4963] bg-[#0b1424] px-3 py-3 text-sm text-white outline-none focus:border-[#d8bc82]" /></label>
        <button disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#d8bc82] px-4 py-3 text-sm font-semibold text-[#101827] transition hover:bg-[#f0d9a7] disabled:cursor-wait disabled:opacity-60 md:col-span-2 lg:col-span-5" type="submit"><Search size={17} aria-hidden="true"/>{loading ? t.loading : t.search}</button>
      </form>
    </section>
    {error && <div role="alert" className="flex items-start gap-3 rounded-2xl border border-[#6d4b52] bg-[#301f2b] p-5 text-sm text-[#f3c7ca]"><ShieldAlert size={19} aria-hidden="true"/><p>{error}</p></div>}
    {result && result.status !== "AVAILABLE" && <div role="status" className="rounded-2xl border border-[#6a5a3f] bg-[#2d291f] p-5 text-sm text-[#ecd9a7]"><p className="font-semibold">{result.status}</p><p className="mt-1">{message(lang, result.status)}</p></div>}
    {current && result && <section className="grid gap-5 lg:grid-cols-2" aria-label={t.quote}>
      <div className="rounded-2xl border border-[#2d5b58] bg-[#122b31] p-6"><p className="text-xs uppercase tracking-[0.16em] text-[#95d5ca]">{t.quote}</p><p className="mt-4 text-4xl font-semibold text-white">{current.price} <span className="text-lg text-[#9fcac2]">{current.currency}</span></p><dl className="mt-5 grid grid-cols-2 gap-3 text-xs text-[#b3c9cb]"><div><dt>{t.priceDate}</dt><dd className="mt-1 text-white">{current.marketDate}</dd></div><div><dt>{t.known}</dt><dd className="mt-1 text-white">{current.asOf}</dd></div><div><dt>{t.provider}</dt><dd className="mt-1 text-white">{current.sourceRefs[0]?.provider}</dd></div><div><dt>{t.quality}</dt><dd className="mt-1 text-white">{current.quality.coverage} · {current.quality.freshness}</dd></div></dl></div>
      <div className="rounded-2xl border border-[#293850] bg-[#111d31] p-6"><p className="text-xs uppercase tracking-[0.16em] text-[#bfa06b]">{current.instrument.symbol} · {current.instrument.kind}</p><p className="mt-3 text-xl font-semibold text-white">{current.instrument.mic ?? "—"} · {current.instrument.currency}</p><p className="mt-4 text-xs text-[#a9b7cc]">{t.revision}: {current.revisionId}</p><p className="mt-1 text-xs text-[#a9b7cc]">{t.pit}: {history?.request.asOf ?? current.asOf}</p></div>
    </section>}
    {history && result?.status === "AVAILABLE" && <section className="rounded-2xl border border-[#293850] bg-[#111d31] p-6" aria-labelledby="market-history-title"><h2 id="market-history-title" className="text-lg font-semibold text-white">{t.history}</h2>{history.points.length === 0 ? <p className="mt-4 text-sm text-[#a9b7cc]">{t.noHistory}</p> : <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="text-xs uppercase tracking-[0.12em] text-[#8f9eb9]"><tr><th className="pb-3">{t.priceDate}</th><th className="pb-3">Close</th><th className="pb-3">{t.known}</th><th className="pb-3">{t.revision}</th></tr></thead><tbody>{history.points.map(point => <tr key={`${point.marketDate}-${point.revisionId}`} className="border-t border-[#293850] text-[#dce4f0]"><td className="py-3">{point.marketDate}</td><td className="py-3">{point.close}</td><td className="py-3">{point.asKnownAt}</td><td className="max-w-[180px] truncate py-3 text-xs">{point.revisionId}</td></tr>)}</tbody></table></div>}</section>}
    {current && <section className="rounded-2xl border border-[#293850] bg-[#111d31] p-6"><h2 className="text-lg font-semibold text-white">{t.quality}</h2><p className="mt-3 text-sm text-[#a9b7cc]">{t.coverage}: {current.quality.coverage} · {t.freshness}: {current.quality.freshness} · {t.provider}: {current.sourceRefs[0]?.provider}</p></section>}
  </div>;
}
