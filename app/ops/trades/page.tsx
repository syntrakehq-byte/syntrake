import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";

import { isOwnerUserId } from "@/lib/signalcore/owner";
import {
  parseTradeLedgerFilters,
  readTradeLedgerPage,
  type TradeLedgerFilters,
  type TradeLedgerRow,
} from "@/lib/ops/tradeLedger";

export const metadata: Metadata = {
  title: "Trade Ledger | Syntrake Ops",
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fmtNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "n/a";
  return `${Math.round(value * 100) / 100}`;
}

function fmtMoney(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "n/a";
  return `${Math.round(value * 100) / 100}`;
}

function fmtDate(value: string | null | undefined) {
  if (!value) return "n/a";
  return new Date(value).toLocaleString("en-GB", { timeZone: "UTC" });
}

function fmtDuration(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms)) return "n/a";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
}

function tone(status: string | null | undefined) {
  const normalized = String(status || "").toLowerCase();
  if (["won", "accepted", "settled"].includes(normalized)) return "border-emerald-300/40 bg-emerald-400/10 text-emerald-100";
  if (["unavailable_retryable", "open"].includes(normalized)) return "border-amber-300/40 bg-amber-400/10 text-amber-100";
  if (["rejected", "lost", "unavailable", "failed"].includes(normalized)) return "border-red-400/40 bg-red-500/10 text-red-100";
  return "border-slate-600/50 bg-slate-900/70 text-slate-200";
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
      <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-2 text-lg font-bold text-white">{value}</div>
    </div>
  );
}

function queryString(filters: TradeLedgerFilters, overrides: Partial<Record<keyof TradeLedgerFilters, string | number | null>>) {
  const params = new URLSearchParams();
  const current: Record<string, string> = {
    preset: filters.preset,
    dateType: filters.dateType,
    from: filters.from || "",
    to: filters.to || "",
    instrument: filters.instrument,
    setupType: filters.setupType,
    marketSource: filters.marketSource,
    triggerSource: filters.triggerSource,
    side: filters.side,
    status: filters.status,
    timeframe: filters.timeframe,
    reasonCode: filters.reasonCode,
    result: filters.result,
    query: filters.query,
    page: String(filters.page),
    pageSize: String(filters.pageSize),
    userId: filters.userId,
  };
  for (const [key, value] of Object.entries({ ...current, ...overrides })) {
    if (value == null || value === "") continue;
    params.set(key, String(value));
  }
  return params.toString();
}

function FilterInput({
  name,
  defaultValue,
  placeholder,
}: {
  name: string;
  defaultValue: string;
  placeholder: string;
}) {
  return (
    <input
      type="text"
      name={name}
      defaultValue={defaultValue}
      placeholder={placeholder}
      className="rounded-xl border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500"
    />
  );
}

