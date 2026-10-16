import Stripe from "stripe";
import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  sessionId?: string;
};

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
    const meta = user?.publicMetadata;
    return meta && typeof meta === "object" ? (meta as ClerkMeta) : {};
  } catch {
    return {};
  }
}

async function updatePaidState(params: {
  userId: string;
  isPaid: boolean;
  stripeCustomerId?: unknown;
  stripeSubscriptionId?: unknown;
  stripeStatus?: unknown;
  billingCycle?: unknown;
  ref?: unknown;
  utmSource?: unknown;
  utmMedium?: unknown;
  utmCampaign?: unknown;
  utmContent?: unknown;
  utmTerm?: unknown;
}) {
  const client = await getClerk();
  const current = await readPublicMetadata(client, params.userId);
  const previousPaid = Boolean((current as any)?.isPaid);
  const nowIso = new Date().toISOString();

  const next: ClerkMeta = {
    ...current,
    isPaid: Boolean(params.isPaid),
    paidStatus: toCleanString(params.stripeStatus) || (params.isPaid ? "active" : "inactive"),
    paidSource: "stripe",
    lastStripeEvent: "checkout.session.sync",
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

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return json(401, { ok: false, error: "unauthorized" });

    const body = (await req.json().catch(() => ({}))) as Body;
    const sessionId = toCleanString(body?.sessionId, 200);
    if (!sessionId) return json(400, { ok: false, error: "missing_session_id" });

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return json(500, { ok: false, error: "missing_STRIPE_SECRET_KEY" });

    const stripe = new Stripe(stripeKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });

    const sessionUserId =
      toCleanString(session.client_reference_id) || toCleanString(session.metadata?.clerkUserId);
    if (!sessionUserId || sessionUserId !== userId) {
      return json(403, { ok: false, error: "session_user_mismatch" });
    }

    let stripeStatus: string | null = null;
    let subId: string | null = null;

    if (typeof session.subscription === "string") {
      subId = session.subscription;
      const sub = await stripe.subscriptions.retrieve(subId);
      stripeStatus = sub.status;
    } else if (session.subscription && typeof session.subscription === "object") {
      subId = toCleanString((session.subscription as Stripe.Subscription).id);
      stripeStatus = toCleanString((session.subscription as Stripe.Subscription).status);
    }

    const isPaid =
      stripeStatus != null
        ? isPaidStatus(stripeStatus as Stripe.Subscription.Status)
        : session.payment_status === "paid" || session.status === "complete";

    const transition = await updatePaidState({
      userId,
      isPaid,
      stripeCustomerId: session.customer,
      stripeSubscriptionId: subId,
      stripeStatus: stripeStatus || session.payment_status || session.status,
      billingCycle: session.metadata?.billingCycle,
      ref: session.metadata?.ref,
      utmSource: session.metadata?.utm_source,
      utmMedium: session.metadata?.utm_medium,
      utmCampaign: session.metadata?.utm_campaign,
      utmContent: session.metadata?.utm_content,
      utmTerm: session.metadata?.utm_term,
    });

    return json(200, {
      ok: true,
      isPaid,
      status: stripeStatus || session.payment_status || session.status,
    });
  } catch (e: any) {
    return json(500, { ok: false, error: "sync_failed", message: e?.message ?? "Unknown" });
  }
}
