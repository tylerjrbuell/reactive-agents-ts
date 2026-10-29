// Run: bun test packages/runtime/tests/seam-chat-environment-snapshot.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import type { EnvironmentChangedEvent } from "@reactive-agents/core";
import { ChatEngine } from "../src/chat/engine.js";
import {
  diffEnvironment,
  renderEnvironmentUpdate,
  snapshotEnvironment,
  readEnvironmentUpdate,
  type EnvironmentSnapshotInput,
} from "../src/chat/environment-snapshot.js";
import { turnCarryMetadata } from "../src/chat/todo-seed.js";
import { buildRunEnvelopeFromConfig } from "../src/engine/run-envelope-config.js";
import type { ChatMessage } from "../src/chat.js";
import type { RunHandle } from "../src/run-controller.js";
import type { AgentStreamEvent } from "../src/stream-types.js";

const base: EnvironmentSnapshotInput = {
  provider: "ollama",
  model: "qwen3:8b",
  thinking: "off",
  toolNames: ["http-get", "file-read"],
  skills: ["a"],
  docSources: ["d1"],
  agentControl: "autonomous",
  todoUserEdits: { added: 0, removed: 0 },
};
const diff = (next: Partial<EnvironmentSnapshotInput>) =>
  diffEnvironment(snapshotEnvironment(base), snapshotEnvironment({ ...base, ...next }));

describe("diffEnvironment — one test per change kind", () => {
  it("identical snapshots (any input order) diff empty", () => {
    expect(diff({ toolNames: ["file-read", "http-get", "http-get"] })).toEqual([]);
  });
  it("tools added/removed", () => {
    expect(diff({ toolNames: ["file-read", "github-search"] })).toEqual([
      { kind: "tools", summary: "Tools: +github-search, -http-get." },
    ]);
  });
  it("model switched", () => {
    expect(diff({ model: "qwen3:14b" })).toEqual([{ kind: "model", summary: "Model switched to qwen3:14b." }]);
  });
  it("provider switched", () => {
    expect(diff({ provider: "anthropic", model: "claude" })).toEqual([
      { kind: "model", summary: "Provider switched to anthropic (model claude)." },
    ]);
  });
  it("thinking changed", () => {
    expect(diff({ thinking: true })).toEqual([{ kind: "thinking", summary: "Thinking set to true." }]);
  });
  it("skills pinned / unpinned", () => {
    expect(diff({ skills: ["b"] }).map((c) => c.summary)).toEqual(["Skills pinned: b.", "Skills unpinned: a."]);
  });
  it("docs added / removed", () => {
    expect(diff({ docSources: ["d2"] })).toEqual([{ kind: "docs", summary: "Documents: +d2, -d1." }]);
  });
  it("goal started then finished", () => {
    const started = diff({ goal: { status: "active", objective: "ship it" } });
    expect(started).toEqual([{ kind: "goal", summary: "Goal started: ship it" }]);
    const a = snapshotEnvironment({ ...base, goal: { status: "active", objective: "ship it" } });
    const b = snapshotEnvironment({ ...base, goal: { status: "done", objective: "ship it" } });
    expect(diffEnvironment(a, b)).toEqual([{ kind: "goal", summary: "Goal finished: ship it" }]);
  });
  it("agent control changed", () => {
    expect(diff({ agentControl: "paused" })).toEqual([{ kind: "agent-control", summary: "Agent control is now paused." }]);
  });
  it("user to-do edits (delta of cumulative counters)", () => {
    expect(diff({ todoUserEdits: { added: 2, removed: 1 } })).toEqual([
      { kind: "todo-user-edit", summary: "The user edited your to-do list (+2, -1)." },
    ]);
  });
  it("render caps at 6 lines + '…and N more'; empty renders undefined", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ kind: "docs" as const, summary: `c${i}` }));
    const lines = renderEnvironmentUpdate(many)!.split("\n");
    expect(lines[0]).toBe("Environment update since your last turn:");
    expect(lines.slice(1)).toEqual(["- c0", "- c1", "- c2", "- c3", "- c4", "- c5", "- …and 3 more"]);
    expect(renderEnvironmentUpdate([])).toBeUndefined();
  });
  it("long tool lists and multi-line text stay one capped line", () => {
    const out = diff({ toolNames: [...base.toolNames!, ...Array.from({ length: 20 }, (_, i) => `t${i}`)] });
    expect(out).toHaveLength(1);
    expect(out[0]!.summary).not.toContain("\n");
    expect(out[0]!.summary).toContain("…(");
  });
});

