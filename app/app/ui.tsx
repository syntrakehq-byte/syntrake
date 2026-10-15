"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";

import CockpitShell from "@/components/CockpitShell";
import MoneyPill from "@/components/MoneyPill";
import AutopilotSwitcher from "@/components/AutopilotSwitcher";
import UpgradeModal from "@/components/UpgradeModal";
import TradingUpgradeGate from "@/components/trading/TradingUpgradeGate";
import TradingNotificationManager from "@/components/trading/TradingNotificationManager";
import { buildTradingUpgradeModel } from "@/components/trading/tradingUpgradeModel";
import { useSiteLanguage } from "@/components/SiteLanguageProvider";
import { pickByLang } from "@/lib/i18n/siteLanguage";

import { useAccess } from "@/lib/signalcore/useAccess";
import { useAutopilotMode } from "@/lib/signalcore/useAutopilotMode";
import { useUserSettings } from "@/lib/signalcore/useUserSettings";
import { canAccessView, getLockedViewsForMode } from "@/lib/signalcore/entitlements";
import { deriveFirstValueRailState, deriveSetupProgress, type FirstValueSetupKey } from "@/app/app/firstValue";

import TradingTab from "@/app/app/tabs/TradingTab";
import InvestingDashboardSurface from "@/app/app/tabs/InvestingDashboardSurface";
import JournalTab from "@/app/app/tabs/JournalTab";
import AlertsTab from "@/app/app/tabs/AlertsTab";
import OfflineSetupClient from "@/app/app/offline-setup/offlineSetupClient";
import {
  buildModeAwareNavItems,
  buildShellCopy,
  getModeHomeView,
  inferModeFromView,
  resolveModeAwareView,
  toModeAwareTab,
  type ViewKey,
} from "@/app/app/navigationModel";

function buildModeHint(args: {
  lang: ReturnType<typeof useSiteLanguage>["lang"];
  tier: "free" | "trial" | "pro";
}) {
  if (args.tier === "trial") {
    return pickByLang(args.lang, {
      en: "Trial active: full trading execution unlocked",
      pt: "Trial ativo: trading completo desbloqueado",
      es: "Trial activo: trading completo desbloqueado",
      fr: "Essai actif : trading complet debloque",
      de: "Test aktiv: vollstandiges Trading freigeschaltet",
      it: "Trial attivo: trading completo sbloccato",
    });
  }

  if (args.tier === "pro") {
    return pickByLang(args.lang, {
      en: "Pro account: full investing + full trading execution",
      pt: "Conta Pro: investing completo + trading completo",
      es: "Cuenta Pro: investing completo + trading completo",
      fr: "Compte Pro : investing complet + trading complet",
      de: "Pro-Konto: volles Investing + volles Trading",
      it: "Account Pro: investing completo + trading completo",
    });
  }

  return pickByLang(args.lang, {
    en: "Investing is free forever. Trading is open in discovery mode.",
    pt: "Investing e gratis para sempre. Trading abre em modo discovery.",
    es: "Investing es gratis para siempre. Trading abre en modo discovery.",
    fr: "Investing reste gratuit. Trading ouvre en mode discovery.",
    de: "Investing bleibt gratis. Trading offnet im Discovery-Modus.",
    it: "Investing resta gratis. Trading si apre in modalita discovery.",
  });
}

function toLockedTradingSurface(view: ViewKey): "execution" | "risk" | "journal" | "alerts" | null {
  if (view === "execution" || view === "risk" || view === "journal" || view === "alerts") {
    return view;
  }
  return null;
}

function isLocalQaShellAuthBypass() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("qa") === "assisted" || params.get("__qa_auth") === "1") return true;
  return document.cookie.split(";").some((part) => part.trim() === "syntrake_qa_auth=1");
}

