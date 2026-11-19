// Run: bun test packages/runtime/tests/seam-chat-environment-seed.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import type { EnvironmentChangedEvent } from "@reactive-agents/core";
import { ChatEngine } from "../src/chat/engine.js";
import type { EnvironmentSnapshotInput } from "../src/chat/environment-snapshot.js";
import { ReactiveAgents } from "../src/builder.js";
import { defineTool } from "@reactive-agents/tools";
import { Effect } from "effect";

const base: EnvironmentSnapshotInput = { provider: "ollama", model: "qwen3:8b", toolNames: ["a"] };

// A rebuilt engine continues a conversation: the seed rides with its history.
const priorTurns = [
  { role: "user" as const, content: "earlier question", timestamp: 0 },
  { role: "assistant" as const, content: "earlier answer", timestamp: 0 },
];

function mk(env: EnvironmentSnapshotInput, initialEnvironment?: EnvironmentSnapshotInput, withHistory = true) {
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
    { sessionId: "s", ...(initialEnvironment ? { initialEnvironment } : {}), ...(withHistory ? { initialHistory: priorTurns } : {}) },
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
  // G10 (2026-11-18): a fresh conversation has no "last turn", so a stale seed
  // (provider switched, to-do list cleared before the first message) must not
  // reach the model. The current environment becomes the baseline instead.
  it("seeded, changed, but no prior turn => none; next turn diffs from the current state", async () => {
    let env: EnvironmentSnapshotInput = { ...base, model: "qwen3:14b" };
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
      { sessionId: "s", initialEnvironment: { ...base, todoUserEdits: { added: 0, removed: 0 } } },
    );
    env = { ...env, todoUserEdits: { added: 0, removed: 4 } };
    await engine.turn("hi", { useTools: true });
    expect(events).toHaveLength(0);
    expect(notices).toEqual([undefined]);
    await engine.turn("again", { useTools: true });
    expect(events).toHaveLength(0);
    env = { ...env, model: "qwen3:32b" };
    await engine.turn("third", { useTools: true });
    expect(events.flatMap((e) => e.changes.map((c) => c.summary))).toEqual(["Model switched to qwen3:32b."]);
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