// ── engine ──────────────────────────────────────────────────────────────────
function harness(opts: { environmentUpdates?: boolean } = {}) {
  let env: EnvironmentSnapshotInput = base;
  const prompts: string[] = [];
  const events: EnvironmentChangedEvent[] = [];
  const runTaskOpts: Array<{ environmentUpdate?: string }> = [];
  const engine = new ChatEngine(
    {
      complete: async ({ systemPrompt }) => {
        prompts.push(systemPrompt);
        return { message: "ok" };
      },
      runTask: async (_i, o) => {
        runTaskOpts.push({ environmentUpdate: o.environmentUpdate });
        return { output: "ok", metadata: { tokensUsed: 1, stepsCount: 1, cost: 0, duration: 0 } } as never;
      },
      environment: () => env,
      publishEnvironment: async (e) => void events.push(e),
    },
    { sessionId: "s", ...opts },
  );
  return { engine, prompts, events, runTaskOpts, set: (e: Partial<EnvironmentSnapshotInput>) => (env = { ...base, ...e }) };
}

describe("ChatEngine environment updates", () => {
  it("first turn: no notice, no event", async () => {
    const h = harness();
    h.set({ model: "other" });
    await h.engine.turn("hi");
    expect(h.prompts[0]).not.toContain("Environment update");
    expect(h.events).toEqual([]);
  });

  it("no-change turns: request identical to feature off (opt-out engine)", async () => {
    const on = harness();
    const off = harness({ environmentUpdates: false });
    for (const h of [on, off]) {
      await h.engine.turn("one");
      await h.engine.turn("two");
    }
    expect(on.prompts).toEqual(off.prompts);
    expect(on.events).toEqual([]);
  });

  it("change turn carries the notice (vacuity guard) and emits EnvironmentChanged once; next turn clean", async () => {
    const h = harness();
    await h.engine.turn("one");
    h.set({ model: "qwen3:14b", toolNames: ["file-read"] });
    await h.engine.turn("two");
    expect(h.prompts[1]).toContain("Environment update since your last turn:\n- Tools: -http-get.\n- Model switched to qwen3:14b.");
    expect(h.events).toHaveLength(1);
    expect(h.events[0]!._tag).toBe("EnvironmentChanged");
    expect(h.events[0]!.changes.map((c) => c.kind)).toEqual(["tools", "model"]);
    await h.engine.turn("three");
    expect(h.prompts[2]).not.toContain("Environment update");
    expect(h.events).toHaveLength(1);
  });

  it("opt-out: change is never reported", async () => {
    const h = harness({ environmentUpdates: false });
    await h.engine.turn("one");
    h.set({ model: "x" });
    await h.engine.turn("two");
    expect(h.prompts[1]).not.toContain("Environment update");
    expect(h.events).toEqual([]);
  });

  it("tool path hands the notice to runTask only on a change turn", async () => {
    const h = harness();
    await h.engine.turn("one", { useTools: true });
    await h.engine.turn("two", { useTools: true });
    h.set({ skills: [] });
    await h.engine.turn("three", { useTools: true });
    expect(h.runTaskOpts.map((o) => o.environmentUpdate)).toEqual([undefined, undefined, expect.stringContaining("Skills unpinned: a.")]);
  });

  it("stream path hands the notice to runStreamTask only on a change turn", async () => {
    let env: EnvironmentSnapshotInput = base;
    const seen: Array<Record<string, unknown>> = [];
    const done: AgentStreamEvent = {
      _tag: "StreamCompleted", output: "ok", taskId: "t", metadata: { duration: 0, cost: 0, tokensUsed: 1, stepsCount: 1 },
    };
    const engine = new ChatEngine(
      {
        complete: async () => ({ message: "" }),
        runStreamTask: (_i, o) => {
          seen.push({ ...o });
          async function* g(): AsyncGenerator<AgentStreamEvent> { yield done; }
          return Object.assign(g(), { pause() {}, resume() {}, stop() {}, terminate() {}, status: () => "running" as const, inspect: () => undefined }) as RunHandle;
        },
        environment: () => env,
      },
      { sessionId: "s" },
    );
    const drain = async (m: string) => { for await (const _ of engine.streamTurn(m)) void _; };
    await drain("one");
    await drain("two");
    env = { ...base, docSources: [] };
    await drain("three");
    expect("environmentUpdate" in seen[0]!).toBe(false);
    expect("environmentUpdate" in seen[1]!).toBe(false);
    expect(seen[2]!.environmentUpdate).toContain("Documents: -d1.");
  });
});

