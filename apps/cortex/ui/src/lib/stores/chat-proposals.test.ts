import { describe, expect, test } from "bun:test";
import { createChatProposalsStore, ProposalApplyError } from "./chat-proposals.js";
import type { ProposalWire } from "../proposal-view.js";

const P: ProposalWire = { id: "p1", action: "start-loop", args: { spec: "1h" }, summary: "loop", status: "proposed", createdAt: 1 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function mock(handler: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; method: string }[] = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    return handler(String(url), init);
  };
  return { f, calls };
}

describe("chat proposals store", () => {
  test("load caches proposals for the active session only", async () => {
    const { f } = mock(() => json({ proposals: [P] }));
    const s = createChatProposalsStore(f);
    s.reset("a");
    await s.load("a");
    expect(s.snapshot().proposals).toEqual([P]);
    s.reset("b");
    await s.load("a"); // stale response for a switched-away session
    expect(s.snapshot().proposals).toEqual([]);
  });

  test("apply merges the result and refreshes by effect", async () => {
    const seen: string[] = [];
    const { f, calls } = mock((u) => (u.endsWith("/apply") ? json({ proposal: { ...P, status: "applied" } }) : json({ proposals: [P] })));
    const s = createChatProposalsStore(f, (sid, eff) => void seen.push(`${sid}:${eff.join(",")}`));
    s.reset("a");
    await s.load("a");
    const out = await s.apply("a", "p1");
    expect(out.status).toBe("applied");
    expect(s.snapshot().proposals[0]!.status).toBe("applied");
    expect(s.snapshot().busy).toEqual([]);
    expect(calls.at(-1)).toEqual({ url: expect.stringContaining("/api/chat/sessions/a/proposals/p1/apply"), method: "POST" });
    expect(seen).toEqual(["a:schedules"]);
  });

  test("422 keeps the proposal proposed with its error and does not refresh", async () => {
    const seen: string[] = [];
    const { f } = mock((u) => (u.endsWith("/apply") ? json({ proposal: { ...P, error: "bad cron" }, error: "bad cron" }, 422) : json({ proposals: [P] })));
    const s = createChatProposalsStore(f, () => void seen.push("x"));
    s.reset("a");
    await s.load("a");
    const err = await s.apply("a", "p1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProposalApplyError);
    expect((err as ProposalApplyError).status).toBe(422);
    expect(s.snapshot().proposals[0]).toMatchObject({ status: "proposed", error: "bad cron" });
    expect(seen).toEqual([]);
    expect(s.snapshot().busy).toEqual([]);
  });

  test("409 resyncs from the server", async () => {
    let n = 0;
    const { f } = mock((u) => {
      if (u.endsWith("/dismiss")) return json({ error: "not proposed" }, 409);
      n++;
      return json({ proposals: [{ ...P, status: "applied" }] });
    });
    const s = createChatProposalsStore(f);
    s.reset("a");
    const err = await s.dismiss("a", "p1").catch((e: unknown) => e);
    expect((err as ProposalApplyError).status).toBe(409);
    expect(n).toBe(1);
    expect(s.snapshot().proposals[0]!.status).toBe("applied");
  });

  test("dismiss never refreshes other stores", async () => {
    const seen: string[] = [];
    const { f } = mock(() => json({ proposal: { ...P, status: "dismissed" } }));
    const s = createChatProposalsStore(f, () => void seen.push("x"));
    s.reset("a");
    await s.dismiss("a", "p1");
    expect(seen).toEqual([]);
  });
});
