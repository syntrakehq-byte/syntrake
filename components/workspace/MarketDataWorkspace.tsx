"use client";

import { useRef, useState } from "react";
import { Search, RefreshCw, ShieldAlert } from "lucide-react";
import type { SiteLang } from "@/lib/i18n/siteLanguage";

type Candidate = Readonly<{
  name: string; symbol: string; mic: string | null;
  currency: string; kind: "EQUITY" | "ETF" | "FX"; token: string;
}>;
type Quote = Readonly<{
  status: "AVAILABLE"; symbol: string; name: string;
  mic: string | null; currency: string; kind: string;
  price: string; marketDate: string; observedAt: string;
  provider: "TWELVE_DATA"; priceType: "DAILY_CLOSE";
  source: "PROVIDER" | "MEMORY_CACHE";
}>;

const copy = {
  pt: {
    label: "Market Data · SYNTRAKE", title: "Dados de mercado",
    intro: "Pesquisa ações, ETFs e pares cambiais pelo nome ou símbolo. O Market Core identifica o instrumento e consulta o fornecedor automaticamente.",
    searchLabel: "Empresa, ação, ETF ou par cambial", placeholder: "Ex.: Microsoft, Apple, NVDA, EUR/USD",
    search: "Pesquisar na bolsa", searching: "A pesquisar…",
    results: "Resultados encontrados", choose: "Consultar preço", loading: "A consultar…",
    noResults: "A fonte não devolveu instrumentos correspondentes.",
    selected: "Instrumento selecionado", latest: "Último fecho diário disponível",
    date: "Data da cotação", checked: "Consultado em", provider: "Fornecedor",
    source: "Origem", cache: "Cache temporária", live: "Consulta ao fornecedor",
    footnote: "O último fecho diário não equivale a uma cotação em tempo real. Os resultados dependem da cobertura e disponibilidade da Twelve Data.",
    error: "Não foi possível obter os dados. Confirma a pesquisa ou tenta novamente.",
    login: "É necessário iniciar sessão.", blocked: "Este ambiente ainda não tem o Market Core ativado.",
    limited: "Limite de chamadas atingido. Volta a tentar depois.", invalid: "Pedido inválido.",
    type: "Tipo", EQUITY: "Ação", ETF: "ETF", FX: "Câmbio",
  },
  en: {
    label: "Market Data · SYNTRAKE", title: "Market data",
    intro: "Find stocks, ETFs and currency pairs by name or symbol. Market Core resolves the instrument and requests provider data.",
    searchLabel: "Company, stock, ETF or FX pair", placeholder: "E.g. Microsoft, Apple, NVDA, EUR/USD",
    search: "Search markets", searching: "Searching…",
    results: "Search results", choose: "Get price", loading: "Loading…",
    noResults: "No matching instruments were returned by the provider.",
    selected: "Selected instrument", latest: "Latest available daily close",
    date: "Market date", checked: "Retrieved at", provider: "Provider",
    source: "Source", cache: "Short-lived cache", live: "Provider request",
    footnote: "A daily close is not a live quote. Availability depends on Twelve Data coverage.",
    error: "Unable to load market data. Check your query and try again.",
    login: "You must sign in.", blocked: "Market Core is not enabled in this environment.",
    limited: "Rate limit reached. Try again later.", invalid: "Invalid request.",
    type: "Type", EQUITY: "Stock", ETF: "ETF", FX: "FX",
  },
  fr: {
    label: "Market Data · SYNTRAKE", title: "Données de marché",
    intro: "Recherchez actions, ETF et devises par nom ou symbole. Market Core identifie l'instrument et interroge le fournisseur.",
    searchLabel: "Entreprise, action, ETF ou paire de devises", placeholder: "Ex. Microsoft, Apple, NVDA, EUR/USD",
    search: "Rechercher", searching: "Recherche…",
    results: "Résultats", choose: "Obtenir le cours", loading: "Chargement…",
    noResults: "Aucun instrument correspondant n'a été retourné.",
    selected: "Instrument choisi", latest: "Dernière clôture journalière disponible",
    date: "Date de marché", checked: "Consulté à", provider: "Fournisseur",
    source: "Source", cache: "Cache temporaire", live: "Requête au fournisseur",
    footnote: "La clôture quotidienne n'est pas un cours en temps réel. Les résultats dépendent de Twelve Data.",
    error: "Impossible d'obtenir les données. Vérifiez la recherche puis réessayez.",
    login: "Connexion requise.", blocked: "Market Core n'est pas activé dans cet environnement.",
    limited: "Limite des requêtes atteinte. Réessayez plus tard.", invalid: "Requête invalide.",
    type: "Type", EQUITY: "Action", ETF: "ETF", FX: "Change",
  },
} as const;

function describeError(error: string | undefined, lang: SiteLang): string {
  const t = copy[lang];
  if (error === "UNAUTHENTICATED") return t.login;
  if (error === "MARKET_CORE_DISABLED") return t.blocked;
  if (error === "RATE_LIMITED") return t.limited;
  if (error === "INVALID_MARKET_REQUEST") return t.invalid;
  return t.error + (error ? " (" + error + ")" : "");
}

