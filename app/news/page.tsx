import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Clock3, Globe2, Newspaper, RefreshCw, ShieldCheck } from "lucide-react";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { NEWS_OFFICIAL_PLUS_DAILY_NEWS_V1 } from "@/news-core/globalNewsOfficialSources";
import { readNewsN5ForSite } from "@/news-core/siteNewsN5";
import { manualNewsRefreshAllowed } from "@/news-core/siteNewsManualRefresh";
import { ManualNewsRefresh } from "./ManualNewsRefresh";
import { fetchAndParseRegisteredSource } from "@/news-core/globalNewsCollector";
import { resolveRequestSiteLang, withLangQuery } from "@/lib/i18n/requestSiteLang";
import type { SiteLang } from "@/lib/i18n/siteLanguage";
import type { GlobalNewsItem } from "@/news-core/globalNewsAdapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata: Metadata = {
  title: "Live news sources | Syntrake",
  description: "Current headlines collected from identified financial and world news RSS sources.",
  robots: { index: false, follow: false, noarchive: true },
};

// This is a read-only live feed view using the existing News Core adapters.
// It is NOT the durable N-G8 scheduler or a substitute for N5/PIT in production.
const RSS_SOURCE_IDS = [
  "world-un-news",
  "world-france24",
  "us-cnbc-business",
  "eu-ecb-press",
  "us-fed-press",
] as const;
const SITE_N5_MODE = process.env.NEWS_SITE_READ_MODE === "N5";
const SOURCE_REGISTRY = (SITE_N5_MODE ? NEWS_OFFICIAL_PLUS_DAILY_NEWS_V1.map(source => source.sourceId) : RSS_SOURCE_IDS).map(id => {
  const source = NEWS_OFFICIAL_PLUS_DAILY_NEWS_V1.find(entry => entry.sourceId === id);
  if (!source) throw new Error("NEWS_SITE_SOURCE_NOT_REGISTERED");
  return source;
});
const messages = {
  pt: {
    eyebrow: "SYNTRAKE · NEWS CORE",
    heading: "Notícias mundiais e dos mercados",
    intro: "Manchetes reais das fontes registadas. Atualizadas através dos feeds oficiais, com ligação direta à publicação original.",
    live: "Feeds consultados agora",
    warning: "Visualização de feeds em tempo real. A recolha 24/7 e o histórico persistente do News Core ainda não estão ativados nesta instalação.",
    sources: "Fontes consultadas",
    items: "Manchetes encontradas",
    checked: "Consulta efetuada em",
    published: "Publicado",
    unknown: "Data não fornecida",
    original: "Abrir notícia original",
    noNews: "Esta fonte não devolveu notícias neste momento.",
    down: "Esta fonte está temporariamente indisponível.",
    all: "Todas",
    filter: "Filtrar por fonte",
    empty: "Não existem manchetes disponíveis nesta consulta.",
    rights: "Apenas títulos, datas e links; os artigos pertencem aos respetivos publicadores. Informação noticiosa, não aconselhamento financeiro.",
    reload: "Atualizar consulta",
    durable: "Consulta ao histórico persistente N5. Mostra apenas revisões disponíveis no instante da leitura. O funcionamento contínuo depende do supervisor externo.",
    manual: "Histórico persistente N5. A atualização manual consulta as fontes elegíveis e guarda novas publicações. Não existe recolha contínua neste modo.",
    readHistory: "Atualizar histórico",
    stored: "Histórico guardado",
    available: "Disponível",
    unavailable: "Indisponível",
  },
  en: {
    eyebrow: "SYNTRAKE · NEWS CORE",
    heading: "World and market news",
    intro: "Real headlines from registered sources, fetched from the original RSS feeds with links to the original publishers.",
    live: "Feeds checked now",
    warning: "Live RSS view only. Continuous 24/7 collection and the durable News Core history are not yet active in this deployment.",
    sources: "Sources checked",
    items: "Headlines found",
    checked: "Checked at",
    published: "Published",
    unknown: "Date unavailable",
    original: "Open original story",
    noNews: "This source has no headlines in this response.",
    down: "This source is temporarily unavailable.",
    all: "All",
    filter: "Filter by source",
    empty: "No headlines are available in this request.",
    rights: "Titles, dates and links only. Articles belong to their publishers. News content is not financial advice.",
    reload: "Refresh sources",
    durable: "Read-only N5 persistent history. Only revisions known at the request cutoff are shown. Continuous ingestion depends on the independent supervisor.",
    manual: "Persistent N5 history. Manual refresh checks eligible sources and saves new publications. This mode does not provide continuous collection.",
    readHistory: "Refresh history",
    stored: "Persisted history",
    available: "Available",
    unavailable: "Unavailable",
  },
  fr: {
    eyebrow: "SYNTRAKE · NEWS CORE",
    heading: "Actualités mondiales et financières",
    intro: "De vrais titres provenant des sources enregistrées, lus directement dans les flux RSS et liés aux éditeurs originaux.",
    live: "Flux consultés maintenant",
    warning: "Vue RSS en direct uniquement. La collecte 24 h/24 et l'archive persistante du News Core ne sont pas encore actives sur ce déploiement.",
    sources: "Sources consultées",
    items: "Titres trouvés",
    checked: "Consulté à",
    published: "Publié",
    unknown: "Date indisponible",
    original: "Ouvrir l'article original",
    noNews: "Aucun titre renvoyé par cette source.",
    down: "Source temporairement indisponible.",
    all: "Toutes",
    filter: "Filtrer par source",
    empty: "Aucun titre disponible pour cette consultation.",
    rights: "Titres, dates et liens uniquement. Les articles appartiennent à leurs éditeurs. Ces actualités ne sont pas des conseils financiers.",
    reload: "Actualiser les sources",
    durable: "Historique persistant N5 en lecture seule. Seules les révisions connues au moment de la lecture sont affichées. La collecte continue dépend du superviseur externe.",
    manual: "Historique persistant N5. L’actualisation manuelle consulte les sources éligibles et enregistre les nouvelles publications. Ce mode ne collecte pas en continu.",
    readHistory: "Actualiser l’historique",
    stored: "Historique enregistré",
    available: "Disponible",
    unavailable: "Indisponible",
  },
} as const;
type Stream = { sourceId: string; publisher: string; count: number; ok: boolean; items: readonly GlobalNewsItem[] };
async function getStreams(): Promise<Stream[]> {
  if (SITE_N5_MODE) {
    try {
      const saved = await readNewsN5ForSite({
        connectionString: process.env.NEWS_READER_DATABASE_URL ?? "",
        tlsCaPem: process.env.NEWS_READER_CA_PEM ?? "",
        sourceIds: SOURCE_REGISTRY.map(source => source.sourceId),
      });
      return SOURCE_REGISTRY.map(source => {
        const items: GlobalNewsItem[] = saved.filter(record => record.sourceId === source.sourceId).map(record => ({
          sourceId: record.sourceId, providerKey: "rss", externalId: record.publicationRevisionId,
          publicationId: record.publicationId, originalUrl: record.originalUrl,
          title: record.title, summary: null, publishedAt: record.publishedAt,
          updatedAt: null, retrievedAt: record.ingestedAt ?? record.asKnownAt ?? new Date().toISOString(),
          publisher: source.publisher, rightsPolicyId: source.rightsPolicyId,
          contentFingerprint: record.publicationRevisionId, qualityFlags: record.qualityFlags,
        }));
        return { sourceId: source.sourceId, publisher: source.publisher, count: items.length, ok: true, items };
      });
    } catch {
      console.error("[NEWS_SITE_N5] persistent history unavailable");
      return SOURCE_REGISTRY.map(source => ({ sourceId: source.sourceId, publisher: source.publisher, count: 0, ok: false, items: [] }));
    }
  }
  // Isolate provider failures so one unavailable feed cannot hide the rest.
  return Promise.all(SOURCE_REGISTRY.map(async source => {
    try {
      const items = await fetchAndParseRegisteredSource(source);
      return { sourceId: source.sourceId, publisher: source.publisher, count: items.length, ok: true, items };
    } catch {
      return { sourceId: source.sourceId, publisher: source.publisher, count: 0, ok: false, items: [] };
    }
  }));
}
function dateLabel(raw: string | null, lang: SiteLang): string {
  if (!raw) return messages[lang].unknown;
  const time = Date.parse(raw);
  if (!Number.isFinite(time)) return messages[lang].unknown;
  return new Date(time).toLocaleString(lang === "pt" ? "pt-PT" : lang === "fr" ? "fr-FR" : "en-GB", {
    year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  }) + " UTC";
}
export default async function NewsPage({
  searchParams,
}: { searchParams?: Promise<{ lang?: string; source?: string }> | { lang?: string; source?: string } }) {
  const session = await auth();
  if (!session.userId || !session.sessionId) redirect("/sign-in?redirect_url=%2Fnews");
  const params = await searchParams;
  const lang = await resolveRequestSiteLang(params);
  const tx = messages[lang];
  const manualEnabled = manualNewsRefreshAllowed(session.userId);
  const streams = await getStreams();
  const selected = SOURCE_REGISTRY.some(x => x.sourceId === params?.source) ? params?.source : "all";
  const publications = streams
    .flatMap(stream => stream.items.map(item => ({ item, publisher: stream.publisher, sourceId: stream.sourceId })))
    .filter(record => selected === "all" || record.sourceId === selected)
    .sort((a, b) => {
      const left = a.item.publishedAt ? Date.parse(a.item.publishedAt) : -1;
      const right = b.item.publishedAt ? Date.parse(b.item.publishedAt) : -1;
      return right - left || a.item.publicationId.localeCompare(b.item.publicationId);
    }).slice(0, 60);
  const online = streams.filter(stream => stream.ok).length;
  const checkedAt = new Date().toISOString();
  return <WorkspaceShell lang={lang} area="news">
    <section className="overflow-hidden rounded-[26px] border border-[#30485e] bg-gradient-to-br from-[#132c39] via-[#132b3b] to-[#171d32] px-6 py-9 sm:px-9">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#a0d8cf]">{tx.eyebrow}</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">{tx.heading}</h1>
          <p className="mt-4 text-sm leading-7 text-[#b5c8d8]">{tx.intro}</p>
        </div>
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#7ec7ba]/20 bg-[#213d4b]/80 text-[#a0e5d2]">
          <Globe2 size={30} aria-hidden="true" />
        </div>
      </div>
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {[
          { label: SITE_N5_MODE ? tx.stored : tx.sources, value: String(online) + " / " + String(SOURCE_REGISTRY.length) },
          { label: tx.items, value: String(streams.reduce((sum, x) => sum + x.count, 0)) },
          { label: tx.checked, value: dateLabel(checkedAt, lang) },
        ].map(metric => <div key={metric.label} className="rounded-xl border border-white/10 bg-[#071623]/50 p-4">
          <p className="text-xs text-[#9eafc1]">{metric.label}</p>
          <p className="mt-2 text-lg font-semibold text-white">{metric.value}</p>
        </div>)}
      </div>
    </section>

    <div className="mt-6 flex items-start gap-3 rounded-2xl border border-[#826d48]/40 bg-[#3a2f20]/40 p-4 text-[#dfcaab]">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p className="text-sm leading-6">{manualEnabled ? tx.manual : SITE_N5_MODE ? tx.durable : tx.warning}</p>
    </div>

    <section className="mt-8" aria-label={tx.sources}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-white">{tx.sources}</h2>
        {manualEnabled ? <ManualNewsRefresh lang={lang} label={tx.reload} /> :
          <Link href={withLangQuery("/news", lang)} className="inline-flex items-center gap-2 rounded-full border border-[#364c63] px-4 py-2 text-sm text-[#c2d7e0] hover:bg-[#243750]">
            <RefreshCw size={15} aria-hidden="true"/>{SITE_N5_MODE ? tx.readHistory : tx.reload}
          </Link>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {streams.map(source => <div key={source.sourceId} className="rounded-2xl border border-[#2b3a53] bg-[#121d31] p-5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-[#eaf0f7]">{source.publisher}</h3>
            <span className={"inline-flex rounded-full border px-2 py-0.5 text-xs " +
              (source.ok ? "border-[#2b665a] bg-[#16443e] text-[#9ce2c4]" : "border-[#76564e] bg-[#3d292d] text-[#f1bbb0]")}>
              {source.ok ? (SITE_N5_MODE ? tx.stored : tx.available) : tx.unavailable}
            </span>
          </div>
          <p className="mt-3 text-sm text-[#a3b2c5]">{source.ok ? source.count + " " + tx.items.toLowerCase() : tx.down}</p>
        </div>)}
      </div>
    </section>

    <section className="mt-10" aria-label={tx.items}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-white">{tx.items}</h2>
        <div className="flex flex-wrap items-center gap-2" aria-label={tx.filter}>
          <Link href={withLangQuery("/news",lang)} className={"rounded-full border px-3 py-1.5 text-xs " +
            (selected === "all" ? "border-[#bda16c] bg-[#3c352d] text-[#f5dfb4]" : "border-[#2d4058] text-[#aab9cd] hover:text-white")}>{tx.all}</Link>
          {streams.map(source => <Link key={source.sourceId} href={withLangQuery("/news?source=" + encodeURIComponent(source.sourceId), lang)}
            className={"rounded-full border px-3 py-1.5 text-xs " +
              (selected === source.sourceId ? "border-[#bda16c] bg-[#3c352d] text-[#f5dfb4]" : "border-[#2d4058] text-[#aab9cd] hover:text-white")}>
            {source.publisher}
          </Link>)}
        </div>
      </div>
      {publications.length ? <div className="grid gap-3 md:grid-cols-2">
        {publications.map(({item,publisher}) => <article key={item.publicationId}
          className="rounded-2xl border border-[#2e4055] bg-[#111e32] p-5 transition-colors hover:border-[#527281]">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#91c2c2]">
            <Newspaper size={14} aria-hidden="true" />
            <span>{publisher}</span>
            <span aria-hidden="true">·</span>
            <Clock3 size={13} aria-hidden="true"/>
            <span>{dateLabel(item.publishedAt,lang)}</span>
          </div>
          <h3 className="mt-3 text-base font-semibold leading-7 text-[#f4f7fc]">{item.title}</h3>
          <a href={item.originalUrl} target="_blank" rel="noopener noreferrer nofollow"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-[#a9e0db] hover:text-white">
            {tx.original}<ArrowUpRight size={16} aria-hidden="true" />
          </a>
        </article>)}
      </div> : <div className="rounded-2xl border border-[#314154] bg-[#121e30] p-8 text-[#aab8ca]">{tx.empty}</div>}
    </section>
    <p className="mt-9 flex items-start gap-2 border-t border-[#273a4d] pt-6 text-xs leading-6 text-[#95a6b9]">
      <ShieldCheck size={17} className="mt-0.5 shrink-0 text-[#93c8be]" aria-hidden="true"/>
      {tx.rights}
    </p>
  </WorkspaceShell>;
}
