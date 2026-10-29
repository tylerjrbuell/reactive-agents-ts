// Run: bun test packages/runtime/tests/seam-chat-environment-seed.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import type { EnvironmentChangedEvent } from "@reactive-agents/core";
import { ChatEngine } from "../src/chat/engine.js";
import type { EnvironmentSnapshotInput } from "../src/chat/environment-snapshot.js";
import { ReactiveAgents } from "../src/builder.js";
import { defineTool } from "@reactive-agents/tools";
import { Effect } from "effect";

const base: EnvironmentSnapshotInput = { provider: "ollama", model: "qwen3:8b", toolNames: ["a"] };

function mk(env: EnvironmentSnapshotInput, initialEnvironment?: EnvironmentSnapshotInput) {
  const events: EnvironmentChangedEvent[] = [];
  const notices: Array<string | undefined> = [];
  const engine = new ChatEngine(
    {
      complete: async () => ({ message: "ok" }),
      runTask: async (_i, o) => {
        notices.push(o.environmentUpdate);
        return { output: "ok", metadata: { tokensUsed: 1, stepsCount: 1, cost: 0, duration: 0 } } as never;
      },
      environment: () => env,
      publishEnvironment: async (e) => void events.push(e),
    },
    { sessionId: "s", ...(initialEnvironment ? { initialEnvironment } : {}) },
  );
  return { engine, events };
}
const turn = (e: ChatEngine) => e.turn("hi");

describe("seam: ChatEngine initialEnvironment seed", () => {
  it("seeded first turn with changed model => exactly one event", async () => {
    const { engine, events } = mk({ ...base, model: "qwen3:14b" }, base);
    await turn(engine);
    expect(events).toHaveLength(1);
    expect(events[0]!.changes).toEqual([{ kind: "model", summary: "Model switched to qwen3:14b." }]);
  });
  it("unseeded first turn => none", async () => {
    const { engine, events } = mk({ ...base, model: "qwen3:14b" });
    await turn(engine);
    expect(events).toHaveLength(0);
  });
  it("seed equal to current => none", async () => {
    const { engine, events } = mk(base, base);
    await turn(engine);
    expect(events).toHaveLength(0);
  });
});

describe("session(): runtime-filled toolNames", () => {
  it("tool added between turns shows in diff without host supplying names", async () => {
    const agent = await ReactiveAgents.create().withName("t").withProvider("test").withTools().build();
    const events: EnvironmentChangedEvent[] = [];
    const session = agent.session({
      environment: () => ({ model: "m" }),
      publishEnvironment: async (e) => void events.push(e),
    });
    await session.chat("hello there");
    await agent.registerTool(
      { name: "zz-new-tool", description: "d", parameters: [], riskLevel: "low", timeoutMs: 1000, requiresApproval: false, source: "function" },
      () => Effect.succeed("ok"),
    );
    await session.chat("hello again");
    expect(events.flatMap((e) => e.changes.map((c) => c.summary))).toEqual(["Tools: +zz-new-tool."]);
    await agent.dispose();
  });
});