function firstValueSetupLabel(lang: ReturnType<typeof useSiteLanguage>["lang"], key: FirstValueSetupKey) {
  if (key === "risk_profile") {
    return pickByLang(lang, {
      en: "Risk profile",
      pt: "Perfil de risco",
      es: "Perfil de riesgo",
      fr: "Profil de risque",
      de: "Risikoprofil",
      it: "Profilo di rischio",
    });
  }

  if (key === "horizon") {
    return pickByLang(lang, {
      en: "Time horizon",
      pt: "Horizonte temporal",
      es: "Horizonte temporal",
      fr: "Horizon de temps",
      de: "Zeithorizont",
      it: "Orizzonte temporale",
    });
  }

  if (key === "goal_type") {
    return pickByLang(lang, {
      en: "Goal type",
      pt: "Tipo de objetivo",
      es: "Tipo de objetivo",
      fr: "Type d objectif",
      de: "Zieltyp",
      it: "Tipo di obiettivo",
    });
  }

  return pickByLang(lang, {
    en: "Target amount",
    pt: "Valor alvo",
    es: "Objetivo monetario",
    fr: "Montant cible",
    de: "Zielbetrag",
    it: "Importo obiettivo",
  });
}

function guidedMissionToneClasses(status: "done" | "active" | "locked") {
  if (status === "done") return "border-emerald-400/18 bg-emerald-400/10 text-emerald-100";
  if (status === "active") return "border-cyan-300/22 bg-cyan-300/10 text-cyan-100";
  return "border-white/8 bg-white/[0.035] text-slate-400";
}

