import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { SITE_DETECTED_LANG_COOKIE_KEY, resolveCountrySiteLang } from "@/lib/i18n/siteLanguage";

function attachDetectedLanguageCookie(req: NextRequest, res: NextResponse) {
  const country = req.headers.get("x-vercel-ip-country") ?? req.headers.get("cf-ipcountry");
  const detected = resolveCountrySiteLang(country);
  if (!detected) return res;
  res.cookies.set(SITE_DETECTED_LANG_COOKIE_KEY, detected, {
    httpOnly: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return res;
}

export default clerkMiddleware((_auth, req) => {
  const host = req.nextUrl.host.trim().toLowerCase();
  if (host === "syntrake.com") {
    const canonicalUrl = new URL(req.url);
    canonicalUrl.protocol = "https:";
    canonicalUrl.host = "www.syntrake.com";
    return NextResponse.redirect(canonicalUrl, 308);
  }
  return attachDetectedLanguageCookie(req, NextResponse.next());
}, { proxyUrl: "/__clerk" });

export const config = {
  matcher: [
    "/__clerk/:path*",
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js|map)$).*)",
    "/(api|trpc)(.*)",
  ],
};