export function MarketDataWorkspace({ lang }: { lang: SiteLang }) {
  const t = copy[lang];
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<readonly Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busySearch, setBusySearch] = useState(false);
  const [busyQuote, setBusyQuote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const sequence = useRef(0);

  async function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const generation = ++sequence.current;
    setCandidates([]); setSelected(null); setQuote(null);
    setError(null); setBusySearch(true); setSearched(false);
    try {
      const response = await fetch("/api/market-data/discover?q=" + encodeURIComponent(query.trim()), {
        credentials: "include", cache: "no-store",
      });
      const body = await response.json() as { candidates?: Candidate[]; error?: string };
      if (generation !== sequence.current) return;
      if (!response.ok) setError(describeError(body.error, lang));
      else { setCandidates(body.candidates ?? []); setSearched(true); }
    } catch {
      if (generation === sequence.current) setError(t.error);
    } finally {
      if (generation === sequence.current) setBusySearch(false);
    }
  }

  async function getQuote(candidate: Candidate) {
    const generation = ++sequence.current;
    setSelected(candidate); setQuote(null); setError(null); setBusyQuote(true);
    try {
      const response = await fetch("/api/market-data/quote", {
        method: "POST", credentials: "include", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: candidate.token }),
      });
      const body = await response.json() as Quote & { error?: string };
      if (generation !== sequence.current) return;
      if (!response.ok || body.status !== "AVAILABLE") setError(describeError(body.error, lang));
      else setQuote(body);
    } catch {
      if (generation === sequence.current) setError(t.error);
    } finally {
      if (generation === sequence.current) setBusyQuote(false);
    }
  }

  return <div className="space-y-7">
    <section className="rounded-[26px] border border-[#33465e] bg-gradient-to-br from-[#153a41] to-[#112637] px-7 py-10 sm:px-10">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#e9c68b]">{t.label}</p>
      <h1 className="mt-4 text-4xl font-semibold text-white">{t.title}</h1>
      <p className="mt-4 max-w-2xl text-sm leading-7 text-[#c0cce0]">{t.intro}</p>
    </section>
    <section className="rounded-2xl border border-[#293850] bg-[#111d31] p-6">
      <form onSubmit={search} className="space-y-4">
        <label htmlFor="market-query" className="block text-sm font-medium text-white">{t.searchLabel}</label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input id="market-query" value={query} onChange={e => {
            sequence.current++;
            setQuery(e.target.value);
            setCandidates([]); setQuote(null); setSelected(null); setError(null); setSearched(false);
            setBusySearch(false); setBusyQuote(false);
          }} minLength={2} maxLength={64} required placeholder={t.placeholder}
            className="min-w-0 flex-1 rounded-xl border border-[#3a4963] bg-[#0b1424] px-4 py-3 text-white outline-none focus:border-[#d8bc82]" />
          <button type="submit" disabled={busySearch || query.trim().length < 2}
            className="flex items-center justify-center gap-2 rounded-xl bg-[#d8bc82] px-5 py-3 font-semibold text-[#101827] disabled:opacity-60">
            <Search size={17}/>{busySearch ? t.searching : t.search}
          </button>
        </div>
      </form>
    </section>
    {error && <div role="alert" className="flex gap-3 rounded-2xl border border-[#6d4b52] bg-[#301f2b] p-5 text-sm text-[#f3c7ca]"><ShieldAlert size={19}/>{error}</div>}
    {searched && candidates.length === 0 && <p role="status" className="text-sm text-[#cbd5e1]">{t.noResults}</p>}
    {candidates.length > 0 && <section className="rounded-2xl border border-[#293850] bg-[#111d31] p-6">
      <h2 className="text-lg font-semibold text-white">{t.results}</h2>
      <div className="mt-4 space-y-3">
        {candidates.map(candidate => <div key={candidate.token} className="flex flex-col justify-between gap-3 rounded-xl border border-[#32435b] bg-[#0b1424] p-4 sm:flex-row sm:items-center">
          <div>
            <p className="font-semibold text-white">{candidate.name}</p>
            <p className="mt-1 text-xs text-[#9fb0ca]">{candidate.symbol} · {candidate.mic ?? "FX"} · {candidate.currency} · {t[candidate.kind]}</p>
          </div>
          <button type="button" disabled={busyQuote} onClick={() => { void getQuote(candidate); }}
            className="rounded-lg border border-[#d8bc82] px-4 py-2 text-sm font-semibold text-[#e9c68b] disabled:opacity-60">
            {busyQuote && selected?.token === candidate.token ? t.loading : t.choose}
          </button>
        </div>)}
      </div>
    </section>}
    {quote && <section className="rounded-2xl border border-[#2d5b58] bg-[#122b31] p-6">
      <p className="text-xs uppercase tracking-[0.16em] text-[#95d5ca]">{t.latest}</p>
      <h2 className="mt-3 text-xl font-semibold text-white">{quote.name} ({quote.symbol})</h2>
      <p className="mt-3 text-4xl font-semibold text-white">{quote.price} <span className="text-xl text-[#9fcac2]">{quote.currency}</span></p>
      <dl className="mt-5 grid gap-3 text-sm text-[#b3c9cb] sm:grid-cols-2">
        <div><dt>{t.date}</dt><dd className="text-white">{quote.marketDate}</dd></div>
        <div><dt>{t.checked}</dt><dd className="text-white">{quote.observedAt}</dd></div>
        <div><dt>{t.provider}</dt><dd className="text-white">{quote.provider}</dd></div>
        <div><dt>{t.source}</dt><dd className="text-white">{quote.source === "MEMORY_CACHE" ? t.cache : t.live}</dd></div>
      </dl>
      <button type="button" disabled={busyQuote || !selected}
        className="mt-5 flex items-center gap-2 text-sm font-semibold text-[#e9c68b] disabled:opacity-60"
        onClick={() => { if (selected) void getQuote(selected); }}><RefreshCw size={15}/>{t.choose}</button>
    </section>}
    <p className="text-xs leading-5 text-[#9fb0ca]">{t.footnote}</p>
  </div>;
}
