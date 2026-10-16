"use client";

import { useState } from "react";
import Link from "next/link";
import { SignInButton, SignedIn, SignedOut } from "@clerk/nextjs";

export default function PricingPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function startCheckout() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ billingCycle: "monthly", variant: "A" }),
      });
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error(data.error || "Checkout unavailable");
      window.location.assign(data.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Checkout unavailable");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#06101f] px-6 py-16 text-white">
      <div className="mx-auto max-w-5xl">
        <Link href="/" className="text-sm text-white/60 hover:text-white">← Syntrake</Link>
        <div className="mt-16 max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">Pricing</p>
          <h1 className="mt-5 text-5xl font-semibold tracking-tight">Simple access. Clear value.</h1>
          <p className="mt-6 text-lg leading-8 text-white/65">Start with the commercial experience and upgrade when Syntrake becomes part of your workflow.</p>
        </div>
        <div className="mt-14 grid gap-6 md:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-8">
            <h2 className="text-2xl font-semibold">Free</h2>
            <p className="mt-3 text-white/60">Explore the product and understand how Syntrake works.</p>
            <div className="mt-8 text-4xl font-semibold">€0</div>
            <Link href="/sign-up" className="mt-8 inline-flex rounded-full border border-white/20 px-5 py-3 font-semibold hover:border-white/40">Start free</Link>
          </div>
          <div className="rounded-3xl border border-cyan-300/40 bg-cyan-300/[0.08] p-8">
            <h2 className="text-2xl font-semibold">Syntrake Pro</h2>
            <p className="mt-3 text-white/60">More continuity, context and control for your workflow.</p>
            <div className="mt-8 text-4xl font-semibold">Monthly</div>
            <SignedIn>
              <button onClick={startCheckout} disabled={loading} className="mt-8 rounded-full bg-cyan-300 px-5 py-3 font-semibold text-slate-950 disabled:opacity-60">{loading ? "Opening checkout…" : "Continue to checkout"}</button>
            </SignedIn>
            <SignedOut><SignInButton mode="modal"><button className="mt-8 rounded-full bg-cyan-300 px-5 py-3 font-semibold text-slate-950">Sign in to subscribe</button></SignInButton></SignedOut>
            {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
          </div>
        </div>
        <p className="mt-10 text-sm text-white/45">Payments are processed securely by Stripe. Cancel from the customer portal at any time.</p>
      </div>
    </main>
  );
}