describe("carrier -> run envelope", () => {
  const task = (opts: Parameters<typeof turnCarryMetadata>[0]) => ({ metadata: { tags: [], ...turnCarryMetadata(opts) } });
  it("no notice: metadata untouched and envelope has no environmentUpdate", () => {
    expect(turnCarryMetadata({})).toEqual({});
    expect(readEnvironmentUpdate(task({}) as never)).toBeUndefined();
    const env = buildRunEnvelopeFromConfig({} as never, {});
    expect("environmentUpdate" in env.rails).toBe(false);
  });
  it("notice survives metadata round-trip and lands on rails.environmentUpdate", () => {
    const t = task({ environmentUpdate: "Environment update since your last turn:\n- x" }) as never;
    const text = readEnvironmentUpdate(t);
    expect(text).toContain("- x");
    const env = buildRunEnvelopeFromConfig({} as never, { environmentUpdate: text });
    expect((env.rails as { environmentUpdate?: string }).environmentUpdate).toBe(text);
  });
  it("todo seed and notice coexist in one context", () => {
    const m = turnCarryMetadata({ initialTodo: [{ id: "1", title: "t", status: "pending" }], environmentUpdate: "n" });
    expect(Object.keys(m.context!).sort()).toEqual(["environmentUpdate", "initialTodo"]);
  });
});

describe("history hygiene on the direct path (F3 gap)", () => {
  const SHAPED = '{"name":"web-search","arguments":{"query":"x"}}';
  const dirty: ChatMessage[] = [
    { role: "user", content: "find x", timestamp: 1 },
    { role: "assistant", content: SHAPED, timestamp: 2 },
  ];
  it("initialHistory is healed before it reaches complete()", async () => {
    const seen: string[] = [];
    const engine = new ChatEngine(
      { complete: async ({ messages }) => (seen.push(JSON.stringify(messages)), { message: "ok" }) },
      { sessionId: "s", initialHistory: dirty },
    );
    await engine.turn("next");
    expect(seen[0]).not.toContain("web-search");
    expect(seen[0]).not.toContain("find x");
    expect(seen[0]).not.toContain("omitted");
    expect(JSON.stringify(engine.history())).not.toContain("web-search");
  });
  it("loadHistory result is healed too", async () => {
    const engine = new ChatEngine(
      { complete: async () => ({ message: "ok" }), loadHistory: async () => dirty },
      { sessionId: "s" },
    );
    await engine.turn("next");
    expect(JSON.stringify(engine.history())).not.toContain("web-search");
  });
});
