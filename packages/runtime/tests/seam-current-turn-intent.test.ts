import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Context, Effect, Layer, ManagedRuntime, Schema } from "effect";
import { AgentId, TaskId, type Task, type TaskResult } from "@reactive-agents/core";
import { buildRunTaskEffect } from "../src/agent/run-task-effect.js";
import { currentTurnCarry } from "../src/agent/history-block.js";
import { currentTurnFromEvent, stampCurrentTurn } from "../src/agent/gateway-current-turn.js";
import { turnCarryMetadata } from "../src/chat/todo-seed.js";
import { GatewayChatManager } from "../src/gateway-context-formatting.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { HISTORY_BLOCK_MARKER, CURRENT_MESSAGE_MARKER } from "@reactive-agents/reasoning";
import { extractIntentText } from "../src/engine/util.js";
import { withHistoryBlock } from "../src/agent/history-block.js";
import { formatHistoryBlock } from "../src/gateway-context-formatting.js";
import { classifyTools } from "../src/engine/phases/agent-loop/setup/classifier.js";
import { makeModelCalibration, makeRuntimeConfig, makeTask } from "../src/testing/index.js";

const history = [
  { role: "user" as const, content: "please use the calculator to add 5 and 7", timestamp: 1 },
  { role: "assistant" as const, content: "12", timestamp: 2 },
];

const NoLLM = Layer.succeed(LLMService, {
  complete: () => Effect.die(new Error("no LLM")),
  stream: () => Effect.die(new Error("no LLM")),
} as never);

const run = (input: string) =>
  Effect.runPromise(
    classifyTools({
      config: makeRuntimeConfig({
        agentId: "a",
        enableGuardrails: false,
        adaptiveToolFiltering: true,
        requiredTools: { tools: undefined, adaptive: true },
      } as never),
      task: makeTask({ id: "t", agentId: "a", input, metadata: { tags: [] } }),
      cachedToolDefs: [{ name: "calculator" }, { name: "search" }],
      resolvedCalibration: makeModelCalibration({ classifierReliability: "low" }),
      obs: null,
      isNormal: false,
    } as never).pipe(Effect.provide(NoLLM)) as Effect.Effect<{ effectiveRequiredTools?: readonly string[] }>,
  );

const runTyped = (input: string, currentTurn: { content: string; priorTurnCount?: number }) =>
  Effect.runPromise(
    classifyTools({
      config: makeRuntimeConfig({
        agentId: "a",
        enableGuardrails: false,
        adaptiveToolFiltering: true,
        requiredTools: { tools: undefined, adaptive: true },
      } as never),
      task: makeTask({ id: "t", agentId: "a", input, metadata: { tags: [], currentTurn } }),
      cachedToolDefs: [{ name: "calculator" }, { name: "search" }],
      resolvedCalibration: makeModelCalibration({ classifierReliability: "low" }),
      obs: null,
      isNormal: false,
    } as never).pipe(Effect.provide(NoLLM)) as Effect.Effect<{ effectiveRequiredTools?: readonly string[] }>,
  );

