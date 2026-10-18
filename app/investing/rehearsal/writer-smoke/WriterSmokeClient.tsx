"use client";

import { useState } from "react";

const targets = [
  { label: "A", accountId: "f886c954-0a0f-419c-890a-b77ecb0c36cf" },
  { label: "C", accountId: "676ae244-9ead-449c-861d-2f34a81285e3" },
] as const;

export default function WriterSmokeClient() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string>("Ainda não executado.");

  async function run(accountId: string, label: "A" | "C") {
    if (running) return;
    setRunning(true);
    setResult("A executar o teste " + label + " ...");
    try {
      const response = await fetch("/api/investing/rehearsal/contribution-smoke", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      const output: unknown = await response.json();
      setResult(JSON.stringify({ status: response.status, result: output }, null, 2));
    } catch {
      setResult("Não foi possível contactar o writer de ensaio.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="text-2xl font-semibold">Investing — Writer R0-A (ensaio)</h1>
      <p className="mt-3">
        Exclusivamente Preview. Cada botão tenta registar uma única declaração
        sintética, idempotente, de 1 cêntimo EUR como USER_REPORTED.
        Não é dinheiro real nem uma transferência confirmada por broker.
      </p>
      <p className="mt-3">
        Usa a sessão Clerk A para testar A, e Clerk C para testar C. O botão
        da outra conta deve devolver 403 sem qualquer escrita.
        Repetir o próprio teste deve devolver a mesma transação.
      </p>
      <div className="mt-6 flex gap-3">
        {targets.map(({ label, accountId }) => (
          <button key={label} type="button" disabled={running}
            onClick={() => run(accountId, label)}
            className="rounded-lg border px-5 py-3 font-semibold disabled:opacity-50">
            Executar teste {label}
          </button>
        ))}
      </div>
      <pre className="mt-6 whitespace-pre-wrap break-all rounded-lg border p-4 text-sm"
        aria-live="polite">{result}</pre>
      <p className="mt-4 text-sm">
        Se aparecer 404, o writer ainda está desativado; se aparecer 503,
        a sessão ou a base de ensaio pode não estar preparada.
      </p>
    </main>
  );
}
