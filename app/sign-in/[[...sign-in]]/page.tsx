"use client";

import { SignIn } from "@clerk/nextjs";

function safeRelativeRedirect(input: string | null) {
  const value = String(input || "").trim();
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("://")) return null;
  return value;
}

function resolveAuthRedirect() {
  if (typeof window === "undefined") return "/start";
  const params = new URLSearchParams(window.location.search);
  const explicit = safeRelativeRedirect(
    params.get("redirect_url") ?? params.get("redirectUrl") ?? params.get("returnTo"),
  );
  if (explicit) return explicit;

  const intent = String(params.get("intent") || "").trim().toLowerCase();
  if (intent === "trial" || intent === "checkout") {
    return `/pricing?intent=${encodeURIComponent(intent)}&source=auth_return`;
  }

  return "/start";
}

export default function Page() {
  const redirectUrl = resolveAuthRedirect();

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <SignIn fallbackRedirectUrl={redirectUrl} forceRedirectUrl={redirectUrl} />
    </div>
  );
}
