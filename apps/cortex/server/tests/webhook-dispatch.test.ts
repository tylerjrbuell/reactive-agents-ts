import { describe, it, expect } from "bun:test";
import {
  parseWebhookConfigs,
  selectWebhookTargets,
  isLifecycleEvent,
  buildWebhookPayload,
  dispatchWebhooks,
} from "../services/webhook-dispatch.js";

describe("webhook-dispatch", () => {
  it("parses {url,events} objects and bare URL strings, dropping junk", () => {
    const cfgs = parseWebhookConfigs([
      { url: "https://a.test", events: ["AgentCompleted"] },
      "https://b.test",
      { url: "" },
      42,
      { notUrl: true },
    ]);
    expect(cfgs).toEqual([
      { url: "https://a.test", events: ["AgentCompleted"] },
      { url: "https://b.test" },
    ]);
  });

  it("isLifecycleEvent gates non-lifecycle tags", () => {
    expect(isLifecycleEvent("AgentCompleted")).toBe(true);
    expect(isLifecycleEvent("ReasoningStepCompleted")).toBe(false);
  });

  it("selects only hooks matching the event (or unfiltered/all)", () => {
    const hooks = [
      { url: "https://all.test" },
      { url: "https://allkw.test", events: ["all"] },
      { url: "https://done.test", events: ["AgentCompleted"] },
      { url: "https://fail.test", events: ["TaskFailed"] },
    ];
    expect(selectWebhookTargets(hooks, "AgentCompleted")).toEqual([
      "https://all.test",
      "https://allkw.test",
      "https://done.test",
    ]);
    expect(selectWebhookTargets(hooks, "TaskFailed")).toEqual([
      "https://all.test",
      "https://allkw.test",
      "https://fail.test",
    ]);
  });

  it("returns no targets for non-lifecycle events", () => {
    expect(selectWebhookTargets([{ url: "https://x.test" }], "ReasoningStepCompleted")).toEqual([]);
  });

  it("builds a payload envelope with type/agentId/runId/event", () => {
    const p = buildWebhookPayload({
      agentId: "a1",
      runId: "r1",
      eventTag: "AgentCompleted",
      event: { success: true },
    });
    expect(p.type).toBe("AgentCompleted");
    expect(p.agentId).toBe("a1");
    expect(p.runId).toBe("r1");
    expect((p.event as { success: boolean }).success).toBe(true);
    expect(typeof p.timestamp).toBe("number");
  });

  it("dispatchWebhooks POSTs JSON to each target and swallows failures", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fakeFetch = ((url: string, init?: RequestInit) => {
      calls.push({ url, body: String(init?.body ?? "") });
      return url.includes("bad")
        ? Promise.reject(new Error("boom"))
        : Promise.resolve(new Response("ok"));
    }) as unknown as typeof fetch;

    dispatchWebhooks(["https://good.test", "https://bad.test"], { type: "AgentCompleted" }, fakeFetch);
    // microtask drain
    await Promise.resolve();
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe("https://good.test");
    expect(JSON.parse(calls[0]!.body).type).toBe("AgentCompleted");
  });

  it("dispatchWebhooks is a no-op for empty targets", () => {
    let called = false;
    const fakeFetch = (() => { called = true; return Promise.resolve(new Response()); }) as unknown as typeof fetch;
    dispatchWebhooks([], { type: "x" }, fakeFetch);
    expect(called).toBe(false);
  });
});
