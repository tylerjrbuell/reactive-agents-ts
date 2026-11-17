// Execute through the framework's plan executor: strategy choice, dependsOn / args on the wire,
// and the framework's refusal reason coming back as the line to show.
import { afterEach, describe, expect, it } from "bun:test";
import { chatStore } from "./chat-store.js";
import { executePlan } from "./chat-mode-store.js";
import { toPlanBody } from "../plan-edit.js";

type FetchFn = typeof fetch;
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
// A fresh session id per test: the mode store remembers what it was told per id.
let counter = 0;

interface Seen {
  id: string;
  calls: string[];
  execute?: Record<string, unknown>;
  put?: { steps: Array<Record<string, unknown>> };
}

function server(opts: { execute?: () => Response } = {}): Seen {
  const id = `x${++counter}`;
  const session = { sessionId: id, name: id, agentConfig: {}, createdAt: 0, lastUsedAt: 0, mode: "plan" };
  const seen: Seen = { id, calls: [] };
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/mode")) return (seen.calls.push("mode"), json({ mode: "execute" }));
    if (url.endsWith("/plan/execute")) {
      seen.calls.push("execute");
      seen.execute = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return opts.execute ? opts.execute() : json({ reply: "done", success: true, plan: { id: "p", goal: "", source: "user-edited", createdAt: 1, steps: [{ id: "a", title: "A", status: "done" }] } });
    }
    if (url.endsWith(`/sessions/${id}/plan`) && init?.method === "PUT") {
      seen.calls.push("put");
      seen.put = JSON.parse(String(init.body)) as Seen["put"];
      return json({ plan: { id: "p", goal: "", source: "user-edited", createdAt: 1, steps: seen.put!.steps.map((s) => ({ ...s, status: "pending" })) } });
    }
    if (url.endsWith("/chat/stream")) {
      seen.calls.push("stream");
      return new Response('data: {"_tag":"StreamCompleted","output":"ok","metadata":{"tokensUsed":1,"iterations":1}}\n\n', { headers: { "Content-Type": "text/event-stream" } });
    }
    if (url.endsWith("/api/chat/sessions")) return json([session]);
    return json({ ...session, turns: [] });
  }) as FetchFn;
  return seen;
}

async function open(id: string): Promise<void> {
  await chatStore.loadSessions();
  await chatStore.selectSession(id);
}

const STEPS = [{ id: "a", title: "A", status: "pending" as const }, { id: "b", title: "B", status: "pending" as const }];

describe("executePlan through the framework's plan executor", () => {
  it("a named strategy runs through POST .../plan/execute with that strategy, not a streamed turn", async () => {
    const seen = server();
    await open(seen.id);
    expect(await executePlan(undefined, { strategy: "blueprint" })).toBeUndefined();
    expect(seen.calls).toEqual(["mode", "execute"]);
    expect(seen.execute).toEqual({ strategy: "blueprint" });
  });

  it("Auto on a plain checklist is the streamed Execute turn, as before", async () => {
    const seen = server();
    await open(seen.id);
    await executePlan(undefined, { strategy: "auto", extras: {} });
    expect(seen.calls).toEqual(["mode", "stream"]);
  });

  it("Auto with dependsOn or args omits the strategy and lets the framework route the plan", async () => {
    const seen = server();
    await open(seen.id);
    await executePlan(STEPS, { strategy: "auto", extras: { b: { dependsOn: ["a"] } } });
    expect(seen.calls).toEqual(["put", "mode", "execute"]);
    expect(seen.execute).toEqual({});
    // The edit is saved with its dependsOn and args first.
    expect(seen.put?.steps.map((s) => [s.id, s.dependsOn])).toEqual([["a", undefined], ["b", ["a"]]]);
  });

  it("returns the framework's reason when it refuses the plan, and sends no turn", async () => {
    const seen = server({ execute: () => json({ error: "The plan cannot run: Dependency cycle through step \"a\".", reason: 'Dependency cycle through step "a".' }, 422) });
    await open(seen.id);
    expect(await executePlan(undefined, { strategy: "blueprint" })).toBe('Dependency cycle through step "a".');
  });
});

describe("toPlanBody", () => {
  it("carries each step's dependsOn and args, and leaves them off plain steps", () => {
    expect(toPlanBody(STEPS, { b: { dependsOn: ["a"], args: { k: 1 } } })).toEqual([
      { id: "a", title: "A", status: "pending" },
      { id: "b", title: "B", status: "pending", dependsOn: ["a"], args: { k: 1 } },
    ]);
  });
});
