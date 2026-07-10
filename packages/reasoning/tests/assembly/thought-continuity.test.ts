// Run: bun test packages/reasoning/tests/assembly/thought-continuity.test.ts
//
// The model never saw its own reasoning.
//
// WIRE-CAPTURED 2026-07-10 (logging proxy in front of Ollama): a 6-iteration
// run whose EVERY assistant turn was `content: ""` — `project-results.ts`
// hardcoded it, and the `thought` EventLog kind was declared with zero writers
// (`from-kernel-state.ts` never emitted one). Meanwhile the persona instructs
// "think step by step". Tool results survived each turn; the model's plans,
// derivations, and self-corrections did not. For any task needing cumulative
// reasoning the model re-derives from scratch every turn.
//
// The prose was never lost — conversation-assembly stores it verbatim
// (`content: assistantThought`, conversation-assembly.ts:137). It was dropped
// at the projection boundary. Two changes:
//
//   1. from-kernel-state now ALWAYS records a `thought` event for a non-empty
//      assistant turn (recording what happened is not a rendering decision);
//   2. project-results renders it as the assistant content ONLY behind
//      RA_THOUGHT_CONTINUITY=1 — experimental until an ablation clears the
//      lift gate, because it changes every prompt of every multi-step run.
//
// Default OFF is pinned byte-identical below.

import { afterEach, describe, expect, it } from "bun:test";
import { fromKernelState } from "../../src/assembly/from-kernel-state.js";
import { project } from "../../src/assembly/project.js";
import type { KernelState } from "../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";

const PRIOR = process.env.RA_THOUGHT_CONTINUITY;
afterEach(() => {
  if (PRIOR === undefined) delete process.env.RA_THOUGHT_CONTINUITY;
  else process.env.RA_THOUGHT_CONTINUITY = PRIOR;
});

/** A 2-iteration run: think → read a.json → think again → read b.json. */
const state = (thoughts: readonly [string, string]): KernelState =>
  ({
    taskId: "t",
    strategy: "reactive",
    kernelType: "react",
    status: "thinking",
    iteration: 2,
    steps: [],
    scratchpad: new Map<string, string>(),
    toolsUsed: new Set<string>(),
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    output: null,
    error: null,
    llmCalls: 0,
    meta: {},
    controllerDecisionLog: [],
    messages: [
      { role: "user", content: "sum the orders and convert them" },
      {
        role: "assistant",
        content: thoughts[0],
        toolCalls: [{ id: "c1", name: "file-read", arguments: { path: "./a.json" } }],
      },
      { role: "tool_result", toolCallId: "c1", toolName: "file-read", content: '{"total": 200}' },
      {
        role: "assistant",
        content: thoughts[1],
        toolCalls: [{ id: "c2", name: "file-read", arguments: { path: "./b.json" } }],
      },
      { role: "tool_result", toolCallId: "c2", toolName: "file-read", content: '{"rate": 0.92}' },
    ],
  }) as unknown as KernelState;

const persona = { system: "You are a helpful assistant." };
const tools = { schemas: [] as readonly unknown[] };
const profile = CONTEXT_PROFILES.mid;

const assemble = (thoughts: readonly [string, string]) =>
  fromKernelState(state(thoughts), profile, persona, tools);

const render = (thoughts: readonly [string, string]) =>
  project(assemble(thoughts)).request.messages.filter((m) => m.role === "assistant");

describe("the thought is RECORDED regardless of the flag", () => {
  it("a non-empty assistant turn becomes a thought event", () => {
    const asm = assemble(["Completed orders sum to 200. Next I need the rate.", "Reading rates now."]);
    const thoughts = asm.log.events.filter((e) => e.kind === "thought");
    expect(thoughts).toHaveLength(2);
  });

  it("an empty assistant turn records nothing (no blank events)", () => {
    const asm = assemble(["", "  "]);
    expect(asm.log.events.filter((e) => e.kind === "thought")).toHaveLength(0);
  });
});

describe("DEFAULT OFF: the rendered thread is byte-identical to before", () => {
  it("every assistant turn still renders content: ''", () => {
    delete process.env.RA_THOUGHT_CONTINUITY;
    const turns = render(["I summed the completed orders: 200.", "Now the rate file."]);
    expect(turns.length).toBeGreaterThanOrEqual(2);
    for (const t of turns) expect(t.content).toBe("");
  });
});

describe("RA_THOUGHT_CONTINUITY=1: the model re-reads its own reasoning", () => {
  it("each assistant turn carries ITS OWN thought, in order", () => {
    process.env.RA_THOUGHT_CONTINUITY = "1";
    const turns = render([
      "Completed orders sum to 200.00. I still need the EUR rate.",
      "orders done; reading the rate file next.",
    ]);
    expect(turns[0]!.content).toBe("Completed orders sum to 200.00. I still need the EUR rate.");
    expect(turns[1]!.content).toBe("orders done; reading the rate file next.");
  });

  it("a long thought is capped so prose cannot crowd out tool results", () => {
    process.env.RA_THOUGHT_CONTINUITY = "1";
    const long = "x".repeat(5_000);
    const turns = render([long, "short"]);
    expect(turns[0]!.content.length).toBeLessThanOrEqual(601); // cap + ellipsis
    expect(turns[0]!.content.endsWith("…")).toBe(true);
  });

  it("tool_use pairing is untouched — each turn still owns its calls", () => {
    process.env.RA_THOUGHT_CONTINUITY = "1";
    const turns = render(["a", "b"]);
    expect(turns[0]!.toolCalls?.map((c: { id: string }) => c.id)).toEqual(["c1"]);
    expect(turns[1]!.toolCalls?.map((c: { id: string }) => c.id)).toEqual(["c2"]);
  });
});
