import { describe, expect, test } from "bun:test";
import { withHappyDom } from "./happy-dom.js";
import { renderHook, waitFor, act } from "@testing-library/react";
import { mockAgentEndpoint, type RunFixture } from "@reactive-agents/ui-core/testing";
import type { FetchLike } from "@reactive-agents/ui-core";
import { useRun } from "../src/hooks/use-run.js";

withHappyDom();

const FIXTURE: RunFixture = {
  protocolVersion: 1,
  events: [
    { _tag: "TextDelta", text: "4", seq: 1 },
    { _tag: "StreamCompleted", output: "4", metadata: { cost: 0.001, tokensUsed: 10 }, runId: "r1", seq: 2 },
  ],
};

const fixtureFetch = (fixture: RunFixture): FetchLike => {
  const handler = mockAgentEndpoint(fixture);
  return async (input, init) => handler(new Request(new URL(String(input), "http://ra.test").toString(), init as RequestInit));
};

describe("useRun", () => {
  test("runs a prompt and reduces to completed state", async () => {
    const { result } = renderHook(() => useRun({ endpoint: "/api/agent", fetchImpl: fixtureFetch(FIXTURE) }));
    expect(result.current.state.status).toBe("idle");
    act(() => result.current.run("2+2"));
    await waitFor(() => expect(result.current.state.status).toBe("completed"));
    expect(result.current.state.output).toBe("4");
    expect(result.current.state.runId).toBe("r1");
    expect(result.current.state.cost).toEqual({ tokens: 10, usd: 0.001 });
  });

  test("auto-runs on mount when opts.auto is set", async () => {
    const { result } = renderHook(() =>
      useRun({ endpoint: "/api/agent", fetchImpl: fixtureFetch(FIXTURE), auto: { prompt: "go" } }),
    );
    await waitFor(() => expect(result.current.state.status).toBe("completed"));
    expect(result.current.state.output).toBe("4");
  });
});
