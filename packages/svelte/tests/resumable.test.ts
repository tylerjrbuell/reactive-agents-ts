import { describe, expect, test } from "bun:test";
import { mockAgentEndpoint, type RunFixture } from "@reactive-agents/ui-core/testing";
import type { FetchLike, RunState } from "@reactive-agents/ui-core";
import { createResumableRun } from "../src/resumable.js";

const ATTACH: RunFixture = {
  protocolVersion: 1,
  events: [
    { _tag: "RunAttached", runId: "r7", status: "streaming", resumeCursor: 2, protocolVersion: 1, seq: 2 },
    { _tag: "TextDelta", text: "resumed", seq: 3 },
    { _tag: "StreamCompleted", output: "resumed answer", metadata: {}, runId: "r7", seq: 4 },
  ],
};
const fixtureFetch = (f: RunFixture): FetchLike => {
  const h = mockAgentEndpoint(f);
  return async (input, init) => h(new Request(new URL(String(input), "http://ra.test").toString(), init as RequestInit));
};
const settle = () => new Promise((r) => setTimeout(r, 50));

describe("createResumableRun", () => {
  test("auto-attaches and completes from replay", async () => {
    const store = createResumableRun({ endpoint: "/api/agent", runId: "r7", cursor: 0, fetchImpl: fixtureFetch(ATTACH) });
    const states: RunState[] = [];
    store.subscribe((s) => states.push(s));
    await settle();
    const last = states.at(-1)!;
    expect(last.status).toBe("completed");
    expect(last.runId).toBe("r7");
    expect(last.output).toBe("resumed answer");
  });
});
