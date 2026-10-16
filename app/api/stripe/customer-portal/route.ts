import Stripe from "stripe";
import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { resolvePortalReturnUrl, toCleanString } from "@/lib/server/urlSafety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  returnUrl?: string;
};

function cleanEnv(raw?: string) {
  if (!raw) return "";
  return raw.trim().replace(/^["']+|["']+$/g, "").trim();
}

function toUserEmail(user: any) {
  const primary = user?.primaryEmailAddress?.emailAddress;
  if (typeof primary === "string" && primary.trim().length > 0) return primary.trim().toLowerCase();
  const first = Array.isArray(user?.emailAddresses) ? user.emailAddresses[0]?.emailAddress : null;
  if (typeof first === "string" && first.trim().length > 0) return first.trim().toLowerCase();
  return null;
}

function extractStripeCustomerId(v: unknown) {
  if (typeof v === "string") {
    const s = v.trim();
    if (s.startsWith("cus_")) return s;
    return null;
  }
  if (v && typeof v === "object" && "id" in (v as any)) {
    return extractStripeCustomerId((v as any).id);
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const stripeKey = cleanEnv(process.env.STRIPE_SECRET_KEY);
    if (!stripeKey) return NextResponse.json({ error: "Missing STRIPE_SECRET_KEY" }, { status: 500 });

    const client: any =
      typeof clerkClient === "function" ? await (clerkClient as any)() : clerkClient;
    const user = await client.users.getUser(userId);
    const meta = user?.publicMetadata && typeof user.publicMetadata === "object" ? (user.publicMetadata as any) : {};
    const email = toUserEmail(user);
    let stripeCustomerId = extractStripeCustomerId(meta?.stripeCustomerId);

    const stripe = new Stripe(stripeKey, { maxNetworkRetries: 2, timeout: 20_000 });

    if (!stripeCustomerId && email) {
      const found = await stripe.customers.list({ email, limit: 5 });
      const match = found.data.find((c: any) => typeof c?.id === "string" && c.id.startsWith("cus_"));
      stripeCustomerId = match?.id ? String(match.id) : null;
    }

    if (!stripeCustomerId) {
      return NextResponse.json(
        {
          error: "No Stripe customer found for this account.",
          message: "Open pricing and start checkout once. We will then attach billing to your account.",
        },
        { status: 400 }
      );
    }

    const stored = toCleanString(meta?.stripeCustomerId, 180);
    if (stored !== stripeCustomerId) {
      await client.users.updateUser(userId, {
        publicMetadata: {
          ...meta,
          stripeCustomerId,
          lastStripeEvent: "customer_portal_recovered_customer",
          lastStripeEventAt: new Date().toISOString(),
        },
      });
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: resolvePortalReturnUrl(body?.returnUrl, process.env.NEXT_PUBLIC_APP_URL, req.url),
    });

    if (!session.url) return NextResponse.json({ error: "Could not create portal session." }, { status: 500 });
    return NextResponse.json({ ok: true, url: session.url }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: "stripe_portal_failed", message: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
