import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isOwnerUserId } from "@/lib/signalcore/owner";
import { normalizeMode } from "@/lib/signalcore/modes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRACKED_EVENTS = [
  "paywall_open",
  "trial_start_click",
  "trial_started",
  "trial_blocked_used",
  "checkout_start",
  "checkout_session_created",
  "paid_activated",
  "portal_open",
] as const;

type TrackedEvent = (typeof TRACKED_EVENTS)[number];

function clampInt(v: unknown, min: number, max: number, fallback: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function pct(a: number, b: number) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((a / b) * 100)));
}

function isAnonymousVisitorId(value: string) {
  return value.startsWith("anon:");
}

function intersectCount(a: Set<string>, b: Set<string>) {
  const smaller = a.size <= b.size ? a : b;
  const larger = smaller === a ? b : a;
  let count = 0;
  for (const value of smaller) {
    if (larger.has(value)) count += 1;
  }
  return count;
}

function unionSet(...sets: Array<Set<string>>) {
  const out = new Set<string>();
  for (const set of sets) {
    for (const value of set) out.add(value);
  }
  return out;
}

function dayKeyUTCFromIso(v: string | null | undefined) {
  if (!v) return null;
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return null;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function eventFromRow(row: any) {
  const details = row?.details && typeof row.details === "object" ? row.details : {};
  const detailEvent = String((details as any)?.event || "")
    .toLowerCase()
    .trim();
  if (detailEvent) return detailEvent;
  const title = String(row?.title || "")
    .toLowerCase()
    .trim();
  if (title.startsWith("conversion:")) {
    return title.replace("conversion:", "").trim();
  }
  return null;
}

function blankCountMap() {
  return {
    paywall_open: 0,
    trial_start_click: 0,
    trial_started: 0,
    trial_blocked_used: 0,
    checkout_start: 0,
    checkout_session_created: 0,
    paid_activated: 0,
    portal_open: 0,
  };
}

function asTrackedEvent(v: string | null): TrackedEvent | null {
  if (!v) return null;
  const key = String(v).toLowerCase().trim() as TrackedEvent;
  return (TRACKED_EVENTS as readonly string[]).includes(key) ? key : null;
}

export async function GET(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    if (!isOwnerUserId(userId)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

    const url = new URL(req.url);
    const days = clampInt(url.searchParams.get("days"), 1, 365, 30);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("journal_entries")
      .select("id,user_id,mode,title,details,created_at")
      .eq("type", "conversion_event")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(10000);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const rows = Array.isArray(data) ? data : [];
    const totalCounts = blankCountMap();
    const signedUsers = new Set<string>();
    const anonymousVisitors = new Set<string>();
    const anonymousPaywallUsers = new Set<string>();
    const byDay = new Map<string, ReturnType<typeof blankCountMap> & { day: string }>();
    const byMode = new Map<string, ReturnType<typeof blankCountMap> & { mode: string; users: Set<string> }>();
    const sourceCounts = new Map<string, number>();

    const funnelUsers = {
      paywall_open: new Set<string>(),
      trial_start_click: new Set<string>(),
      trial_started: new Set<string>(),
      trial_blocked_used: new Set<string>(),
      checkout_start: new Set<string>(),
      checkout_session_created: new Set<string>(),
      paid_activated: new Set<string>(),
      portal_open: new Set<string>(),
    };

    for (const row of rows) {
      const uid = String((row as any)?.user_id || "").trim();
      if (!uid) continue;
      const anonymous = isAnonymousVisitorId(uid);
      if (anonymous) anonymousVisitors.add(uid);
      else signedUsers.add(uid);

      const ev = asTrackedEvent(eventFromRow(row));
      if (!ev) continue;

      const eventKey = ev as keyof typeof totalCounts;
      totalCounts[eventKey] += 1;
      if (anonymous) {
        if (ev === "paywall_open") anonymousPaywallUsers.add(uid);
      } else {
        funnelUsers[eventKey].add(uid);
      }

      const details = (row as any)?.details && typeof (row as any).details === "object" ? (row as any).details : {};
      const source = String((details as any)?.source || "").trim();
      if (source) {
        sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
      }

      const day = dayKeyUTCFromIso((row as any)?.created_at);
      if (day) {
        const prev = byDay.get(day) || { day, ...blankCountMap() };
        prev[eventKey] += 1;
        byDay.set(day, prev);
      }

      if (!anonymous) {
        const mode = normalizeMode((row as any)?.mode || "investing");
        const modeEntry = byMode.get(mode) || { mode, users: new Set<string>(), ...blankCountMap() };
        modeEntry[eventKey] += 1;
        modeEntry.users.add(uid);
        byMode.set(mode, modeEntry);
      }
    }

    const checkoutIntentUsers = unionSet(funnelUsers.checkout_start, funnelUsers.checkout_session_created);
    const paidFromCheckoutUsers = intersectCount(funnelUsers.paid_activated, checkoutIntentUsers);
    const paidFromTrialUsers = intersectCount(funnelUsers.paid_activated, funnelUsers.trial_started);
    const overallPaidUsers = intersectCount(funnelUsers.paid_activated, funnelUsers.paywall_open);
    const uniqueFunnel = {
      paywallOpenUsers: funnelUsers.paywall_open.size,
      trialStartClickUsers: funnelUsers.trial_start_click.size,
      trialStartedUsers: funnelUsers.trial_started.size,
      trialBlockedUsers: funnelUsers.trial_blocked_used.size,
      checkoutStartUsers: funnelUsers.checkout_start.size,
      checkoutSessionUsers: funnelUsers.checkout_session_created.size,
      paidActivatedUsers: funnelUsers.paid_activated.size,
      portalOpenUsers: funnelUsers.portal_open.size,
    };

    const rates = {
      trialClickRate: pct(uniqueFunnel.trialStartClickUsers, uniqueFunnel.paywallOpenUsers),
      trialStartRate: pct(uniqueFunnel.trialStartedUsers, uniqueFunnel.trialStartClickUsers),
      checkoutIntentRate: pct(uniqueFunnel.checkoutStartUsers, uniqueFunnel.paywallOpenUsers),
      paidFromCheckoutRate: pct(paidFromCheckoutUsers, checkoutIntentUsers.size),
      paidFromTrialRate: pct(paidFromTrialUsers, uniqueFunnel.trialStartedUsers),
      overallPaidRate: pct(overallPaidUsers, uniqueFunnel.paywallOpenUsers),
    };

    const trend = Array.from(byDay.values())
      .sort((a, b) => a.day.localeCompare(b.day))
      .slice(-days);

    const modes = Array.from(byMode.values())
      .map((m) => ({
        mode: m.mode,
        users: m.users.size,
        counts: {
          paywallOpen: m.paywall_open,
          trialStartClick: m.trial_start_click,
          trialStarted: m.trial_started,
          trialBlockedUsed: m.trial_blocked_used,
          checkoutStart: m.checkout_start,
          checkoutSessionCreated: m.checkout_session_created,
          paidActivated: m.paid_activated,
          portalOpen: m.portal_open,
        },
      }))
      .sort((a, b) => b.counts.paywallOpen - a.counts.paywallOpen);

    const topSources = Array.from(sourceCounts.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    return NextResponse.json(
      {
        ok: true,
        days,
        sampleSize: rows.length,
        uniqueUsers: signedUsers.size,
        anonymousVisitors: anonymousVisitors.size,
        counts: {
          paywallOpen: totalCounts.paywall_open,
          trialStartClick: totalCounts.trial_start_click,
          trialStarted: totalCounts.trial_started,
          trialBlockedUsed: totalCounts.trial_blocked_used,
          checkoutStart: totalCounts.checkout_start,
          checkoutSessionCreated: totalCounts.checkout_session_created,
          paidActivated: totalCounts.paid_activated,
          portalOpen: totalCounts.portal_open,
        },
        uniqueFunnel,
        attributedUsers: {
          paidFromCheckoutUsers,
          paidFromTrialUsers,
          overallPaidUsers,
          anonymousPaywallOpenUsers: anonymousPaywallUsers.size,
        },
        rates,
        trend,
        modes,
        topSources,
        updatedAt: new Date().toISOString(),
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "conversion_global_failed", message: e?.message || "Unknown" },
      { status: 500 }
    );
  }
}

