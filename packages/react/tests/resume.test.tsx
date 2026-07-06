import { describe, expect, test } from "bun:test";
import { withHappyDom } from "./happy-dom.js";
import { renderHook, waitFor } from "@testing-library/react";
import { mockAgentEndpoint, type RunFixture } from "@reactive-agents/ui-core/testing";
import type { FetchLike } from "@reactive-agents/ui-core";
import { useResumableRun } from "../src/hooks/use-resumable-run.js";

withHappyDom();

const ATTACH_FIXTURE: RunFixture = {
  protocolVersion: 1,
  events: [
    { _tag: "RunAttached", runId: "r7", status: "streaming", resumeCursor: 2, protocolVersion: 1, seq: 2 },
    { _tag: "TextDelta", text: "resumed", seq: 3 },
    { _tag: "StreamCompleted", output: "resumed answer", metadata: {}, runId: "r7", seq: 4 },
  ],
};
const fixtureFetch = (fixture: RunFixture): FetchLike => {
  const handler = mockAgentEndpoint(fixture);
  return async (input, init) => handler(new Request(new URL(String(input), "http://ra.test").toString(), init as RequestInit));
};

describe("useResumableRun", () => {
  test("auto-attaches on mount and completes from replay", async () => {
    const { result } = renderHook(() =>
      useResumableRun({ endpoint: "/api/agent", runId: "r7", cursor: 0, fetchImpl: fixtureFetch(ATTACH_FIXTURE) }),
    );
    await waitFor(() => expect(result.current.state.status).toBe("completed"));
    expect(result.current.state.runId).toBe("r7");
    expect(result.current.state.output).toBe("resumed answer");
  });
});