function TradeRow({ row, filters }: { row: TradeLedgerRow; filters: TradeLedgerFilters }) {
  return (
    <tr className="border-t border-white/5 align-top">
      <td className="px-4 py-3 text-sm text-slate-300">{fmtDate(row.decisionAt)}</td>
      <td className="px-4 py-3">
        <a href={`/ops/trades/${row.id}?${queryString(filters, {})}`} className="font-black text-white hover:text-cyan-200">
          {row.instrument}
        </a>
      </td>
      <td className="px-4 py-3 text-sm uppercase text-slate-200">{row.side || "n/a"}</td>
      <td className="px-4 py-3">
        <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.14em] ${tone(row.displayStatus)}`}>
          {row.displayStatus}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-slate-300">{row.marketSource || "n/a"}</td>
      <td className="px-4 py-3 text-sm text-slate-200">{row.pnlAmount != null ? fmtMoney(row.pnlAmount) : "n/a"}</td>
      <td className="px-4 py-3 text-sm text-slate-200">{row.resultR != null ? `${fmtNumber(row.resultR)}R` : "n/a"}</td>
      <td className="px-4 py-3 text-sm text-slate-300">{fmtDuration(row.holdingMs)}</td>
      <td className="px-4 py-3 text-sm text-slate-300">{row.triggerSource || "n/a"}</td>
      <td className="px-4 py-3 text-sm text-slate-300">{row.setupType || row.strategyId || "n/a"}</td>
      <td className="px-4 py-3 text-sm text-slate-300">{row.timeframe || "n/a"}</td>
    </tr>
  );
}

export default async function TradeLedgerPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await auth();
  if (!userId || !isOwnerUserId(userId)) {
    return (
      <main className="min-h-screen bg-[#07111f] px-6 py-16 text-white">
        <div className="mx-auto max-w-2xl rounded-[28px] border border-white/10 bg-white/[0.04] p-8">
          <p className="text-sm font-bold uppercase tracking-[0.3em] text-slate-500">Trade Ledger</p>
          <h1 className="mt-3 text-3xl font-bold">Owner access required</h1>
        </div>
      </main>
    );
  }

  const params = parseTradeLedgerFilters((await searchParams) || {});
  const ledger = await readTradeLedgerPage(params);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#123654_0,#07111f_36%,#030712_100%)] px-5 py-8 text-white md:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-[32px] border border-white/10 bg-slate-950/50 p-7 shadow-2xl shadow-black/30">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.34em] text-cyan-200/70">Syntrake Ops</p>
              <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">Trade Ledger</h1>
              <p className="mt-3 max-w-3xl text-slate-300">
                Canonical read-only audit surface for Syntrake trades. It reconstructs paper trade lifecycle from the
                canonical storage already in production and does not recalculate scientific decisions.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a
                href="/ops"
                className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-bold text-white hover:bg-white/[0.08]"
              >
                Back to Ops
              </a>
              <span className="rounded-full border border-cyan-200/30 bg-cyan-300/10 px-4 py-2 text-sm font-bold text-cyan-100">
                {ledger.total} matched trades
              </span>
            </div>
          </div>
        </header>

        <section className="mt-6 rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
          <form method="GET" className="grid gap-3 lg:grid-cols-6">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Period</label>
              <select name="preset" defaultValue={ledger.filters.preset} className="rounded-xl border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-white">
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="last_7d">Last 7 days</option>
                <option value="last_30d">Last 30 days</option>
                <option value="this_month">This month</option>
                <option value="last_month">Last month</option>
                <option value="this_year">This year</option>
                <option value="all">All</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Date type</label>
              <select name="dateType" defaultValue={ledger.filters.dateType} className="rounded-xl border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-white">
                <option value="decision">Decision</option>
                <option value="accepted">Accepted</option>
                <option value="execution">Execution</option>
                <option value="settlement">Settlement</option>
                <option value="close">Close</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">From</label>
              <input type="date" name="from" defaultValue={ledger.filters.from || ""} className="rounded-xl border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-white" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">To</label>
              <input type="date" name="to" defaultValue={ledger.filters.to || ""} className="rounded-xl border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-white" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Result</label>
              <select name="result" defaultValue={ledger.filters.result} className="rounded-xl border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-white">
                <option value="all">All</option>
                <option value="positive">PnL positive</option>
                <option value="negative">PnL negative</option>
                <option value="retryable">Retryables</option>
                <option value="settled">Settled</option>
                <option value="accepted">Accepted</option>
                <option value="failed">Failed</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Page size</label>
              <select name="pageSize" defaultValue={String(ledger.filters.pageSize)} className="rounded-xl border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-white">
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="200">200</option>
              </select>
            </div>

            <FilterInput name="instrument" defaultValue={ledger.filters.instrument} placeholder="Symbol" />
            <FilterInput name="setupType" defaultValue={ledger.filters.setupType} placeholder="Strategy / setup" />
            <FilterInput name="marketSource" defaultValue={ledger.filters.marketSource} placeholder="Provider / source" />
            <FilterInput name="triggerSource" defaultValue={ledger.filters.triggerSource} placeholder="Trigger source" />
            <FilterInput name="timeframe" defaultValue={ledger.filters.timeframe} placeholder="Timeframe" />
            <FilterInput name="reasonCode" defaultValue={ledger.filters.reasonCode} placeholder="Reason code" />

            <div className="flex flex-col gap-2">
              <select name="side" defaultValue={ledger.filters.side} className="rounded-xl border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-white">
                <option value="">BUY / SELL</option>
                <option value="buy">BUY</option>
                <option value="sell">SELL</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <select name="status" defaultValue={ledger.filters.status} className="rounded-xl border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-white">
                <option value="">Status</option>
                <option value="accepted">accepted</option>
                <option value="won">won</option>
                <option value="lost">lost</option>
                <option value="open">open</option>
                <option value="unavailable_retryable">unavailable_retryable</option>
                <option value="unavailable">unavailable</option>
                <option value="rejected">rejected</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <select name="userId" defaultValue={ledger.filters.userId} className="rounded-xl border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-white">
                <option value="">All owner users</option>
                {ledger.availableUsers.map((owner) => (
                  <option key={owner} value={owner}>{owner}</option>
                ))}
              </select>
            </div>
            <div className="lg:col-span-3">
              <input
                type="text"
                name="query"
                defaultValue={ledger.filters.query}
                placeholder="Trade ID, signal ID, journal ID, idempotency key, correlation ID, trace ID"
                className="w-full rounded-xl border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500"
              />
            </div>
            <input type="hidden" name="page" value="1" />
            <div className="flex gap-3">
              <button type="submit" className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-black text-slate-950">
                Apply filters
              </button>
              <Link href="/ops/trades" className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-white">
                Reset
              </Link>
            </div>
          </form>
        </section>

        <section className="mt-6 grid gap-3 md:grid-cols-4 xl:grid-cols-6">
          <Metric label="Total trades" value={ledger.summary.total} />
          <Metric label="BUY" value={ledger.summary.buy} />
          <Metric label="SELL" value={ledger.summary.sell} />
          <Metric label="Win rate" value={ledger.summary.winRate != null ? `${fmtNumber(ledger.summary.winRate)}%` : "n/a"} />
          <Metric label="Loss rate" value={ledger.summary.lossRate != null ? `${fmtNumber(ledger.summary.lossRate)}%` : "n/a"} />
          <Metric label="Providers used" value={ledger.summary.providerCount} />
          <Metric label="PnL total" value={fmtMoney(ledger.summary.pnlTotal)} />
          <Metric label="PnL avg" value={fmtMoney(ledger.summary.pnlAverage)} />
          <Metric label="Net R" value={`${fmtNumber(ledger.summary.netR)}R`} />
          <Metric label="Avg R" value={ledger.summary.averageR != null ? `${fmtNumber(ledger.summary.averageR)}R` : "n/a"} />
          <Metric label="Biggest gain" value={fmtMoney(ledger.summary.biggestGain)} />
          <Metric label="Biggest loss" value={fmtMoney(ledger.summary.biggestLoss)} />
          <Metric label="Accepted" value={ledger.summary.accepted} />
          <Metric label="Settled" value={ledger.summary.settled} />
          <Metric label="Retryables" value={ledger.summary.retryable} />
          <Metric label="Failed" value={ledger.summary.failed} />
          <Metric label="Rejected" value={ledger.summary.rejected} />
          <Metric label="Avg holding" value={fmtDuration(ledger.summary.averageHoldingMs)} />
          <Metric label="Avg settlement" value={fmtDuration(ledger.summary.averageSettlementMs)} />
          <Metric label="Avg to accepted" value={fmtDuration(ledger.summary.averageAcceptedMs)} />
          <Metric label="Avg execution" value={fmtDuration(ledger.summary.averageExecutionMs)} />
        </section>

        <section className="mt-6 rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/35">
            <table className="min-w-full text-left text-sm text-slate-200">
              <thead className="bg-white/5 text-xs uppercase tracking-[0.18em] text-slate-400">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Symbol</th>
                  <th className="px-4 py-3">Side</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">PnL</th>
                  <th className="px-4 py-3">Return</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Trigger</th>
                  <th className="px-4 py-3">Strategy</th>
                  <th className="px-4 py-3">TF</th>
                </tr>
              </thead>
              <tbody>
                {ledger.rows.length > 0 ? ledger.rows.map((row) => (
                  <TradeRow key={row.id} row={row} filters={ledger.filters} />
                )) : (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-slate-400">
                      No trades matched the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-slate-400">
              Generated {fmtDate(ledger.generatedAt)} UTC. Page {ledger.page} of {ledger.pageCount}.
            </p>
            <div className="flex gap-3">
              {ledger.page > 1 ? (
                <a href={`/ops/trades?${queryString(ledger.filters, { page: ledger.page - 1 })}`} className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-white">
                  Previous
                </a>
              ) : null}
              {ledger.page < ledger.pageCount ? (
                <a href={`/ops/trades?${queryString(ledger.filters, { page: ledger.page + 1 })}`} className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-white">
                  Next
                </a>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
