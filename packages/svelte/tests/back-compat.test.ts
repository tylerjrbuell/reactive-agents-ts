import { describe, expect, test } from "bun:test";
import { mockAgentEndpoint, type RunFixture } from "@reactive-agents/ui-core/testing";
import { createAgentStream } from "../src/agent-stream.js";
import { createAgent } from "../src/agent.js";

const FIXTURE: RunFixture = {
  protocolVersion: 1,
  events: [
    { _tag: "TextDelta", text: "hel", seq: 1 },
    { _tag: "TextDelta", text: "lo", seq: 2 },
    { _tag: "StreamCompleted", output: "hello", metadata: {}, seq: 3 },
  ],
};
const patch = (f: RunFixture) => {
  const h = mockAgentEndpoint(f);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    h(new Request(new URL(String(input), "http://ra.test").toString(), init))) as typeof fetch;
};
const settle = () => new Promise((r) => setTimeout(r, 50));

describe("svelte back-compat", () => {
  test("createAgentStream {text,status,output}", async () => {
    patch(FIXTURE);
    const s = createAgentStream("/api/agent");
    const states: Array<{ text: string; status: string; output: string | null }> = [];
    s.subscribe((st) => states.push({ text: st.text, status: st.status, output: st.output }));
    await s.run("hi");
    await settle();
    const last = states.at(-1)!;
    expect(last.status).toBe("completed");
    expect(last.text).toBe("hello");
    expect(last.output).toBe("hello");
  });

  test("createAgent run() resolves output", async () => {
    patch(FIXTURE);
    const a = createAgent("/api/agent");
    const out = await a.run("hi");
    expect(out).toBe("hello");
  });

  test("createAgentStream applies requestInit headers to underlying fetch", async () => {
    const h = mockAgentEndpoint(FIXTURE);
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return h(new Request(new URL(String(input), "http://ra.test").toString(), init));
    }) as typeof fetch;

    const s = createAgentStream("/x", { headers: { "X-Test": "1" } });
    await s.run("hi");
    await settle();

    const headers = capturedInit?.headers as Record<string, string> | undefined;
    expect(headers?.["X-Test"]).toBe("1");
  });
});
