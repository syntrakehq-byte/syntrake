import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { UpcomingArea } from "@/components/workspace/UpcomingArea";
import { resolveRequestSiteLang } from "@/lib/i18n/requestSiteLang";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Market Data | Syntrake",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function Page({
  searchParams,
}: { searchParams?: Promise<{lang?:string}> | {lang?:string} }) {
  const session = await auth();
  if (!session.userId || !session.sessionId) {
    redirect("/sign-in?redirect_url=%2Fmarkets");
  }
  const lang = await resolveRequestSiteLang(await searchParams);
  return <UpcomingArea lang={lang} area="markets" />;
}
