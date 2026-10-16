import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Manrope, Space_Grotesk } from "next/font/google";
import { GoogleTagManager } from "@next/third-parties/google";
import { Suspense } from "react";
import Script from "next/script";
import GtmPageViewTracker from "@/components/GtmPageViewTracker";
import { SiteLanguageProvider } from "@/components/SiteLanguageProvider";
import "./globals.css";

const IS_PROD = process.env.NODE_ENV === "production";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.syntrake.com"),
  manifest: IS_PROD ? "/manifest.webmanifest" : undefined,
  title: {
    default: "Syntrake | Goal-Based Investing With Institutional Discipline",
    template: "%s | Syntrake",
  },
  description:
    "Syntrake helps you turn goals into an actionable investment process with risk guardrails, explainable decisions, and calm execution.",
  openGraph: {
    type: "website",
    title: "Syntrake | Goal-Based Investing With Institutional Discipline",
    description:
      "Build a goal-based plan, monitor risk like an institution, and execute one clear next step at a time.",
    siteName: "Syntrake",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Syntrake",
    description:
      "Goal-based investing with institutional discipline, explainable actions, and risk-aware execution.",
  },
  appleWebApp: IS_PROD
    ? {
        capable: true,
        statusBarStyle: "default",
        title: "Syntrake",
      }
    : undefined,
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
};

const GTM_CONTAINER_ID = (process.env.NEXT_PUBLIC_GTM_ID || "GTM-T4P7BL6D").trim();
const GTM_ENABLED = GTM_CONTAINER_ID.length > 0;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${manrope.variable} ${spaceGrotesk.variable}`}>
        {GTM_ENABLED ? <GoogleTagManager gtmId={GTM_CONTAINER_ID} /> : null}
        {GTM_ENABLED ? (
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(GTM_CONTAINER_ID)}`}
              height="0"
              width="0"
              style={{ display: "none", visibility: "hidden" }}
            />
          </noscript>
        ) : null}
        <Script id="syntrake-campaign-capture" strategy="afterInteractive">
          {`
            (function () {
              try {
                var params = new URLSearchParams(window.location.search);
                var campaign = {
                  utm_source: params.get("utm_source") || undefined,
                  utm_medium: params.get("utm_medium") || undefined,
                  utm_campaign: params.get("utm_campaign") || undefined,
                  utm_content: params.get("utm_content") || undefined,
                  utm_term: params.get("utm_term") || undefined,
                  ref: params.get("ref") || undefined,
                };
                var hasCampaign = Object.values(campaign).some(Boolean);
                if (hasCampaign) {
                  window.localStorage.setItem("sc_campaign", JSON.stringify(campaign));
                }
                var saved = window.localStorage.getItem("sc_campaign");
                window.__scCampaign = saved ? JSON.parse(saved) : campaign;
              } catch (_) {}
            })();
          `}
        </Script>
        <Script id="syntrake-sw-register" strategy="beforeInteractive">
          {`
            (function () {
              try {
                if (!("serviceWorker" in navigator)) return;
                navigator.serviceWorker.getRegistrations()
                  .then(function (registrations) {
                    return Promise.all(
                      registrations.map(function (registration) {
                        return registration.unregister();
                      })
                    );
                  })
                  .catch(function () {});

                if ("caches" in window) {
                  caches.keys()
                    .then(function (keys) {
                      return Promise.all(keys.map(function (key) { return caches.delete(key); }));
                    })
                    .catch(function () {});
                }
              } catch (_) {}
            })();
          `}
        </Script>
        <ClerkProvider domain={process.env.NEXT_PUBLIC_CLERK_DOMAIN}>
          <SiteLanguageProvider>
            {children}
            {GTM_ENABLED ? (
              <Suspense fallback={null}>
                <GtmPageViewTracker />
              </Suspense>
            ) : null}
          </SiteLanguageProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}

