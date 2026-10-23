import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { pickByLang, type Multilingual, type SiteLang } from "@/lib/i18n/siteLanguage";
import { resolveRequestSiteLang, withLangQuery } from "@/lib/i18n/requestSiteLang";
import { isR1AccountReadEnabled } from "@/investing-core/server/accountsReadHttp";

type PageSearchParams = Record<string, string | string[] | undefined>;

function t(
  lang: SiteLang,
  value: Multilingual
) {
  return pickByLang(lang, value);
}

export default async function StartPage({
  searchParams,
}: {
  searchParams?: Promise<PageSearchParams> | PageSearchParams;
}) {
  const params =
    searchParams && typeof (searchParams as Promise<PageSearchParams>).then === "function"
      ? await (searchParams as Promise<PageSearchParams>)
      : (searchParams as PageSearchParams | undefined);
  const { userId } = await auth();
  const lang = await resolveRequestSiteLang(params);
  const link = (href: string) => withLangQuery(href, lang);
  // R1 account access is advertised only when the exact same server-side
  // read-only gate as /investing/accounts and its API is enabled.
  const r1AccountsEnabled = isR1AccountReadEnabled(process.env);
  const setupTarget = r1AccountsEnabled ? link("/investing/accounts") : link("/start");
  const openSetupHref = userId
    ? setupTarget
    : link(`/sign-in?redirect_url=${encodeURIComponent(setupTarget)}`);

  return (
    <main className="min-h-screen bg-transparent text-ink-900">
      <section className="mx-auto max-w-3xl px-6 py-14">
        <p className="text-xs font-semibold text-ink-500">Syntrake - {t(lang, { en: "Start", pt: "Inicio", es: "Inicio", fr: "Debut", de: "Start", it: "Inizio" })}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
          {t(lang, {
            en: "A 5-minute setup for calmer investing decisions",
            pt: "Um setup de 5 minutos para decisoes de investimento mais calmas",
            es: "Un setup de 5 minutos para decisiones de inversion mas calmadas",
            fr: "Un setup de 5 minutes pour des decisions d investissement plus calmes",
            de: "Ein 5-Minuten-Setup fuer ruhigere Investment-Entscheidungen",
            it: "Un setup da 5 minuti per decisioni di investimento piu calme",
          })}
        </h1>
        <p className="mt-4 text-base text-ink-700">
          {t(lang, {
            en: "Start simple: set your goal, define your risk guardrails, and build a weekly routine.",
            pt: "Comeca simples: define o teu objetivo, os guardrails de risco e uma rotina semanal.",
            es: "Empieza simple: define tu objetivo, tus guardrails de riesgo y una rutina semanal.",
            fr: "Commencez simple : definissez votre objectif, vos guardrails de risque et une routine hebdomadaire.",
            de: "Starte einfach: definiere dein Ziel, deine Risiko-Guardrails und eine Wochenroutine.",
            it: "Inizia semplice: definisci il tuo obiettivo, i guardrail di rischio e una routine settimanale.",
          })}
        </p>

        <div className="mt-8 rounded-3xl border border-border-soft bg-white p-6 shadow-soft">
          <h2 className="text-lg font-semibold">{t(lang, { en: "Step 1: Pick your horizon", pt: "Passo 1: Escolhe o teu horizonte", es: "Paso 1: Elige tu horizonte", fr: "Etape 1 : Choisissez votre horizon", de: "Schritt 1: Waehle deinen Horizont", it: "Passo 1: Scegli il tuo orizzonte" })}</h2>
          <p className="mt-2 text-sm text-ink-700">{t(lang, { en: "Short-term, medium-term, or long-term. Your horizon defines how you react.", pt: "Curto prazo, medio prazo ou longo prazo. O teu horizonte define como reages.", es: "Corto plazo, medio plazo o largo plazo. Tu horizonte define como reaccionas.", fr: "Court terme, moyen terme ou long terme. Votre horizon definit votre reaction.", de: "Kurz-, mittel- oder langfristig. Dein Horizont bestimmt, wie du reagierst.", it: "Breve, medio o lungo termine. Il tuo orizzonte definisce come reagisci." })}</p>
        </div>

        <div className="mt-4 rounded-3xl border border-border-soft bg-white p-6 shadow-soft">
          <h2 className="text-lg font-semibold">{t(lang, { en: "Step 2: Add 3-5 holdings", pt: "Passo 2: Adiciona 3-5 holdings", es: "Paso 2: Anade 3-5 holdings", fr: "Etape 2 : Ajoutez 3-5 positions", de: "Schritt 2: 3-5 Positionen hinzufuegen", it: "Passo 2: Aggiungi 3-5 holdings" })}</h2>
          <p className="mt-2 text-sm text-ink-700">{t(lang, { en: "Keep it simple and focus on real decisions, not noise.", pt: "Mantem simples e foca-te em decisoes reais, nao em ruido.", es: "Mantenlo simple y enfocate en decisiones reales, no en ruido.", fr: "Restez simple et concentrez-vous sur les vraies decisions, pas le bruit.", de: "Halte es einfach und konzentriere dich auf echte Entscheidungen, nicht auf Laerm.", it: "Mantieni semplice e concentrati su decisioni reali, non sul rumore." })}</p>
        </div>

        <div className="mt-4 rounded-3xl border border-border-soft bg-canvas-50 p-6 shadow-card">
          <h2 className="text-lg font-semibold">{t(lang, { en: "Step 3: Run a weekly ritual", pt: "Passo 3: Faz um ritual semanal", es: "Paso 3: Haz un ritual semanal", fr: "Etape 3 : Faites un rituel hebdomadaire", de: "Schritt 3: Fuehre ein Wochenritual aus", it: "Passo 3: Esegui un rituale settimanale" })}</h2>
          <ol className="mt-3 space-y-2 text-sm text-ink-700">
            <li>1. {t(lang, { en: "Open Market Map", pt: "Abre o Market Map", es: "Abre Market Map", fr: "Ouvrez Market Map", de: "Market Map oeffnen", it: "Apri Market Map" })}</li>
            <li>2. {t(lang, { en: "Check regime and confidence", pt: "Verifica regime e confianca", es: "Revisa regimen y confianza", fr: "Verifiez regime et confiance", de: "Regime und Konfidenz pruefen", it: "Controlla regime e confidenza" })}</li>
            <li>3. {t(lang, { en: "Review your next best action", pt: "Revê a tua proxima melhor acao", es: "Revisa tu siguiente mejor accion", fr: "Revoyez votre meilleure action suivante", de: "Pruefe deine naechste beste Aktion", it: "Rivedi la tua prossima migliore azione" })}</li>
            <li>4. {t(lang, { en: "Change only what is necessary", pt: "Muda apenas o necessario", es: "Cambia solo lo necesario", fr: "Changez uniquement le necessaire", de: "Aendere nur das Notwendige", it: "Cambia solo il necessario" })}</li>
          </ol>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href={openSetupHref}
            className="inline-flex items-center justify-center rounded-2xl bg-signal-700 px-6 py-3 text-sm font-semibold text-white hover:bg-signal-800"
          >
            {r1AccountsEnabled
              ? t(lang, { en: "View investing accounts", pt: "Ver contas de investimento", fr: "Voir les comptes d’investissement" })
              : t(lang, { en: "Open setup", pt: "Abrir setup", es: "Abrir setup", fr: "Ouvrir setup", de: "Setup oeffnen", it: "Apri setup" })}
          </Link>
          <Link
            href={link("/pricing")}
            className="inline-flex items-center justify-center rounded-2xl border border-border-soft bg-white px-6 py-3 text-sm font-semibold text-ink-900 hover:bg-canvas-50"
          >
            {t(lang, { en: "See pricing", pt: "Ver precos", es: "Ver precios", fr: "Voir les tarifs", de: "Preise ansehen", it: "Vedi prezzi" })}
          </Link>
        </div>
      </section>
    </main>
  );
}

