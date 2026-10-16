"use client";

import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-border-soft bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm font-semibold text-ink-900">Syntrake</Link>
          <SignedOut>
            <nav className="flex items-center gap-4">
              <Link href="/how-it-works" className="text-xs opacity-70 hover:opacity-100">How it works</Link>
              <Link href="/pricing" className="text-xs opacity-70 hover:opacity-100">Pricing</Link>
              <Link href="/android" className="text-xs opacity-70 hover:opacity-100">Android App</Link>
            </nav>
          </SignedOut>
          <SignedIn>
            <Link href="/start" className="text-xs font-semibold opacity-90 hover:opacity-100">Start</Link>
          </SignedIn>
        </div>
        <div className="flex items-center gap-3">
          <SignedOut>
            <Link href="/start" className="rounded-2xl border border-border-soft bg-white px-4 py-2 text-xs font-semibold text-ink-900 hover:bg-canvas-50">Get started</Link>
            <Link href="/sign-in" className="rounded-2xl bg-ink-900 px-4 py-2 text-xs font-semibold text-white hover:opacity-90">Sign in</Link>
          </SignedOut>
          <SignedIn><UserButton afterSignOutUrl="/" /></SignedIn>
        </div>
      </div>
    </header>
  );
}
