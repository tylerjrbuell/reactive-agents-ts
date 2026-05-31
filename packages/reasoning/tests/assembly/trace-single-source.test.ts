import { describe, it, expect } from "bun:test";
import { fromKernelState } from "../../src/assembly/from-kernel-state.js";
import { project } from "../../src/assembly/project.js";
import type { KernelState } from "../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";

/**
 * The AssemblyTrace is the observability artifact (RA_ASSEMBLY_TRACE debug +
 * cohort analysis). It MUST faithfully mirror the assembled request — same turns,
 * same order, no duplicates. Before this test, trace.messages was double-recorded:
 * project-results recorded assistant turns inline AND finalize re-recorded every
 * non-tool_result, so assistants appeared twice and the goal landed LAST (≠ the
 * real thread, which opens with the goal). That misleads anyone reading the trace
 * to debug (it misled the 2026-05-31 grid read). This pins single-source ordering.
 */
function makeState(overrides: Partial<KernelState> = {}): KernelState {
  return {
    taskId: "trace-src",
    strategy: "reactive",
    kernelType: "react",
    steps: [],
    toolsUsed: new Set(),
    scratchpad: new Map(),
    iteration: 2,
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

const state = makeState({
  messages: [
    { role: "user", content: "List commits then write them to a file" },
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "github/list_commits", arguments: {} }] },
    { role: "tool_result", toolCallId: "c1", toolName: "github/list_commits", content: "[STORED:_k1]", storedKey: "_k1" },
  ],
  scratchpad: new Map([["_k1", JSON.stringify([{ sha: "a", msg: "one" }])]]),
});

describe("AssemblyTrace is single-source and order-faithful to the request", () => {
  it("trace.messages roles match request.messages roles 1:1, in order", () => {
    const { request, trace } = project(
      fromKernelState(state, CONTEXT_PROFILES.mid, { system: "sys" }, { schemas: [{ name: "github/list_commits" }] }),
    );
    const reqRoles = request.messages.map((m) => m.role);
    const traceRoles = trace.messages.map((m) => m.role);
    expect(traceRoles).toEqual(reqRoles);
  });

  it("opens with the goal (user) — no assistant recorded before it", () => {
    const { trace } = project(
      fromKernelState(state, CONTEXT_PROFILES.mid, { system: "sys" }, { schemas: [{ name: "github/list_commits" }] }),
    );
    expect(trace.messages[0]!.role).toBe("user");
  });

  it("records each turn exactly once (no double-recorded assistants)", () => {
    const { request, trace } = project(
      fromKernelState(state, CONTEXT_PROFILES.mid, { system: "sys" }, { schemas: [{ name: "github/list_commits" }] }),
    );
    expect(trace.messages.length).toBe(request.messages.length);
  });
});