function FirstValueRail(props: {
  lang: ReturnType<typeof useSiteLanguage>["lang"];
  mode: "investing" | "trading";
  tier: "free" | "trial" | "pro";
  state: ReturnType<typeof deriveFirstValueRailState>;
  setupHref: string;
  primaryHref: string;
  pricingHref: string;
  onNavigate: (href: string) => void;
}) {
  if (props.state.kind === "hidden") return null;

  if (props.state.kind === "setup") {
    const missionSteps = [
      {
        key: "plan",
        status: props.state.progressDone >= props.state.progressTotal ? "done" : "active",
        title: pickByLang(props.lang, {
          en: "Plan",
          pt: "Plano",
          es: "Plan",
          fr: "Plan",
          de: "Plan",
          it: "Piano",
        }),
        detail: pickByLang(props.lang, {
          en: "Goal, risk, horizon",
          pt: "Objetivo, risco, horizonte",
          es: "Objetivo, riesgo, horizonte",
          fr: "Objectif, risque, horizon",
          de: "Ziel, Risiko, Horizont",
          it: "Obiettivo, rischio, orizzonte",
        }),
      },
      {
        key: "portfolio",
        status: props.state.progressDone >= props.state.progressTotal ? "active" : "locked",
        title: "Portfolio",
        detail: pickByLang(props.lang, {
          en: "Holdings or starter pack",
          pt: "Holdings ou starter pack",
          es: "Holdings o starter pack",
          fr: "Positions ou starter pack",
          de: "Holdings oder Starter-Pack",
          it: "Holdings o starter pack",
        }),
      },
      {
        key: "daily",
        status: "locked",
        title: "Daily",
        detail: pickByLang(props.lang, {
          en: "One action today",
          pt: "Uma acao hoje",
          es: "Una accion hoy",
          fr: "Une action aujourd hui",
          de: "Eine Aktion heute",
          it: "Un azione oggi",
        }),
      },
      {
        key: "advisor",
        status: "locked",
        title: "Advisor",
        detail: pickByLang(props.lang, {
          en: "Why it matters",
          pt: "Porque importa",
          es: "Por que importa",
          fr: "Pourquoi ca compte",
          de: "Warum es zaehlt",
          it: "Perche conta",
        }),
      },
      {
        key: "autonomy",
        status: "locked",
        title: pickByLang(props.lang, {
          en: "Copilot",
          pt: "Copilot",
          es: "Copilot",
          fr: "Copilot",
          de: "Copilot",
          it: "Copilot",
        }),
        detail: pickByLang(props.lang, {
          en: "Control level",
          pt: "Nivel de controlo",
          es: "Nivel de control",
          fr: "Niveau de controle",
          de: "Kontrollniveau",
          it: "Livello di controllo",
        }),
      },
    ] as const;

    const heading =
      props.mode === "trading"
        ? props.tier === "free"
          ? pickByLang(props.lang, {
              en: "Trading discovery is live. Add a few setup inputs for cleaner risk framing.",
              pt: "Trading discovery ja esta ativo. Adiciona alguns inputs para um enquadramento de risco mais limpo.",
              es: "Trading discovery ya esta activo. Anade algunos datos para un marco de riesgo mas limpio.",
              fr: "Trading discovery est deja actif. Ajoutez quelques donnees pour un cadrage du risque plus propre.",
              de: "Trading Discovery ist bereits aktiv. Fuege ein paar Angaben hinzu fuer saubereres Risk Framing.",
              it: "Trading discovery e gia attivo. Aggiungi alcuni dati per una cornice di rischio piu pulita.",
            })
          : pickByLang(props.lang, {
              en: "Trading cockpit is live. Complete setup so risk framing gets sharper.",
              pt: "O cockpit de Trading esta ativo. Completa o setup para afinar o enquadramento de risco.",
              es: "El cockpit de Trading esta activo. Completa el setup para afinar el marco de riesgo.",
              fr: "Le cockpit Trading est actif. Completez le setup pour affiner le cadrage du risque.",
              de: "Das Trading-Cockpit ist aktiv. Schliesse das Setup ab, damit der Risikorahmen schaerfer wird.",
              it: "Il cockpit Trading e attivo. Completa il setup per rendere piu precisa la cornice di rischio.",
            })
        : pickByLang(props.lang, {
            en: "10-minute mission: make Syntrake ready to guide your capital.",
            pt: "Missao de 10 minutos: deixa o Syntrake pronto para guiar o teu capital.",
            es: "Mision de 10 minutos: deja Syntrake listo para guiar tu capital.",
            fr: "Mission de 10 minutes : preparez Syntrake a guider votre capital.",
            de: "10-Minuten-Mission: Mach Syntrake bereit, dein Kapital zu fuehren.",
            it: "Missione da 10 minuti: prepara Syntrake a guidare il tuo capitale.",
          });

    const body =
      props.mode === "trading"
        ? props.tier === "free"
          ? pickByLang(props.lang, {
              en: "Trading can stay open while you finish the profile. Syntrake becomes much better at risk framing once these basics are in place.",
              pt: "Trading pode continuar aberto enquanto acabas o perfil. O Syntrake melhora muito no enquadramento de risco quando estes basicos estao feitos.",
              es: "Trading puede seguir abierto mientras terminas el perfil. Syntrake mejora mucho el marco de riesgo cuando estas bases estan listas.",
              fr: "Trading peut rester ouvert pendant que vous terminez le profil. Syntrake devient bien meilleur en cadrage du risque une fois ces bases en place.",
              de: "Trading kann offen bleiben, waehrend du das Profil abschliesst. Syntrake wird beim Risikorahmen deutlich besser, sobald diese Basics stehen.",
              it: "Trading puo restare aperto mentre completi il profilo. Syntrake migliora molto nella cornice di rischio quando queste basi sono pronte.",
            })
          : pickByLang(props.lang, {
              en: "You can already read the live flow. Finish these inputs so Syntrake can make sizing, risk caps, and broker checklists more specific.",
              pt: "Ja podes ler o flow live. Termina estes inputs para o Syntrake tornar sizing, limites de risco e checklists de broker mais especificos.",
              es: "Ya puedes leer el flujo live. Completa estos datos para que Syntrake haga sizing, limites de riesgo y checklists de broker mas especificos.",
              fr: "Vous pouvez deja lire le flow live. Completez ces donnees pour rendre sizing, limites de risque et checklists broker plus specifiques.",
              de: "Du kannst den Live-Flow bereits lesen. Schliesse diese Angaben ab, damit Syntrake Sizing, Risikolimits und Broker-Checklisten konkreter macht.",
              it: "Puoi gia leggere il flow live. Completa questi dati per rendere sizing, limiti di rischio e checklist broker piu specifici.",
            })
        : pickByLang(props.lang, {
            en: "This is the guided path: set the plan, load the portfolio, connect broker access, read one daily action, then use Advisor and Copilot when the base is clear.",
            pt: "Este e o caminho guiado: definir o plano, carregar o portfolio, ligar broker, ler uma acao diaria e so depois usar Advisor e Copilot com a base clara.",
            es: "Este es el camino guiado: definir plan, cargar portfolio, conectar broker, leer una accion diaria y despues usar Advisor y Copilot con la base clara.",
            fr: "Voici le chemin guide : definir le plan, charger le portefeuille, connecter le broker, lire une action quotidienne, puis utiliser Advisor et Copilot.",
            de: "Das ist der gefuehrte Weg: Plan setzen, Portfolio laden, Broker verbinden, eine Tagesaktion lesen, dann Advisor und Copilot nutzen.",
            it: "Questo e il percorso guidato: definisci piano, carica portfolio, collega broker, leggi una azione daily, poi usa Advisor e Copilot.",
          });

    return (
      <div className="rounded-[22px] border border-cyan-400/16 bg-[linear-gradient(180deg,rgba(12,24,44,0.92),rgba(11,20,37,0.98))] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="inline-flex rounded-full border border-cyan-400/16 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-100">
              {pickByLang(props.lang, {
                en: "Quick start",
                pt: "Quick start",
                es: "Quick start",
                fr: "Quick start",
                de: "Quick start",
                it: "Quick start",
              })}
            </div>
            <div className="mt-3 text-xl font-semibold tracking-tight text-white">{heading}</div>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-300">{body}</p>
          </div>
          <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3 text-right">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              {pickByLang(props.lang, {
                en: "Setup progress",
                pt: "Progresso do setup",
                es: "Progreso del setup",
                fr: "Progression du setup",
                de: "Setup-Fortschritt",
                it: "Progresso del setup",
              })}
            </div>
            <div className="mt-1 text-2xl font-semibold text-white">
              {props.state.progressDone}/{props.state.progressTotal}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {props.state.missingKeys.map((key) => (
            <span
              key={key}
              className="rounded-full border border-amber-400/14 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-100"
            >
              {firstValueSetupLabel(props.lang, key)}
            </span>
          ))}
        </div>

        {props.mode === "investing" ? (
          <div className="mt-5 grid gap-2 md:grid-cols-5">
            {missionSteps.map((step, index) => (
              <div key={step.key} className={`rounded-2xl border p-3 ${guidedMissionToneClasses(step.status)}`}>
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-70">
                  {String(index + 1).padStart(2, "0")}
                </div>
                <div className="mt-2 text-sm font-semibold tracking-tight">{step.title}</div>
                <div className="mt-1 text-xs leading-5 opacity-80">{step.detail}</div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => props.onNavigate(props.setupHref)}
            className="inline-flex items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#4a88ff,#6ba8ff)] px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_36px_rgba(49,115,255,0.22)]"
          >
            {pickByLang(props.lang, {
              en: "Finish setup",
              pt: "Terminar setup",
              es: "Terminar setup",
              fr: "Terminer le setup",
              de: "Setup abschliessen",
              it: "Completa setup",
            })}
          </button>
          <button
            type="button"
            onClick={() => props.onNavigate(props.primaryHref)}
            className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.07]"
          >
            {props.mode === "trading"
              ? pickByLang(props.lang, {
                  en: "Open Trading",
                  pt: "Abrir Trading",
                  es: "Abrir Trading",
                  fr: "Ouvrir Trading",
                  de: "Trading oeffnen",
                  it: "Apri Trading",
                })
              : pickByLang(props.lang, {
                  en: "Open Daily",
                  pt: "Abrir Daily",
                  es: "Abrir Daily",
                  fr: "Ouvrir Daily",
                  de: "Daily oeffnen",
                  it: "Apri Daily",
                })}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[22px] border border-blue-400/16 bg-[linear-gradient(180deg,rgba(14,25,47,0.92),rgba(10,18,35,0.98))] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="inline-flex rounded-full border border-blue-400/16 bg-blue-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-100">
            {pickByLang(props.lang, {
              en: "Trading discovery",
              pt: "Trading discovery",
              es: "Trading discovery",
              fr: "Trading discovery",
              de: "Trading Discovery",
              it: "Trading discovery",
            })}
          </div>
          <div className="mt-3 text-xl font-semibold tracking-tight text-white">
            {pickByLang(props.lang, {
              en: "The desk is already useful before you pay.",
              pt: "A desk ja e util antes de pagares.",
              es: "La desk ya es util antes de pagar.",
              fr: "Le desk est deja utile avant de payer.",
              de: "Das Desk ist schon nuetzlich, bevor du zahlst.",
              it: "La desk e gia utile prima di pagare.",
            })}
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-300">
            {pickByLang(props.lang, {
              en: "Use Trading for the market radar and trade plan. Upgrade only when you want execution depth, journal memory, alerts, and longer continuity.",
              pt: "Usa Trading para o radar de mercados e o plano do trade. Faz upgrade so quando quiseres profundidade de execucao, memoria de journal, alerts e mais continuidade.",
              es: "Usa Trading para el radar de mercados y el plan del trade. Haz upgrade solo cuando quieras profundidad de ejecucion, memoria de journal, alerts y mas continuidad.",
              fr: "Utilisez Trading pour le radar des marches et le plan du trade. Passez a niveau seulement quand vous voulez plus de profondeur d execution, memoire du journal, alertes et continuite.",
              de: "Nutze Trading fuer Market Radar und Trade Plan. Upgrade erst, wenn du Execution-Tiefe, Journal-Gedaechtnis, Alerts und mehr Kontinuitaet willst.",
              it: "Usa Trading per market radar e trade plan. Fai upgrade solo quando vuoi piu profondita di esecuzione, memoria del journal, alert e continuita.",
            })}
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => props.onNavigate(props.primaryHref)}
          className="inline-flex items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#3f82ff,#5ea1ff)] px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_36px_rgba(49,115,255,0.22)]"
        >
          {pickByLang(props.lang, {
            en: "Open Trading",
            pt: "Abrir Trading",
            es: "Abrir Trading",
            fr: "Ouvrir Trading",
            de: "Trading oeffnen",
            it: "Apri Trading",
          })}
        </button>
        <button
          type="button"
          onClick={() => props.onNavigate(props.pricingHref)}
          className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.07]"
        >
          {pickByLang(props.lang, {
            en: "Compare Trading Pro",
            pt: "Comparar Trading Pro",
            es: "Comparar Trading Pro",
            fr: "Comparer Trading Pro",
            de: "Trading Pro vergleichen",
            it: "Confronta Trading Pro",
          })}
        </button>
      </div>
    </div>
  );
}

