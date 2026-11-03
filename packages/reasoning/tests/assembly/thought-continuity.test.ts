// Run: bun test packages/reasoning/tests/assembly/thought-continuity.test.ts
//
// The model never sees its own reasoning on replay — by design.
//
// WIRE-CAPTURED 2026-07-10 (logging proxy in front of Ollama): a 6-iteration
// run whose EVERY assistant turn was `content: ""` — `project-results.ts`
// hardcoded it, and the `thought` EventLog kind was declared with zero writers
// (`from-kernel-state.ts` never emitted one). Meanwhile the persona instructs
// "think step by step". Tool results survived each turn; the model's plans,
// derivations, and self-corrections did not. For any task needing cumulative
// reasoning the model re-derives from scratch every turn.
//
// `from-kernel-state` was fixed to ALWAYS record a `thought` event for a
// non-empty assistant turn (recording what happened is not a rendering
// decision) — that half stands. Rendering it as replayed assistant content
// was gated behind `RA_THOUGHT_CONTINUITY=1` as an experimental mechanism;
// the 2026-09-15 ablation (wiki/Decisions/2026-09-15-experimental-flag-verdicts.md)
// found it INERT on the golden corpus and no accuracy lift on the one live
// tier measured — verdict DELETE. The flag and its rendering path are removed;
// every assistant turn renders `content: ""` unconditionally now.

import { describe, expect, it } from "bun:test";
import { fromKernelState } from "../../src/assembly/from-kernel-state.js";
import { project } from "../../src/assembly/project.js";
import type { KernelState } from "../../src/kernel/state/kernel-state.js";
import { makeKernelState } from "../../src/testing/kernel-fixtures.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";

/** A 2-iteration run: think → read a.json → think again → read b.json. */
const state = (thoughts: readonly [string, string]): KernelState =>
  makeKernelState({
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
  });

const persona = { system: "You are a helpful assistant." };
const tools = { schemas: [] as readonly unknown[] };
const profile = CONTEXT_PROFILES.mid;

const assemble = (thoughts: readonly [string, string]) =>
  fromKernelState(state(thoughts), profile, persona, tools);

const render = (thoughts: readonly [string, string]) =>
  project(assemble(thoughts)).request.messages.filter((m) => m.role === "assistant");

describe("the thought is still RECORDED (rendering is what got removed)", () => {
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

describe("the rendered thread is always byte-identical: content: ''", () => {
  it("every assistant turn renders content: ''", () => {
    const turns = render(["I summed the completed orders: 200.", "Now the rate file."]);
    expect(turns.length).toBeGreaterThanOrEqual(2);
    for (const t of turns) expect(t.content).toBe("");
  });

  it("tool_use pairing is untouched — each turn still owns its calls", () => {
    const turns = render(["a", "b"]);
    expect(turns[0]!.toolCalls?.map((c: { id: string }) => c.id)).toEqual(["c1"]);
    expect(turns[1]!.toolCalls?.map((c: { id: string }) => c.id)).toEqual(["c2"]);
  });
});
