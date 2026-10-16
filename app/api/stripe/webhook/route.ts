import Stripe from "stripe";
import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ClerkMeta = Record<string, unknown>;

function json(status: number, body: unknown) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function toCleanString(v: unknown, max = 180) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.slice(0, max);
}

function isPaidStatus(status: Stripe.Subscription.Status | null | undefined) {
  if (!status) return false;
  return status === "active" || status === "trialing" || status === "past_due";
}

async function getClerk() {
  return typeof clerkClient === "function" ? await (clerkClient as any)() : clerkClient;
}

async function readPublicMetadata(client: any, userId: string): Promise<ClerkMeta> {
  try {
    const user = await client.users.getUser(userId);
    const meta = user.publicMetadata;
    return meta && typeof meta === "object" ? (meta as ClerkMeta) : {};
  } catch {
    return {};
  }
}

async function updatePaidState(params: {
  userId: string;
  isPaid: boolean;
  eventType: string;
  stripeCustomerId: unknown;
  stripeSubscriptionId: unknown;
  stripeStatus: unknown;
  billingCycle: unknown;
  ref: unknown;
  utmSource: unknown;
  utmMedium: unknown;
  utmCampaign: unknown;
  utmContent: unknown;
  utmTerm: unknown;
}) {
  const client = await getClerk();
  const current = await readPublicMetadata(client, params.userId);
  const previousPaid = Boolean((current as any).isPaid);

  const nowIso = new Date().toISOString();
  const next: ClerkMeta = {
    ...current,
    isPaid: Boolean(params.isPaid),
    paidStatus: toCleanString(params.stripeStatus) || (params.isPaid ? "active" : "inactive"),
    paidSource: "stripe",
    lastStripeEvent: params.eventType,
    lastStripeEventAt: nowIso,
    stripeCustomerId: toCleanString(params.stripeCustomerId),
    stripeSubscriptionId: toCleanString(params.stripeSubscriptionId),
    paidBillingCycle: toCleanString(params.billingCycle),
    referralCode: toCleanString(params.ref),
    acquisitionSource: toCleanString(params.utmSource),
    acquisitionMedium: toCleanString(params.utmMedium),
    acquisitionCampaign: toCleanString(params.utmCampaign),
    acquisitionContent: toCleanString(params.utmContent),
    acquisitionTerm: toCleanString(params.utmTerm),
  };

  if (params.isPaid) {
    next.paidAt = nowIso;
  } else {
    next.paidCancelledAt = nowIso;
  }

  await client.users.updateUser(params.userId, { publicMetadata: next });
  return { previousPaid, nextPaid: Boolean(params.isPaid) };
}

function pickUserIdFromCheckout(session: Stripe.Checkout.Session) {
  const a = toCleanString(session.client_reference_id);
  const b = toCleanString(session.metadata.clerkUserId);
  return a || b;
}

function pickUserIdFromSubscription(sub: Stripe.Subscription) {
  return toCleanString(sub.metadata.clerkUserId);
}

export async function POST(req: Request) {
  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const stripeKey = process.env.STRIPE_SECRET_KEY;

    if (!stripeKey) return json(500, { error: "missing_STRIPE_SECRET_KEY" });
    if (!webhookSecret) return json(500, { error: "missing_STRIPE_WEBHOOK_SECRET" });

    const signature = req.headers.get("stripe-signature");
    if (!signature) return json(400, { error: "missing_stripe_signature" });

    const stripe = new Stripe(stripeKey);
    const rawBody = await req.text();

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err: any) {
      return json(400, { error: "invalid_signature", message: err.message || "Unknown" });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = pickUserIdFromCheckout(session);
        if (!userId) break;

        const transition = await updatePaidState({
          userId,
          isPaid: true,
          eventType: event.type,
          stripeCustomerId: session.customer,
          stripeSubscriptionId: session.subscription,
          stripeStatus: "active",
          billingCycle: session.metadata.billingCycle,
          ref: session.metadata.ref,
          utmSource: session.metadata.utm_source,
          utmMedium: session.metadata.utm_medium,
          utmCampaign: session.metadata.utm_campaign,
          utmContent: session.metadata.utm_content,
          utmTerm: session.metadata.utm_term,
        });
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = pickUserIdFromSubscription(sub);
        if (!userId) break;

        const nextPaid = isPaidStatus(sub.status);
        const transition = await updatePaidState({
          userId,
          isPaid: nextPaid,
          eventType: event.type,
          stripeCustomerId: sub.customer,
          stripeSubscriptionId: sub.id,
          stripeStatus: sub.status,
          billingCycle: sub.metadata.billingCycle,
          ref: sub.metadata.ref,
          utmSource: sub.metadata.utm_source,
          utmMedium: sub.metadata.utm_medium,
          utmCampaign: sub.metadata.utm_campaign,
          utmContent: sub.metadata.utm_content,
          utmTerm: sub.metadata.utm_term,
        });
        break;
      }

      case "invoice.payment_failed":
      case "invoice.payment_succeeded":
      default:
        break;
    }

    return json(200, { received: true });
  } catch (e: any) {
    return json(500, { error: "stripe_webhook_failed", message: e.message || "Unknown" });
  }
}
