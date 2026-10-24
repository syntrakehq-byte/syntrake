import type {Metadata} from "next";
import {auth} from "@clerk/nextjs/server";
import {notFound,redirect} from "next/navigation";
import {resolveRequestSiteLang} from "@/lib/i18n/requestSiteLang";
import {isR2DImportReady} from "@/investing-core/server/importPreviewRuntime";
import PortfolioImportClient from "./PortfolioImportClient";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Investing — Declared import | Syntrake",
  robots:{index:false,follow:false,noarchive:true}};
export default async function PortfolioImportPage({searchParams}:{
  searchParams?:Promise<{lang?:string}>|{lang?:string};
}){
  if(!isR2DImportReady(process.env))notFound();
  const session=await auth();
  if(!session.userId||!session.sessionId)
    redirect("/sign-in?redirect_url=%2Finvesting%2Fimport");
  const lang=await resolveRequestSiteLang(await searchParams);
  return <PortfolioImportClient lang={lang}/>;
}
