"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { requestManualNewsRefresh } from "./actions";
import type { ManualNewsRefreshResult } from "@/news-core/siteNewsManualRefresh";

type Props = { lang: "pt" | "en" | "fr"; label: string };
const messages = {
  pt: { running: "A consultar fontes…", completed: "Atualização concluída", partial: "Atualização parcial", unavailable: "Atualização indisponível", collected: "fontes consultadas", skipped: "a aguardar intervalo ou em execução", failed: "com erro ou tempo excedido", inserted: "novas publicações guardadas" },
  en: { running: "Checking sources…", completed: "Refresh completed", partial: "Partial refresh", unavailable: "Refresh unavailable", collected: "sources checked", skipped: "not due or busy", failed: "failed or timed out", inserted: "new publications stored" },
  fr: { running: "Consultation des sources…", completed: "Actualisation terminée", partial: "Actualisation partielle", unavailable: "Actualisation indisponible", collected: "sources consultées", skipped: "en attente ou en cours", failed: "en erreur ou délai dépassé", inserted: "nouvelles publications enregistrées" },
} as const;

export function ManualNewsRefresh({ lang, label }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ManualNewsRefreshResult | null>(null);
  const tx = messages[lang];
  function refresh() {
    startTransition(async () => {
      try { setResult(await requestManualNewsRefresh()); }
      catch { setResult({ status: "UNAVAILABLE", sources: [] }); }
      router.refresh();
    });
  }
  return <div className="flex flex-col items-end gap-2">
    <button type="button" onClick={refresh} disabled={pending}
      className="inline-flex items-center gap-2 rounded-full border border-[#364c63] px-4 py-2 text-sm text-[#c2d7e0] hover:bg-[#243750] disabled:opacity-50">
      <RefreshCw size={15} aria-hidden="true" className={pending ? "animate-spin" : ""}/>{pending ? tx.running : label}
    </button>
    {result && <p className="max-w-md text-right text-xs leading-5 text-[#a3b2c5]" role="status">
      {result.status === "UNAVAILABLE" ? tx.unavailable :
        (result.status === "PARTIAL" ? tx.partial : tx.completed) + ": " +
        result.sources.filter(row => row.status === "COLLECTED").length + " " + tx.collected + "; " +
        result.sources.filter(row => row.status === "NOT_DUE_OR_BUSY").length + " " + tx.skipped + "; " +
        result.sources.filter(row => row.status === "ERROR" || row.status === "DEADLINE").length + " " + tx.failed + "; " +
        result.sources.reduce((sum, row) => sum + row.inserted, 0) + " " + tx.inserted + "."}
    </p>}
  </div>;
}
