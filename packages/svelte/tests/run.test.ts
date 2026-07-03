import { describe, expect, test } from "bun:test";
import { mockAgentEndpoint, type RunFixture } from "@reactive-agents/ui-core/testing";
import type { FetchLike, RunState } from "@reactive-agents/ui-core";
import { createRun } from "../src/run.js";

const FIXTURE: RunFixture = {
  protocolVersion: 1,
  events: [
    { _tag: "TextDelta", text: "4", seq: 1 },
    { _tag: "StreamCompleted", output: "4", metadata: { cost: 0.001, tokensUsed: 10 }, runId: "r1", seq: 2 },
  ],
};
const fixtureFetch = (f: RunFixture): FetchLike => {
  const h = mockAgentEndpoint(f);
  return async (input, init) => h(new Request(new URL(String(input), "http://ra.test").toString(), init as RequestInit));
};
const collect = (store: { subscribe: (fn: (s: RunState) => void) => () => void }) => {
  const states: RunState[] = [];
  const unsub = store.subscribe((s) => states.push(s));
  return { states, unsub };
};
const settle = () => new Promise((r) => setTimeout(r, 50));

describe("createRun", () => {
  test("runs and reduces to completed", async () => {
    const store = createRun({ endpoint: "/api/agent", fetchImpl: fixtureFetch(FIXTURE) });
    const { states } = collect(store);
    store.run("2+2");
    await settle();
    const last = states.at(-1)!;
    expect(last.status).toBe("completed");
    expect(last.output).toBe("4");
    expect(last.runId).toBe("r1");
    expect(last.cost).toEqual({ tokens: 10, usd: 0.001 });
  });
});
