"use client";

import { SignIn, useSignIn } from "@clerk/nextjs";
import { useState } from "react";

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
      <GoogleSignIn redirectUrl={redirectUrl} />
      <SignIn fallbackRedirectUrl={redirectUrl} forceRedirectUrl={redirectUrl} />
    </div>
  );
}

function GoogleSignIn({ redirectUrl }: { redirectUrl: string }) {
  const { signIn, isLoaded } = useSignIn();
  const [error, setError] = useState<string | null>(null);

  async function startGoogle() {
    if (!isLoaded) return;
    setError(null);
    try {
      await signIn.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: "/sso-callback",
        redirectUrlComplete: redirectUrl,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start Google sign-in.");
    }
  }

  return (
    <div className="fixed left-1/2 top-4 z-50 flex -translate-x-1/2 flex-col gap-2">
      <button
        type="button"
        onClick={startGoogle}
        className="rounded-lg bg-white px-5 py-3 font-semibold text-slate-900 shadow-lg"
      >
        Continue with Google
      </button>
      {error ? <p className="rounded bg-red-100 px-3 py-2 text-xs text-red-800">{error}</p> : null}
    </div>
  );
}
