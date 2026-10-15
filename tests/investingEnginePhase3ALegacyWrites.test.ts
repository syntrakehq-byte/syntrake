import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  activeMode: "investing" as "investing" | "trading",
  tableCalls: [] as string[],
  writes: [] as Array<{ table: string; operation: string }>,
}));
const authState = vi.hoisted(() => ({ userId: "legacy_user" as string | null }));
const mocks = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
  resolveModeAccess: vi.fn(),
  getQuotes: vi.fn(),
  writeEngineEvent: vi.fn(),
}));

class TableBuilder {
  private operation = "select";

  constructor(private readonly table: string) {}

  select() {
    this.operation = "select";
    return this;
  }

  eq() {
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  update() {
    this.operation = "update";
    state.writes.push({ table: this.table, operation: "update" });
    return this;
  }

  delete() {
    this.operation = "delete";
    state.writes.push({ table: this.table, operation: "delete" });
    return this;
  }

  async insert() {
    state.writes.push({ table: this.table, operation: "insert" });
    return { data: null, error: null };
  }

  async maybeSingle() {
    if (this.table !== "user_settings") return { data: null, error: null };
    return { data: { active_mode: state.activeMode }, error: null };
  }

  private async execute() {
    if (this.operation === "select") return { data: [], error: null };
    return { data: null, error: null };
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }
}

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: authState.userId })),
}));

vi.mock("@/lib/auth/requestUser", () => ({
  getRequestUserId: vi.fn(async () => authState.userId),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
}));

vi.mock("@/lib/signalcore/modeAccess", () => ({
  resolveModeAccess: mocks.resolveModeAccess,
}));

vi.mock("@/lib/market/quotes", () => ({
  getQuotes: mocks.getQuotes,
}));

vi.mock("@/lib/engine/events", () => ({
  createExecutionId: vi.fn(() => "fix_test"),
  writeEngineEvent: mocks.writeEngineEvent,
}));

import { GET as portfolioGet, POST as portfolioPost, DELETE as portfolioDelete } from "@/app/api/portfolio-items/route";
import { POST as portfolioResetPost } from "@/app/api/portfolio-items/reset/route";
import { POST as fixNowPost } from "@/app/api/fix-now/run/route";

function request(path: string, body?: Record<string, unknown>) {
  return new Request(`http://localhost${path}`, {
    method: body === undefined ? "DELETE" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function getRequest(path: string) {
  return new Request(`http://localhost${path}`, { method: "GET" });
}

describe("FASE 3A legacy Investing write boundaries", () => {
  beforeEach(() => {
    state.activeMode = "investing";
    state.tableCalls.length = 0;
    state.writes.length = 0;
    authState.userId = "legacy_user";
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getSupabaseAdmin.mockImplementation(() => ({
      from(table: string) {
        state.tableCalls.push(table);
        return new TableBuilder(table);
      },
    }));
    mocks.resolveModeAccess.mockImplementation(async ({ requestedMode }) => ({
      ok: true,
      mode: requestedMode,
      allowedMode: requestedMode,
      hasProAccess: true,
      status: 200,
      error: null,
    }));
  });

  it.each([
    ["portfolio GET", () => portfolioGet(getRequest("/api/portfolio-items?mode=investing"))],
    ["portfolio POST", () => portfolioPost(request("/api/portfolio-items", { items: [{ symbol: "SPY", qty: 1 }] }))],
    ["portfolio DELETE", () => portfolioDelete(request("/api/portfolio-items?id=item_1"))],
    ["portfolio reset", () => portfolioResetPost(request("/api/portfolio-items/reset", { items: [] }))],
    ["FixNow", () => fixNowPost(request("/api/fix-now/run", { leakKey: "no_holdings" }))],
  ])("blocks %s before any legacy read/write or false execution event", async (_name, invoke) => {
    const response = await invoke();
    const payload = await response.json();

    expect(response.status).toBe(410);
    expect(payload).toMatchObject({
      ok: false,
      error: "investing_shared_broker_sync_blocked",
      mode: "investing",
    });
    expect(state.tableCalls).toEqual(["user_settings"]);
    expect(state.writes).toEqual([]);
    expect(mocks.getQuotes).not.toHaveBeenCalled();
    expect(mocks.writeEngineEvent).not.toHaveBeenCalled();
  });

  it("blocks a Trading spoof while the effective stored mode is Investing", async () => {
    const response = await portfolioPost(
      request("/api/portfolio-items", { mode: "trading", items: [{ symbol: "SPY", qty: 1 }] }),
    );
    const payload = await response.json();

    expect(payload).toMatchObject({ error: "investing_shared_broker_sync_blocked", spoofed: true });
    expect(state.writes).toEqual([]);
  });

  it("preserves a portfolio_items write for the effective Trading mode", async () => {
    state.activeMode = "trading";
    const response = await portfolioPost(
      request("/api/portfolio-items", { items: [{ symbol: "SPY", qty: 1, valueEur: 500 }] }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ ok: true, mode: "trading", inserted: 1, updated: 0 });
    expect(state.writes).toContainEqual({ table: "portfolio_items", operation: "insert" });
  });
});
