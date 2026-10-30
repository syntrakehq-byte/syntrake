import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { resolveRequestSiteLang } from "@/lib/i18n/requestSiteLang";
import { isR2COperationalReady } from "@/investing-core/server/onboardingTransport";
import { inspectOwnExistingInvestingAccounts } from "@/investing-core/server/existingAccountReview";
import { isR2DImportReady } from "@/investing-core/server/importPreviewRuntime";
import { isOnboardingPortfolioReady } from "@/investing-core/server/onboardingPortfolioFromClerk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Investing — Existing accounts | Syntrake",
  robots: { index: false, follow: false, noarchive: true },
};

const copy = {
  pt: {
    title: "Contas Investing existentes",
    intro: "Consulta estrutural autenticada. Este passo não cria contas, portfolios, movimentos financeiros nem recomendações.",
    none: "Não foi encontrada uma conta Investing nesta consulta. Isto não comprova um saldo de zero.",
    one: "Conta Investing identificada",
    many: "Foram encontradas várias contas Investing. Nenhuma foi escolhida automaticamente.",
    portfolios: "Portfolios associados observados",
    noPortfolios: "Nenhum portfolio associado foi observado nesta consulta.",
    uncertain: "Dados financeiros e reconciliação ainda não verificados.",
    unavailable: "Não foi possível confirmar o estado das contas. Não foi assumida qualquer situação financeira.",
    return: "Voltar ao Investing",
    account: "Conta",
    import: "Importar posições/cash declarados (não verificados)",
  },
  en: {
    title: "Existing Investing accounts",
    intro: "Authenticated structural read only. No accounts, portfolios, money movements or recommendations are created.",
    none: "No Investing account was observed in this read. This does not prove a zero balance.",
    one: "Investing account observed",
    many: "Multiple Investing accounts were observed. None was chosen automatically.",
    portfolios: "Associated portfolios observed",
    noPortfolios: "No associated portfolio was observed in this read.",
    uncertain: "Financial values and reconciliation remain unverified.",
    unavailable: "Account status could not be confirmed. No financial state was assumed.",
    return: "Back to Investing",
    account: "Account",
    import: "Import declared positions/cash (unverified)",
  },
  fr: {
    title: "Comptes Investing existants",
    intro: "Lecture structurelle authentifiée. Aucun compte, portefeuille, mouvement financier ou conseil n'est créé.",
    none: "Aucun compte Investing n'a été observé dans cette lecture. Cela ne prouve pas un solde nul.",
    one: "Compte Investing observé",
    many: "Plusieurs comptes Investing observés. Aucun n'a été sélectionné automatiquement.",
    portfolios: "Portefeuilles associés observés",
    noPortfolios: "Aucun portefeuille associé observé dans cette lecture.",
    uncertain: "Les valeurs financières et le rapprochement restent non vérifiés.",
    unavailable: "Impossible de confirmer l'état des comptes. Aucun état financier n'a été supposé.",
    return: "Retour à Investing",
    account: "Compte",
    import: "Importer positions/liquidités déclarées (non vérifiées)",
  },
} as const;

export default async function ExistingInvestingAccountsPage({
  searchParams,
}: { searchParams?: Promise<{ lang?: string }> | { lang?: string } }) {
  if (!isR2COperationalReady(process.env)) notFound();
  const session = await auth();
  if (!session.userId || !session.sessionId) {
    redirect("/sign-in?redirect_url=%2Finvesting%2Fexisting");
  }
  const lang = await resolveRequestSiteLang(await searchParams);
  const t = copy[lang];
  let failed = false;
  let existing: Awaited<ReturnType<typeof inspectOwnExistingInvestingAccounts>> = null;
  try {
    existing = await inspectOwnExistingInvestingAccounts(process.env, {
      userId: session.userId,
      sessionId: session.sessionId,
      getToken: () => session.getToken(),
    });
  } catch {
    failed = true;
  }
  return (
    <main className="mx-auto max-w-3xl px-5 py-12 text-slate-100">
      <h1 className="text-3xl font-semibold">{t.title}</h1>
      <p className="mt-3 text-sm text-slate-300">{t.intro}</p>
      <section className="mt-7 rounded-xl border border-slate-700 bg-slate-900 p-6">
        {failed ? <p role="alert" className="text-amber-200">{t.unavailable}</p>
        : !existing ? <p>{t.none}</p>
        : existing.accountMultiplicity === "MULTIPLE" ?
          <p role="status" className="text-amber-200">{t.many}</p>
        : (
          <>
            <p className="font-semibold">{t.one}</p>
            <p className="mt-2 break-all text-sm">{t.account}: {existing.accountId}</p>
            <h2 className="mt-5 font-semibold">{t.portfolios}</h2>
            {existing.portfolioIds.length === 0 ? <p className="mt-2">{t.noPortfolios}</p>
              : existing.portfolioIds.map(id =>
                  <p className="mt-2 break-all text-sm" key={id}>{id}</p>)}
          </>
        )}
        {existing && <p className="mt-5 text-sm text-amber-200">{t.uncertain}</p>}
      </section>
      {!failed && existing?.accountMultiplicity === "ONE" && existing.portfolioIds.length>0 && isOnboardingPortfolioReady(process.env) &&
       <Link className="mt-7 mr-7 inline-block text-cyan-300 underline" href="/investing/profile">
         {lang==="fr"?"Déclarer ou corriger mon profil Investing":lang==="en"?"Declare or correct my Investing profile":"Declarar ou corrigir o meu perfil Investing"}
       </Link>}
      {!failed && existing?.accountMultiplicity === "ONE" && existing.portfolioIds.length>0 && isR2DImportReady(process.env) &&
       <Link className="mt-7 mr-7 inline-block text-emerald-300 underline" href="/investing/import">{t.import}</Link>}
      <Link className="mt-7 inline-block text-sky-300 underline" href="/investing/start">
        {t.return}
      </Link>
    </main>
  );
}
