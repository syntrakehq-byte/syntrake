"use client";

import { useAuth } from "@clerk/nextjs";
import { ArrowLeft, ArrowUpRight, RefreshCw, ShieldCheck, WalletCards } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { SiteLang } from "@/lib/i18n/siteLanguage";
import {
  classifyAccountDiscoveryResponse,
  type AccountDiscoveryView,
} from "@/investing-core/ui/accountDiscoveryViewModel";

const messages = {
  en: {
    eyebrow: "INVESTING · ACCOUNT ACCESS", title: "Your investment accounts",
    subtitle: "A secure read-only view of accounts you are authorized to access.",
    readOnlyBadge: "READ ONLY", source: "Verified session · Supabase RLS",
    reload: "Refresh accounts", loading: "Checking authorized accounts…",
    count: "Visible accounts", currency: "Base currency", accountId: "Account identifier",
    emptyTitle: "No accounts available", empty: "We cannot confirm any accounts under this session. This does not mean your balance is zero.",
    deniedTitle: "Access denied", denied: "This session cannot read investment accounts. No financial information was returned.",
    unavailableTitle: "Account data unavailable", unavailable: "We cannot verify account data right now. No estimate or empty balance has been substituted.",
    disabledTitle: "Account access not active", disabled: "This view is not enabled in the current environment.",
    loginTitle: "Sign in required", login: "Sign in to access your own investment accounts.",
    signIn: "Sign in", back: "Back to Syntrake",
    noteTitle: "Account identity only", note: "Balances, positions, deposits, returns and broker reconciliation are not included. Nothing shown here is evidence of verified cash or investment performance.",
  },
  pt: {
    eyebrow: "INVESTING · ACESSO ÀS CONTAS", title: "As tuas contas de investimento",
    subtitle: "Consulta segura, apenas de leitura, das contas a que tens acesso autorizado.",
    readOnlyBadge: "APENAS LEITURA", source: "Sessão verificada · Supabase RLS",
    reload: "Atualizar contas", loading: "A verificar contas autorizadas…",
    count: "Contas visíveis", currency: "Moeda base", accountId: "Identificador da conta",
    emptyTitle: "Nenhuma conta disponível", empty: "Não conseguimos confirmar contas nesta sessão. Isto não significa que o teu saldo seja zero.",
    deniedTitle: "Acesso recusado", denied: "Esta sessão não tem autorização para consultar as contas. Não foram devolvidos dados financeiros.",
    unavailableTitle: "Dados indisponíveis", unavailable: "Não é possível verificar as contas neste momento. Não foram inventados saldos nem valores.",
    disabledTitle: "Consulta desativada", disabled: "Esta funcionalidade não está ativa neste ambiente.",
    loginTitle: "Inicia sessão", login: "Inicia sessão para consultar exclusivamente as tuas contas.",
    signIn: "Entrar", back: "Voltar ao Syntrake",
    noteTitle: "Apenas identificação de contas", note: "Saldos, posições, depósitos, retornos e reconciliação com brokers não estão incluídos. Estes dados não comprovam capital nem rentabilidade.",
  },
  fr: {
    eyebrow: "INVESTING · ACCÈS AUX COMPTES", title: "Vos comptes d'investissement",
    subtitle: "Vue sécurisée, en lecture seule, des comptes auxquels vous avez accès.",
    readOnlyBadge: "LECTURE SEULE", source: "Session vérifiée · Supabase RLS",
    reload: "Actualiser les comptes", loading: "Vérification des comptes autorisés…",
    count: "Comptes visibles", currency: "Devise de base", accountId: "Identifiant du compte",
    emptyTitle: "Aucun compte disponible", empty: "Aucun compte n'a pu être confirmé pour cette session. Cela ne signifie pas que le solde est nul.",
    deniedTitle: "Accès refusé", denied: "Cette session ne peut pas consulter les comptes d'investissement. Aucune donnée financière n'a été renvoyée.",
    unavailableTitle: "Données indisponibles", unavailable: "Impossible de vérifier les comptes pour le moment. Aucun solde estimé ou fictif n'est affiché.",
    disabledTitle: "Accès non activé", disabled: "Cette fonction n'est pas activée dans cet environnement.",
    loginTitle: "Connexion requise", login: "Connectez-vous pour consulter uniquement vos comptes.",
    signIn: "Se connecter", back: "Retour à Syntrake",
    noteTitle: "Identité des comptes uniquement", note: "Les soldes, positions, dépôts, rendements et rapprochements avec des courtiers sont exclus. Ces informations ne prouvent ni capital ni performance.",
  },
} satisfies Record<SiteLang, Record<string, string>>;

type BoundResult = Readonly<{ actorId: string; data: AccountDiscoveryView }>;

