import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { resolveRequestSiteLang } from "@/lib/i18n/requestSiteLang";
import { isR2COperationalReady } from "@/investing-core/server/onboardingTransport";
import InvestingOnboardingClient from "./InvestingOnboardingClient";
import { isR2C4PrivateWriteReady } from "@/investing-core/server/firstPortfolioPreviewHttp";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const metadata:Metadata={
 title:"Investing Onboarding | Syntrake",
 robots:{index:false,follow:false,noarchive:true},
};
export default async function InvestingStartPage({
 searchParams,
}:{searchParams?:Promise<{lang?:string}>|{lang?:string}}){
 if(!isR2COperationalReady(process.env))notFound();
 const session=await auth();
 if(!session.userId||!session.sessionId)
   redirect("/sign-in?redirect_url=%2Finvesting%2Fstart");
 const lang=await resolveRequestSiteLang(await searchParams);
 return <InvestingOnboardingClient lang={lang} canCreateFirstPortfolio={isR2C4PrivateWriteReady(process.env)}/>;
}
