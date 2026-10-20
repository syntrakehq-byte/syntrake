import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { resolveRequestSiteLang } from "@/lib/i18n/requestSiteLang";
import { isR1AccountReadEnabled } from "@/investing-core/server/accountsReadHttp";
import AccountDiscoveryClient from "./AccountDiscoveryClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Investing Accounts | Syntrake",
  robots: { index: false, follow: false, noarchive: true },
};

/**
 * R1-B is a guarded read-only account discovery screen.
 * No production Investing page or financial data is exposed. This guard must
 * remain aligned with the API gate; rendering this screen never grants access.
 */
export default async function InvestingAccountsPage({
  searchParams,
}: {
  searchParams?: Promise<{ lang?: string }> | { lang?: string };
}) {
  if (!isR1AccountReadEnabled(process.env)) notFound();

  const session = await auth();
  if (!session.userId || !session.sessionId) {
    redirect("/sign-in?redirect_url=%2Finvesting%2Faccounts");
  }
  const language = await resolveRequestSiteLang(await searchParams);
  return <AccountDiscoveryClient lang={language} />;
}
