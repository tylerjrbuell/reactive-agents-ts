import { describe, it, expect } from "bun:test";
import { fromKernelState } from "../../src/assembly/from-kernel-state.js";
import { project } from "../../src/assembly/project.js";
import type { KernelState } from "../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";

/**
 * Golden-trace proof. Experiment (b) (wiki/Research/Debriefs/2026-05-31-steering-
 * experiment-b-verdict.md) could NOT capture a clean [overflow → summary+ref →
 * unblocked reference] run because the legacy assembly path was non-deterministic
 * across identical-config runs. The canonical pipeline is pure + total, so the SAME
 * KernelState yields the SAME AssemblyTrace every time. This test pins that.
 */

function makeState(overrides: Partial<KernelState> = {}): KernelState {
  return {
    taskId: "golden",
    strategy: "reactive",
    kernelType: "react",
    steps: [],
    toolsUsed: new Set(),
    scratchpad: new Map(),
    iteration: 3,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    status: "thinking",
    output: null,
    error: null,
    llmCalls: 0,
    meta: {},
    controllerDecisionLog: [],
    messages: [],
    ...overrides,
  } as KernelState;
}

// A 126k-char stored result — the real overflow scenario from the wire debrief.
const BIG_COMMITS = Array.from({ length: 300 }, (_, i) => ({
  sha: `sha${i}`,
  commit: { message: `commit message ${i} ${"detail ".repeat(40)}` },
}));
const STORED_KEY = "_tool_result_1";

const overflowState = makeState({
  messages: [
    { role: "user", content: "List every commit and write them all to a file" },
    {
      role: "assistant",
      content: "Calling list_commits.",
      toolCalls: [{ id: "c1", name: "github/list_commits", arguments: { limit: 300 } }],
    },
    {
      role: "tool_result",
      toolCallId: "c1",
      toolName: "github/list_commits",
      content: `[STORED:${STORED_KEY}]`,
      storedKey: STORED_KEY,
    },
  ],
  scratchpad: new Map([[STORED_KEY, JSON.stringify(BIG_COMMITS)]]),
});

const persona = { system: "You are a reasoning agent." };
const tools = { schemas: [{ name: "write_result_to_file" }, { name: "github/list_commits" }] };
const profile = CONTEXT_PROFILES.mid;

describe("golden trace — deterministic overflow projection", () => {
  it("a 126k-char overflow result projects to preview+ref (no marker, no recall hint)", () => {
    const { request, trace } = project(fromKernelState(overflowState, profile, persona, tools));

    // The big result is the failure that experiment (b) chased: it MUST be projected
    // to a bounded preview+ref, never inlined whole. (#1: bounded content preview +
    // ref, replacing the bare shape-only summarize that regressed Phase-4.)
    const summarized = trace.messages.filter((m) => m.projection === "preview+ref");
    expect(summarized.length).toBe(1);

    const tr = request.messages.find((m) => m.role === "tool_result")!;
    expect(tr.content).toContain(`result_ref="${STORED_KEY}"`);
    expect(tr.content).not.toContain("[STORED:");
    expect(tr.content).not.toContain("recall(");
    // Bounded: a 126k-char result must not inline whole.
    expect(tr.content.length).toBeLessThan(126_000 / 2);

    // Provider-valid thread: opens user(goal), assistant(tool_use), then the summary.
    expect(request.messages[0]!.role).toBe("user");
    expect(request.messages.some((m) => m.role === "assistant")).toBe(true);

    // The reference tool survives selection (no prune) so the model can act by ref.
    expect(trace.tools).toContain("write_result_to_file");

    // Full data stays recoverable system-side (300 bullets).
    const input = fromKernelState(overflowState, profile, persona, tools);
    expect(input.store.materialize(STORED_KEY, "bullets").split("\n").length).toBe(300);
  });

  it("is deterministic: identical input → byte-identical trace across runs", () => {
    const run = () => JSON.stringify(project(fromKernelState(overflowState, profile, persona, tools)).trace);
    const a = run();
    const b = run();
    const c = run();
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("a small result that fits the budget is shown FULL (not over-summarized)", () => {
    const smallState = makeState({
      messages: [
        { role: "user", content: "ping once" },
        { role: "assistant", content: "", toolCalls: [{ id: "c9", name: "ping", arguments: {} }] },
        { role: "tool_result", toolCallId: "c9", toolName: "ping", content: "pong", storedKey: "_tool_result_9" },
      ],
      scratchpad: new Map([["_tool_result_9", JSON.stringify({ ok: true })]]),
    });
    const { trace } = project(fromKernelState(smallState, profile, persona, tools));
    expect(trace.messages.some((m) => m.projection === "full")).toBe(true);
    expect(trace.messages.some((m) => m.projection === "preview+ref")).toBe(false);
  });
});