export default function AccountDiscoveryClient({ lang }: { lang: SiteLang }) {
  const copy = messages[lang];
  const { isLoaded, userId } = useAuth();
  const [result, setResult] = useState<BoundResult | null>(null);
  const [revision, setRevision] = useState(0);
  const actorId = isLoaded && userId ? userId : null;

  useEffect(() => {
    if (!actorId) return;
    let active = true;
    const controller = new AbortController();

    async function read() {
      let state: AccountDiscoveryView;
      try {
        const response = await fetch("/api/investing/accounts", {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const untrusted: unknown = await response.json().catch(() => null);
        state = classifyAccountDiscoveryResponse(response.status, untrusted);
      } catch {
        if (!active) return;
        state = { kind: "UNAVAILABLE" };
      }
      if (active && actorId) setResult({ actorId, data: state });
    }
    void read();
    return () => {
      active = false;
      controller.abort();
    };
  }, [actorId, revision]);

  function refresh() {
    setResult(null);
    setRevision((value) => value + 1);
  }

  // Never render an account list fetched for a different Clerk user, even for
  // one React frame when a session switches without a full navigation.
  const current = actorId && result?.actorId === actorId ? result.data : null;
  const status = !isLoaded ? "LOADING" : !actorId ? "UNAUTHENTICATED" : current?.kind ?? "LOADING";

  const notices: Record<string, { title: string; body: string }> = {
    EMPTY_OR_UNPROVISIONED: { title: copy.emptyTitle, body: copy.empty },
    BLOCKED: { title: copy.deniedTitle, body: copy.denied },
    UNAVAILABLE: { title: copy.unavailableTitle, body: copy.unavailable },
    NOT_ENABLED: { title: copy.disabledTitle, body: copy.disabled },
    UNAUTHENTICATED: { title: copy.loginTitle, body: copy.login },
  };
  const notice = notices[status];

  return (
    <main className="min-h-screen bg-transparent text-slate-100">
      <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-16">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white">
            <ArrowLeft size={16} aria-hidden="true" />{copy.back}
          </Link>
          <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-xs font-semibold tracking-wider text-amber-200">{copy.readOnlyBadge}</span>
        </header>
        <section aria-labelledby="accounts-title" className="mt-12">
          <p className="text-xs font-semibold tracking-[0.23em] text-sky-300">{copy.eyebrow}</p>
          <div className="mt-4 flex flex-wrap items-start justify-between gap-5">
            <div>
              <h1 id="accounts-title" className="text-3xl font-semibold tracking-tight sm:text-5xl">{copy.title}</h1>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-300">{copy.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={refresh}
              disabled={!actorId || status === "LOADING"}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-800/70 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            ><RefreshCw size={16} aria-hidden="true" />{copy.reload}</button>
          </div>
        </section>

        <section aria-label={copy.count} aria-live="polite" aria-busy={status === "LOADING"} className="mt-9">
          {status === "LOADING" ? (
            <div role="status" className="rounded-2xl border border-slate-700 bg-slate-900/70 p-8 text-slate-300">{copy.loading}</div>
          ) : current?.kind === "AVAILABLE" ? (
            <div>
              <div className="mb-5 flex items-center gap-3 text-sm text-emerald-200">
                <ShieldCheck size={18} aria-hidden="true" />{copy.source}
                <span className="ml-auto rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 font-semibold">{copy.count}: {current.accounts.length}</span>
              </div>
              <ul className="grid gap-4 sm:grid-cols-2">
                {current.accounts.map((account) => (
                  <li key={account.id} className="rounded-2xl border border-slate-600/70 bg-slate-900/75 p-6 shadow-lg shadow-black/10">
                    <div className="flex items-start justify-between gap-3">
                      <span className="rounded-xl bg-sky-400/10 p-3 text-sky-300"><WalletCards size={22} aria-hidden="true" /></span>
                      <span className="rounded-full border border-slate-600 px-3 py-1 text-sm font-semibold text-slate-200">{account.baseCurrency}</span>
                    </div>
                    <h2 className="mt-5 break-words text-xl font-semibold text-white">{account.name}</h2>
                    <dl className="mt-5 space-y-3 border-t border-slate-700 pt-4 text-sm">
                      <div className="flex justify-between gap-4"><dt className="text-slate-400">{copy.currency}</dt><dd className="font-medium text-white">{account.baseCurrency}</dd></div>
                      <div><dt className="mb-1 text-slate-400">{copy.accountId}</dt><dd className="break-all font-mono text-xs text-slate-200">{account.id}</dd></div>
                    </dl>
                  </li>
                ))}
              </ul>
            </div>
          ) : notice ? (
            <div role="status" className="rounded-2xl border border-slate-700 bg-slate-900/70 p-8">
              <ShieldCheck size={24} aria-hidden="true" className="mb-4 text-slate-400" />
              <h2 className="text-xl font-semibold">{notice.title}</h2>
              <p className="mt-3 max-w-xl leading-relaxed text-slate-300">{notice.body}</p>
              {status === "UNAUTHENTICATED" ? <Link className="mt-5 inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold hover:bg-sky-500" href="/sign-in?redirect_url=%2Finvesting%2Faccounts">{copy.signIn}<ArrowUpRight size={16} aria-hidden="true" /></Link> : null}
            </div>
          ) : (
            <div role="status" className="rounded-2xl border border-slate-700 bg-slate-900/70 p-8">{copy.unavailable}</div>
          )}
        </section>
        <aside className="mt-8 rounded-2xl border border-sky-400/20 bg-sky-400/5 p-6">
          <p className="flex items-center gap-2 text-sm font-semibold text-sky-200"><ShieldCheck size={18} aria-hidden="true" />{copy.noteTitle}</p>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">{copy.note}</p>
        </aside>
      </div>
    </main>
  );
}
