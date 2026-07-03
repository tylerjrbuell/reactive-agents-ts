import { describe, expect, test, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { renderHook, waitFor, act } from "@testing-library/react";
import { mockAgentEndpoint, type RunFixture } from "@reactive-agents/ui-core/testing";
import { useAgentStream } from "../src/hooks/use-agent-stream.js";
import { useAgent } from "../src/hooks/use-agent.js";

beforeAll(() => {
  if (!globalThis.document) GlobalRegistrator.register();
});

const FIXTURE: RunFixture = {
  protocolVersion: 1,
  events: [
    { _tag: "TextDelta", text: "hel", seq: 1 },
    { _tag: "TextDelta", text: "lo", seq: 2 },
    { _tag: "StreamCompleted", output: "hello", metadata: {}, seq: 3 },
  ],
};
const patchFetch = (fixture: RunFixture) => {
  const handler = mockAgentEndpoint(fixture);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(new Request(new URL(String(input), "http://ra.test").toString(), init))) as typeof fetch;
};

describe("back-compat", () => {
  test("useAgentStream preserves {text,status,output,run,cancel}", async () => {
    patchFetch(FIXTURE);
    const { result } = renderHook(() => useAgentStream("/api/agent"));
    act(() => result.current.run("hi"));
    await waitFor(() => expect(result.current.status).toBe("completed"));
    expect(result.current.text).toBe("hello");
    expect(result.current.output).toBe("hello");
  });

  test("useAgent preserves {output,loading,error,run(): Promise}", async () => {
    patchFetch(FIXTURE);
    const { result } = renderHook(() => useAgent("/api/agent"));
    // NOTE: deliberately not `await act(async () => { await result.current.run() })`
    // here — that pattern deadlocks because `run()`'s promise only resolves once
    // a subsequent re-render (driven by the background stream's setState calls)
    // runs the resolver, and act()'s async form won't flush that render until its
    // own callback settles. `waitFor` polls across real ticks instead, so the
    // render that resolves the promise gets a chance to happen.
    let resolved = "";
    act(() => {
      result.current.run("hi").then((v) => {
        resolved = v;
      });
    });
    await waitFor(() => expect(result.current.output).toBe("hello"));
    expect(resolved).toBe("hello");
    expect(result.current.loading).toBe(false);
  });
});