export default function AppUI() {
  const router = useRouter();
  const search = useSearchParams();
  const { isSignedIn } = useUser();
  const [qaAuthBypass, setQaAuthBypass] = useState(false);
  const { lang } = useSiteLanguage();

  const { isPaid, trial, tier, entitlements, loadingAccess } = useAccess();
  const { loading: modeLoading, mode, setActiveMode } = useAutopilotMode();
  const { data: settingsData, loading: settingsLoading } = useUserSettings();
  const activeMode = mode;
  const requestedViewRaw = search?.get("tab") ?? search?.get("view");
  const requestedModeRaw = String(search?.get("mode") || "").toLowerCase();
  const requestedMode =
    requestedModeRaw === "trading" || requestedModeRaw === "investing" ? requestedModeRaw : null;
  const workspaceMode = requestedMode ?? inferModeFromView(requestedViewRaw) ?? activeMode;

  const [view, setView] = useState<ViewKey>(() =>
    resolveModeAwareView({
      rawView: requestedViewRaw ?? getModeHomeView(workspaceMode),
      mode: workspaceMode,
    }),
  );
  const [lockedNavTarget, setLockedNavTarget] = useState<ViewKey | null>(null);

  const welcomeSetupRequested = (search?.get("welcomeSetup") ?? "") === "1";
  const offlineSetupRequested = (search?.get("offlineSetup") ?? "") === "1";

  useEffect(() => {
    setQaAuthBypass(isLocalQaShellAuthBypass());
  }, []);

  useEffect(() => {
    setView(
      resolveModeAwareView({
        rawView: requestedViewRaw ?? getModeHomeView(workspaceMode),
        mode: workspaceMode,
      }),
    );
  }, [requestedViewRaw, workspaceMode]);

  useEffect(() => {
    const qp = new URLSearchParams(search?.toString() || "");
    qp.set("tab", toModeAwareTab({ view, mode: workspaceMode }));
    qp.set("mode", workspaceMode);
    qp.delete("view");
    if (view !== "autonomy") qp.delete("brokerSetup");
    if (view !== "planning") {
      qp.delete("welcomeSetup");
      qp.delete("offlineSetup");
    }
    const nextQuery = qp.toString();
    const currentQuery = search?.toString() || "";
    if (nextQuery === currentQuery) return;
    router.replace(`/app?${nextQuery}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, workspaceMode]);

  const lockedViewKeys = useMemo(() => getLockedViewsForMode({ tier, mode: workspaceMode }), [tier, workspaceMode]);
  const navItems = useMemo(
    () => buildModeAwareNavItems({ mode: workspaceMode, lang, lockedKeys: lockedViewKeys as ViewKey[] }),
    [workspaceMode, lang, lockedViewKeys],
  );
  const shellCopy = useMemo(() => buildShellCopy({ mode: workspaceMode, view, lang }), [workspaceMode, view, lang]);
  const homeHref = useMemo(() => `/app?tab=${getModeHomeView(workspaceMode)}&mode=${workspaceMode}`, [workspaceMode]);
  const showTopRight = false;
  const modeHint = useMemo(() => buildModeHint({ lang, tier }), [lang, tier]);
  const tradingViewLocked = workspaceMode === "trading" && !canAccessView({ tier, mode: workspaceMode, view });
  const lockedTradingSurface = toLockedTradingSurface(view);
  const settings = useMemo(
    () =>
      settingsData && typeof settingsData === "object"
        ? ((settingsData as any).settings && typeof (settingsData as any).settings === "object"
            ? (settingsData as any).settings
            : settingsData)
        : {},
    [settingsData],
  );
	  const firstValueRailState = useMemo(
	    () =>
	      deriveFirstValueRailState({
	        mode: workspaceMode,
	        tier,
	        settings,
	        view,
	        welcomeSetupRequested,
	        offlineSetupRequested,
	      }),
	    [workspaceMode, tier, settings, view, welcomeSetupRequested, offlineSetupRequested],
	  );
  const setupProgress = useMemo(() => deriveSetupProgress(settings), [settings]);
  const firstValuePrimaryHref =
    workspaceMode === "trading" ? `/app?tab=trading&mode=${workspaceMode}` : `/app?tab=daily&mode=${workspaceMode}`;
  const setupHref = `/app?tab=planning&welcomeSetup=1&mode=${workspaceMode}`;
  const pricingHref = "/pricing?source=app_first_value";
  const lockedNavSurface = lockedNavTarget ? toLockedTradingSurface(lockedNavTarget) : null;
  const lockedNavUpgradeModel = lockedNavSurface ? buildTradingUpgradeModel(lockedNavSurface) : null;

  const right =
    workspaceMode === "trading" ? (
      <div className="hidden gap-2 md:flex">
        <MoneyPill
          label={pickByLang(lang, {
            en: "Opportunity flow",
            pt: "Fluxo de oportunidades",
            es: "Flujo de oportunidades",
            fr: "Flux d opportunites",
            de: "Opportunity-Flow",
            it: "Flusso opportunita",
          })}
          value={tier === "free" ? "DISCOVERY" : "LIVE"}
        />
        <MoneyPill
          label={pickByLang(lang, {
            en: "Execution posture",
            pt: "Postura de execucao",
            es: "Postura de ejecucion",
            fr: "Posture d execution",
            de: "Execution-Posture",
            it: "Postura di esecuzione",
          })}
          value={tier === "free" ? "LIMITED" : "ACTIVE"}
        />
      </div>
    ) : (
      <div className="hidden gap-2 md:flex">
        <MoneyPill
          label={pickByLang(lang, {
            en: "Setup",
            pt: "Setup",
            es: "Setup",
            fr: "Setup",
            de: "Setup",
            it: "Setup",
          })}
          value={
            setupProgress.complete
              ? pickByLang(lang, {
                  en: "Complete",
                  pt: "Completo",
                  es: "Completo",
                  fr: "Complet",
                  de: "Komplett",
                  it: "Completo",
                })
              : `${setupProgress.progressDone}/${setupProgress.progressTotal}`
          }
        />
        <MoneyPill
          label={pickByLang(lang, {
            en: "Protection",
            pt: "Protecao",
            es: "Proteccion",
            fr: "Protection",
            de: "Schutz",
            it: "Protezione",
          })}
          value={
            setupProgress.complete
              ? pickByLang(lang, {
                  en: "Plan ready",
                  pt: "Plano pronto",
                  es: "Plan listo",
                  fr: "Plan pret",
                  de: "Plan bereit",
                  it: "Piano pronto",
                })
              : pickByLang(lang, {
                  en: "Configure",
                  pt: "Configurar",
                  es: "Configurar",
                  fr: "Configurer",
                  de: "Einrichten",
                  it: "Configura",
                })
          }
        />
      </div>
    );

  async function handleModeChange(nextMode: typeof activeMode) {
    const result = await setActiveMode(nextMode);
    const resolvedMode =
      result && result.ok === false && "allowedMode" in result && result.allowedMode
        ? result.allowedMode
        : nextMode;
    const nextView = getModeHomeView(resolvedMode);

    setView(nextView);

    const qp = new URLSearchParams(search?.toString() || "");
    qp.set("mode", resolvedMode);
    qp.set("tab", nextView);
    qp.delete("view");
    qp.delete("brokerSetup");
    qp.delete("welcomeSetup");
    qp.delete("offlineSetup");
    router.push(`/app?${qp.toString()}`);
  }

  if (!isSignedIn && !qaAuthBypass) return null;

  return (
    <>
      {workspaceMode === "trading" && entitlements.trading.alertsEnabled ? (
        <TradingNotificationManager enabled={entitlements.trading.alertsEnabled} />
      ) : null}

      <CockpitShell
        title={shellCopy.title}
        subtitle={shellCopy.subtitle}
        productBadge={workspaceMode === "trading" ? "Trading Desk" : "Investing OS"}
        right={showTopRight ? right : null}
        active={view}
        items={navItems}
        homeHref={homeHref}
        onNav={(key) => {
          const nextView = key as ViewKey;
          setView(nextView);

          const qp = new URLSearchParams(search?.toString() || "");
          qp.set("tab", toModeAwareTab({ view: nextView, mode: workspaceMode }));
          qp.set("mode", workspaceMode);
          qp.delete("view");

          if (nextView !== "autonomy") qp.delete("brokerSetup");
          if (nextView !== "planning") {
            qp.delete("welcomeSetup");
            qp.delete("offlineSetup");
          }

          router.push(`/app?${qp.toString()}`);
        }}
        onLockedNav={(key) => setLockedNavTarget(key as ViewKey)}
        isPaid={Boolean(isPaid)}
        trial={loadingAccess || modeLoading ? null : trial}
        showPageHeader={workspaceMode === "trading" && view !== "trading"}
      >
        <div className="grid gap-4">
          <AutopilotSwitcher
            mode={workspaceMode}
            disabled={modeLoading}
            isPaid={Boolean(isPaid)}
            tier={tier}
            allowedModes={entitlements.allowedModes}
            proHint={modeHint}
            variant={workspaceMode === "trading" ? "compact" : "default"}
            onChange={handleModeChange}
          />

          {workspaceMode === "trading" ? (
            <div className="rounded-[22px] border border-cyan-300/20 bg-cyan-300/[0.08] p-4 text-cyan-50 shadow-[0_18px_50px_rgba(8,145,178,0.08)]">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-100/70">
                    Private automation
                  </p>
                  <h2 className="mt-1 text-lg font-black text-white">Bot automatico + demo history</h2>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-cyan-50/75">
                    Testa o bot em demo, guarda ate 6 meses de historico e so prepara live quando estiver armado e ligado a broker.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => router.push("/app/bot")}
                  className="rounded-2xl bg-cyan-200 px-4 py-3 text-sm font-black text-slate-950 transition hover:brightness-110"
                >
                  Open bot cockpit
                </button>
              </div>
            </div>
          ) : null}

          {workspaceMode !== "investing" && !settingsLoading && !loadingAccess && !modeLoading ? (
            <FirstValueRail
              lang={lang}
              mode={workspaceMode}
              tier={tier}
              state={firstValueRailState}
              setupHref={setupHref}
              primaryHref={firstValuePrimaryHref}
              pricingHref={pricingHref}
              onNavigate={(href) => router.push(href)}
            />
          ) : null}

          {workspaceMode === "investing" ? (
            <>
              {view === "planning" &&
                (welcomeSetupRequested || offlineSetupRequested ? (
                  <OfflineSetupClient />
                ) : (
                  <InvestingDashboardSurface page="planning" />
                ))}
              {view === "daily" && <InvestingDashboardSurface page="daily" />}
              {view === "advisor" && <InvestingDashboardSurface page="research" />}
              {view === "research" && <InvestingDashboardSurface page="research" />}
              {view === "portfolio" && <InvestingDashboardSurface page="portfolio" />}
              {view === "broker" && <InvestingDashboardSurface page="broker" />}
              {view === "reports" && <InvestingDashboardSurface page="reports" />}
              {view === "settings" && <InvestingDashboardSurface page="settings" />}
              {view === "autonomy" && <InvestingDashboardSurface page="autonomy" />}
            </>
          ) : tradingViewLocked && lockedTradingSurface ? (
            <TradingUpgradeGate surface={lockedTradingSurface} />
          ) : (
            <>
              {view === "trading" && (
                <TradingTab mode={workspaceMode} discoveryLimit={entitlements.trading.discoveryInstrumentLimit} />
              )}
              {view === "journal" && <JournalTab />}
              {view === "alerts" && <AlertsTab locale={lang === "pt" ? "pt" : "en"} />}
            </>
          )}

        </div>
      </CockpitShell>

      <UpgradeModal
        open={lockedNavTarget !== null}
        onClose={() => setLockedNavTarget(null)}
        eyebrow={lockedNavUpgradeModel?.eyebrow || "Trading Pro"}
        title={lockedNavUpgradeModel?.modalTitle || "Unlock full trading depth"}
        subtitle={
          lockedNavUpgradeModel?.modalSubtitle ||
          "Investing stays free forever. Trading opens with Market Radar in discovery mode. Upgrade when you want execution depth, journal, alerts, and deeper history."
        }
        primaryHref={lockedNavUpgradeModel?.pricingHref || "/pricing?source=app_locked_nav"}
        primaryText={lockedNavUpgradeModel?.primaryCta || "See trading plans"}
        secondaryHref={lockedNavUpgradeModel?.pricingHref || "/pricing?source=app_locked_nav_compare"}
        secondaryText={lockedNavUpgradeModel?.compareCta || "Compare Trading Pro"}
        freeTitle={lockedNavUpgradeModel?.freeTitle}
        freeBody={lockedNavUpgradeModel?.freeBody}
        trialTitle={lockedNavUpgradeModel?.trialTitle}
        trialBody={lockedNavUpgradeModel?.trialBody}
        proTitle={lockedNavUpgradeModel?.proTitle}
        proBullets={lockedNavUpgradeModel?.proBullets}
      />
    </>
  );
}
