import { pickByLang, type Multilingual, type SiteLang } from "@/lib/i18n/siteLanguage";
import { resolveRequestSiteLang } from "@/lib/i18n/requestSiteLang";

type PageSearchParams = Record<string, string | string[] | undefined>;

function t(
  lang: SiteLang,
  value: Multilingual
) {
  return pickByLang(lang, value);
}

export default async function AndroidInstallPage({
  searchParams,
}: {
  searchParams?: Promise<PageSearchParams> | PageSearchParams;
}) {
  const params =
    searchParams && typeof (searchParams as Promise<PageSearchParams>).then === "function"
      ? await (searchParams as Promise<PageSearchParams>)
      : (searchParams as PageSearchParams | undefined);
  const lang = await resolveRequestSiteLang(params);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {t(lang, {
            en: "Install Syntrake on Android",
            pt: "Instalar Syntrake no Android",
            es: "Instalar Syntrake en Android",
            fr: "Installer Syntrake sur Android",
            de: "Syntrake auf Android installieren",
            it: "Installa Syntrake su Android",
          })}
        </h1>
        <p className="text-sm text-ink-600">
          {t(lang, {
            en: "Syntrake is now installable as an app from Chrome.",
            pt: "Syntrake pode agora ser instalado como app a partir do Chrome.",
            es: "Syntrake ahora se puede instalar como app desde Chrome.",
            fr: "Syntrake est maintenant installable comme app depuis Chrome.",
            de: "Syntrake kann jetzt als App aus Chrome installiert werden.",
            it: "Syntrake ora e installabile come app da Chrome.",
          })}
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">
          {t(lang, {
            en: "Quick install",
            pt: "Instalacao rapida",
            es: "Instalacion rapida",
            fr: "Installation rapide",
            de: "Schnellinstallation",
            it: "Installazione rapida",
          })}
        </h2>
        <ol className="list-decimal pl-5 space-y-2 text-sm text-ink-700">
          <li>{t(lang, { en: "Open Syntrake in Chrome on Android.", pt: "Abre Syntrake no Chrome no Android.", es: "Abre Syntrake en Chrome en Android.", fr: "Ouvrez Syntrake dans Chrome sur Android.", de: "Oeffne Syntrake in Chrome auf Android.", it: "Apri Syntrake in Chrome su Android." })}</li>
          <li>{t(lang, { en: "Tap the menu (three dots).", pt: "Toca no menu (tres pontos).", es: "Toca el menu (tres puntos).", fr: "Touchez le menu (trois points).", de: "Tippe auf das Menue (drei Punkte).", it: "Tocca il menu (tre punti)." })}</li>
          <li>{t(lang, { en: "Tap Install app or Add to Home screen.", pt: "Toca Instalar app ou Adicionar ao ecra principal.", es: "Toca Instalar app o Anadir a pantalla de inicio.", fr: "Touchez Installer l app ou Ajouter a l ecran d accueil.", de: "Tippe auf App installieren oder Zum Startbildschirm hinzufuegen.", it: "Tocca Installa app o Aggiungi alla schermata Home." })}</li>
          <li>{t(lang, { en: "Confirm install.", pt: "Confirma a instalacao.", es: "Confirma la instalacion.", fr: "Confirmez l installation.", de: "Installation bestaetigen.", it: "Conferma l installazione." })}</li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">{t(lang, { en: "What you get", pt: "O que recebes", es: "Que recibes", fr: "Ce que vous obtenez", de: "Was du bekommst", it: "Cosa ottieni" })}</h2>
        <ul className="list-disc pl-5 space-y-2 text-sm text-ink-700">
          <li>{t(lang, { en: "App icon on your Android home screen.", pt: "Icone da app no ecra principal do Android.", es: "Icono de app en la pantalla principal de Android.", fr: "Icone d app sur l ecran d accueil Android.", de: "App-Symbol auf deinem Android-Startbildschirm.", it: "Icona app nella schermata Home Android." })}</li>
          <li>{t(lang, { en: "Full-screen app experience.", pt: "Experiencia de app em ecran completo.", es: "Experiencia de app en pantalla completa.", fr: "Experience app en plein ecran.", de: "Vollbild-App-Erlebnis.", it: "Esperienza app a schermo intero." })}</li>
          <li>{t(lang, { en: "Faster relaunch with local caching.", pt: "Relancamento mais rapido com cache local.", es: "Reinicio mas rapido con cache local.", fr: "Relancement plus rapide avec cache local.", de: "Schnelleres Neustarten mit lokalem Cache.", it: "Riavvio piu rapido con cache locale." })}</li>
        </ul>
      </section>

      <section className="space-y-2">
        <p className="text-sm text-ink-700">
          {t(lang, {
            en: "Want to go further and publish Syntrake in Google Play?",
            pt: "Queres ir mais longe e publicar o Syntrake na Google Play?",
            es: "Quieres ir mas lejos y publicar Syntrake en Google Play?",
            fr: "Vous voulez aller plus loin et publier Syntrake sur Google Play ?",
            de: "Willst du weiter gehen und Syntrake bei Google Play veroeffentlichen?",
            it: "Vuoi fare un passo in piu e pubblicare Syntrake su Google Play?",
          })}
        </p>
        <p className="text-sm text-ink-700">
          {t(lang, {
            en: "See the repository guide:",
            pt: "Ves o guia no repositorio:",
            es: "Consulta la guia en el repositorio:",
            fr: "Consultez le guide du depot :",
            de: "Sieh die Anleitung im Repository:",
            it: "Vedi la guida nel repository:",
          })}{" "}
          <code>docs/android-launch-playstore.md</code>.
        </p>
      </section>
    </main>
  );
}


