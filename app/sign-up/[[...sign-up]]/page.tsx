"use client";

import { useEffect } from "react";
import { SignUp } from "@clerk/nextjs";
import { getCampaignData, track } from "@/lib/analytics/client";

function safeRelativeRedirect(input: string | null) {
  const value = String(input || "").trim();
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("://")) return null;
  return value;
}

function resolveAuthRedirect() {
  if (typeof window === "undefined") return "/welcome";
  const params = new URLSearchParams(window.location.search);
  const explicit = safeRelativeRedirect(
    params.get("redirect_url") ?? params.get("redirectUrl") ?? params.get("returnTo"),
  );
  if (explicit) return explicit;

  const intent = String(params.get("intent") || "").trim().toLowerCase();
  if (intent === "trial" || intent === "checkout") {
    return `/pricing?intent=${encodeURIComponent(intent)}&source=auth_return`;
  }

  return "/welcome";
}

export default function Page() {
  useEffect(() => {
    const campaign = getCampaignData();
    track("sign_up_view", {
      page: "sign_up",
      ref: campaign?.ref || null,
      utm_source: campaign?.utm_source || null,
      utm_campaign: campaign?.utm_campaign || null,
    });
  }, []);
  const redirectUrl = resolveAuthRedirect();

  // Preserve paid intent so trial/checkout clicks can resume after auth.
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <SignUp fallbackRedirectUrl={redirectUrl} forceRedirectUrl={redirectUrl} />
    </div>
  );
}
