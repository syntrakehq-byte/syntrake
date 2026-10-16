import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import TrackedLink from "@/components/TrackedLink";

export const metadata: Metadata = { title: "Syntrake — Clearer decisions", description: "Turn complexity into your next clear step with Syntrake." };

const faqs = [
  ["What is Syntrake?", "Syntrake is a calm decision-support workspace for turning complex information into clear next steps."],
  ["Does Syntrake execute transactions or hold money?", "No. Syntrake does not custody funds or place orders. External actions remain under your control."],
  ["Can I try it before subscribing?", "Yes. Start free and see whether Syntrake fits your workflow before choosing a paid plan."],
  ["How are accounts and payments handled?", "Accounts are handled by Clerk and subscriptions are handled securely through Stripe."],
];

export default async function HomePage() {
  const { userId } = await auth();
  if (userId) redirect("/start");

  return (
    <main className="min-h-screen bg-[#06101f] text-white">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-10">
        <Link href="/" className="text-xl font-semibold tracking-tight">Syntrake</Link>
        <nav className="flex items-center gap-4 text-sm text-white/70">
          <a href="#how-it-works" className="hidden transition hover:text-white sm:inline">How it works</a>
          <a href="#faq" className="hidden transition hover:text-white sm:inline">FAQ</a>
          <Link href="/pricing" className="transition hover:text-white">Pricing</Link>
          <LanguageSwitcher />
          <Link href="/sign-in" className="rounded-full border border-white/15 px-4 py-2 text-white transition hover:border-white/35">Sign in</Link>
        </nav>
      </header>

      <section className="mx-auto max-w-7xl px-6 pb-24 pt-16 lg:px-10 lg:pt-28">
        <div className="max-w-4xl">
          <p className="mb-6 text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">A calmer operating system for better decisions</p>
          <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight sm:text-7xl">Turn complexity into your next clear step.</h1>
          <p className="mt-8 max-w-2xl text-lg leading-8 text-white/65">Syntrake brings context, reasoning and practical guidance into one clear workspace — so you can act with confidence without losing control.</p>
          <div className="mt-10 flex flex-wrap gap-4">
            <TrackedLink href="/sign-up" eventName="home_primary_signup" className="rounded-full bg-cyan-300 px-6 py-3 font-semibold text-slate-950 transition hover:bg-cyan-200">Start free</TrackedLink>
            <Link href="/how-it-works" className="rounded-full border border-white/15 px-6 py-3 font-semibold text-white transition hover:border-white/35">See how it works</Link>
          </div>
        </div>
        <div className="mt-20 grid gap-4 md:grid-cols-3">
          {[["Clarity", "See the important context without the noise."], ["Explainability", "Understand why a recommendation makes sense."], ["Control", "Keep the final decision and every external action with you."]].map(([title, copy]) => (
            <div key={title} className="rounded-3xl border border-white/10 bg-white/[0.04] p-6"><h2 className="text-lg font-semibold">{title}</h2><p className="mt-3 leading-7 text-white/60">{copy}</p></div>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="border-y border-white/10 bg-white/[0.025] px-6 py-20 lg:px-10">
        <div className="mx-auto max-w-7xl"><p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">How it works</p><div className="mt-8 grid gap-8 md:grid-cols-3">
          {[["01", "Bring your context", "Start with the question, goal or situation that needs a decision."], ["02", "Get a clear view", "Syntrake organizes relevant information and explains the trade-offs."], ["03", "Choose your next step", "Move forward with a practical action, or a deliberate decision to wait."]].map(([number, title, copy]) => <div key={number}><span className="text-sm text-cyan-300">{number}</span><h2 className="mt-3 text-2xl font-semibold">{title}</h2><p className="mt-3 leading-7 text-white/60">{copy}</p></div>)}
        </div></div>
      </section>

      <section id="faq" className="mx-auto max-w-4xl px-6 py-20 lg:px-10"><p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">FAQ</p><div className="mt-8 divide-y divide-white/10">
        {faqs.map(([question, answer]) => <details key={question} className="group py-6"><summary className="cursor-pointer list-none pr-8 text-lg font-medium group-open:text-cyan-200">{question}</summary><p className="mt-3 max-w-2xl leading-7 text-white/60">{answer}</p></details>)}
      </div></section>

      <footer className="border-t border-white/10 px-6 py-8 lg:px-10"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 text-sm text-white/50"><span>© {new Date().getFullYear()} Syntrake</span><div className="flex gap-4"><Link href="/pricing">Pricing</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/trust">Trust</Link></div></div></footer>
    </main>
  );
}