describe("seam: typed current turn (producer + reader)", () => {
  it("extractIntentText prefers metadata.currentTurn over text; blank/absent falls back to markers", () => {
    const flat = withHistoryBlock("use the calculator", history);
    expect(extractIntentText(flat, { currentTurn: { content: "thanks" } })).toBe("thanks");
    expect(extractIntentText(flat, { currentTurn: { content: "   " } })).toBe("use the calculator");
    expect(extractIntentText(flat, {})).toBe("use the calculator");
    expect(extractIntentText(flat)).toBe("use the calculator");
  });

  it("typed turn beats a history-only mention with NO text marker; the typed mention still counts", async () => {
    const unmarked = "earlier: please use the calculator to add 5 and 7\nthanks";
    expect((await runTyped(unmarked, { content: "thanks" })).effectiveRequiredTools ?? []).toEqual([]);
    expect((await runTyped("ok", { content: "use the calculator again" })).effectiveRequiredTools).toEqual(["calculator"]);
  });

  it("currentTurnCarry: history folds in -> original input + prior count; no history -> {}", () => {
    expect(currentTurnCarry("hi", history)).toEqual({ currentTurn: { content: "hi", priorTurnCount: 2 } });
    expect(currentTurnCarry("hi", [])).toEqual({});
    expect(currentTurnCarry("hi")).toEqual({});
  });

  it("run(): currentTurn rides task.metadata.currentTurn; absent leaves it off", async () => {
    const taskOf = async (currentTurn?: { content: string }): Promise<Task> => {
      let seen: Task | undefined;
      const tr: TaskResult = {
        taskId: Schema.decodeSync(TaskId)("t"), agentId: Schema.decodeSync(AgentId)("a"), output: "x", success: true,
        metadata: { duration: 0, cost: 0, tokensUsed: 0 }, completedAt: new Date(),
      };
      const runtime: ManagedRuntime.ManagedRuntime<any, never> = ManagedRuntime.make(Layer.succeed(Context.GenericTag<{ u: true }>("CT"), { u: true }));
      await Effect.runPromise(buildRunTaskEffect({
        agentId: "a", engine: { execute: (t: Task) => (seen = t, Effect.succeed(tr)) }, runtime,
        config: {}, enableTools: false, pendingDebriefs: new Set(), setLastDebrief: () => {},
        setLastRunObservations: () => {}, setLastReasoningSteps: () => {}, buildSchemaSteering: () => "",
      }, "in", currentTurn ? { currentTurn } : undefined));
      return seen!;
    };
    expect((await taskOf({ content: "hi" })).metadata?.currentTurn?.content).toBe("hi");
    expect((await taskOf()).metadata?.currentTurn).toBeUndefined();
  });

  it("runStream(): turnCarryMetadata carries currentTurn onto task metadata", () => {
    expect(turnCarryMetadata({ currentTurn: { content: "hi", priorTurnCount: 1 } }).currentTurn).toEqual({ content: "hi", priorTurnCount: 1 });
    expect("currentTurn" in turnCarryMetadata({})).toBe(false);
  });

  it("gateway: the chat manager stamps the raw message; the event round-trips to a typed turn", async () => {
    let seen: unknown;
    const mgr = new GatewayChatManager({
      agentId: "t", sessionTtlDays: 30,
      executeEvent: async (e) => { seen = e; return "reply"; },
      logEpisode: async () => {}, saveSession: async () => {}, findById: async () => null,
      getRecentEpisodes: async () => [], cleanup: async () => 0,
    });
    await mgr.handleMessage("u", "what is 2+2", "telegram", "ch", { metadata: { outboundServer: "tg" } }, true);
    expect(currentTurnFromEvent(seen)).toEqual({ currentTurn: { content: "what is 2+2", priorTurnCount: 0 } });
    expect((seen as { metadata: { outboundServer: string } }).metadata.outboundServer).toBe("tg");
    expect(currentTurnFromEvent({})).toEqual({});
    expect(stampCurrentTurn(undefined, { content: "x" })).toBeUndefined();
  });
});

describe("seam: intent readers in engine/{bootstrap,phases} do not use raw extractTaskText", () => {
  // Files that legitimately read the FULL task text (execution, verification, telemetry, memory,
  // guardrails, continuation prompts). A NEW file reading intent must use extractIntentText
  // (typed currentTurn first); adding it here is a reviewed decision, not a default.
  const FULL_TEXT_READERS: Readonly<Record<string, number>> = {
    "phases/agent-loop/cache-check.ts": 1,
    "phases/agent-loop/reasoning-harness-hooks.ts": 7,
    "phases/agent-loop/reasoning-post-think.ts": 6,
    "phases/agent-loop/reasoning-think.ts": 4,
    "phases/agent-loop/verification-think-retry.ts": 2,
    "phases/guardrail.ts": 1,
    "phases/memory-flush.ts": 1,
    "phases/verify.ts": 1,
  };
  const root = new URL("../src/engine/", import.meta.url).pathname;
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? walk(join(dir, d.name)) : d.name.endsWith(".ts") ? [join(dir, d.name)] : [],
    );
  it("no new file, and no growth in an allowed file", () => {
    const found: Record<string, number> = {};
    for (const sub of ["bootstrap", "phases"]) {
      for (const f of walk(join(root, sub))) {
        const n = (readFileSync(f, "utf8").match(/\bextractTaskText\(/g) ?? []).length;
        if (n > 0) found[relative(root, f)] = n;
      }
    }
    for (const [file, n] of Object.entries(found)) {
      expect(FULL_TEXT_READERS[file] ?? 0, `${file} reads raw extractTaskText ${n}x; intent readers use extractIntentText`).toBeGreaterThanOrEqual(n);
    }
  });
});

describe("seam: intent readers see only the current turn", () => {
  it("marker constants match what the runtime writes", () => {
    expect(formatHistoryBlock(history)).toContain(HISTORY_BLOCK_MARKER);
    expect(withHistoryBlock("hi", history)).toContain(CURRENT_MESSAGE_MARKER);
  });

  it("extractIntentText drops the history block", () => {
    expect(extractIntentText(withHistoryBlock("thanks", history)).trim()).toBe("thanks");
    expect(extractIntentText("plain")).toBe("plain");
  });

  it("history-only tool mention does not require the tool", async () => {
    const r = await run(withHistoryBlock("thanks", history));
    expect(r.effectiveRequiredTools ?? []).toEqual([]);
  });

  it("current-turn tool mention still requires the tool", async () => {
    const r = await run(withHistoryBlock("use the calculator again", history));
    expect(r.effectiveRequiredTools).toEqual(["calculator"]);
  });
});
