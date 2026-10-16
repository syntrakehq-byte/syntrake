import Stripe from "stripe";
import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { resolveAppUrl } from "@/lib/server/urlSafety";
import { resolvePublicPricing } from "@/lib/pricing";
import { selectStripeCheckoutPrice, type BillingCycle } from "@/lib/server/stripePriceCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckoutBody = {
  variant?: "A" | "B";
  billingCycle?: BillingCycle;
  campaign?: {
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_content?: string;
    utm_term?: string;
    ref?: string;
  };
};

function cleanEnv(raw?: string) {
  if (!raw) return "";
  return raw.trim().replace(/^["']+|["']+$/g, "").trim();
}

function readEnv(name: string) {
  return cleanEnv(process.env[name]);
}

function safeMeta(v: unknown, max = 120) {
  const s = String(v ?? "").trim();
  if (!s) return undefined;
  return s.slice(0, max);
}

function compactMetadata(input: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string] => {
      const value = entry[1];
      return typeof value === "string" && value.length > 0;
    })
  );
}

async function pickLivePriceId(billingCycle: BillingCycle) {
  try {
    const pricing = await resolvePublicPricing();
    const tier = pricing?.display?.tier === "standard" ? "standard" : "early";
    const selected = selectStripeCheckoutPrice({ billingCycle, displayTier: tier });
    if (!selected.ok) {
      return { priceId: "", tier: null as null | "early" | "standard", reason: selected.error, expected: selected.expectedEnvNames };
    }
    return { priceId: selected.priceId, tier, reason: "pricing_resolver" as const, expected: selected.expectedEnvNames };
  } catch {
    const selected = selectStripeCheckoutPrice({ billingCycle, displayTier: "early" });
    if (!selected.ok) {
      return { priceId: "", tier: null as null | "early" | "standard", reason: selected.error, expected: selected.expectedEnvNames };
    }
    return { priceId: selected.priceId, tier: "early" as const, reason: "fallback_early" as const, expected: selected.expectedEnvNames };
  }
}

async function getSignedInUserEmail(userId: string) {
  const client = typeof clerkClient === "function" ? await (clerkClient as any)() : clerkClient;
  const user = await client.users.getUser(userId);
  const primary = user?.primaryEmailAddress?.emailAddress;
  if (typeof primary === "string" && primary.trim().length > 0) return primary.trim();
  const first = Array.isArray(user?.emailAddresses) ? user.emailAddresses[0]?.emailAddress : null;
  if (typeof first === "string" && first.trim().length > 0) return first.trim();
  return null;
}

export async function POST(req: Request) {
  try {
    const authCtx = await auth();
    const userId = authCtx?.userId ? String(authCtx.userId) : "";
    if (!userId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body: CheckoutBody = await req.json().catch(() => ({}));
    const email = await getSignedInUserEmail(userId);
    const variant: "A" | "B" = body?.variant === "B" ? "B" : "A";
    const billingCycle: BillingCycle = body?.billingCycle === "annual" ? "annual" : "monthly";
    const campaign = body?.campaign ?? {};

    const stripeKey = readEnv("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return NextResponse.json({ error: "Missing STRIPE_SECRET_KEY" }, { status: 500 });
    }
    const stripe = new Stripe(stripeKey, {
      maxNetworkRetries: 2,
      timeout: 20_000,
    });

    const selected = await pickLivePriceId(billingCycle);
    const priceId = selected.priceId;
    if (!priceId) {
      if (selected.reason === "annual_billing_unavailable") {
        return NextResponse.json(
          {
            error: "annual_billing_unavailable",
            message: "Annual billing is not configured yet. Use monthly billing for now.",
            expected: selected.expected,
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        {
          error: "Missing Stripe live price env vars",
          expected: selected.expected ?? ["STRIPE_PRICE_ID_EARLY", "STRIPE_PRICE_ID_STANDARD"],
        },
        { status: 500 }
      );
    }

    if (!email) {
      return NextResponse.json({ error: "Missing user email in Clerk profile" }, { status: 400 });
    }

    const appUrl = resolveAppUrl(process.env.NEXT_PUBLIC_APP_URL, req.url);
    const reqPath = (() => {
      try {
        return new URL(req.url).pathname;
      } catch {
        return "";
      }
    })();
    const isCreateCheckoutSessionAlias = reqPath.endsWith("/api/stripe/create-checkout-session");
    const successUrl = isCreateCheckoutSessionAlias
      ? new URL("/start?checkout=success", `${appUrl}/`).toString()
      : new URL(`/pricing?success=1&session_id={CHECKOUT_SESSION_ID}`, `${appUrl}/`).toString();
    const cancelUrl = isCreateCheckoutSessionAlias
      ? new URL("/pricing", `${appUrl}/`).toString()
      : new URL("/pricing?canceled=1", `${appUrl}/`).toString();

    const metadata = compactMetadata({
      clerkUserId: userId,
      variant,
      billingCycle,
      utm_source: safeMeta(campaign.utm_source),
      utm_medium: safeMeta(campaign.utm_medium),
      utm_campaign: safeMeta(campaign.utm_campaign),
      utm_content: safeMeta(campaign.utm_content),
      utm_term: safeMeta(campaign.utm_term),
      ref: safeMeta(campaign.ref),
    });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: userId,
      metadata,
      subscription_data: {
        metadata,
      },
    });

    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (e: unknown) {
    const err = e as any;
    const message = e instanceof Error ? e.message : "Checkout error";
    const debug = {
      type: err?.type || null,
      code: err?.code || err?.raw?.code || err?.cause?.code || null,
      statusCode: err?.statusCode || err?.rawStatusCode || null,
      requestId: err?.requestId || err?.raw?.requestId || null,
      cause: err?.cause?.message || null,
    };
    return NextResponse.json(
      { error: "stripe_checkout_failed", message, debug },
      { status: 500 }
    );
  }
}
