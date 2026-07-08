import { describe, it, expect } from "bun:test";
import { compact, type CompactMessage, type ResultInfo } from "../../src/assembly/compaction.js";
import {
  mintScratchpadRef,
  isRecallableRef,
  SURFACED_RECALL_REF,
  surfacedRecallRefs,
} from "../../src/assembly/ref-grammar.js";
import { fromKernelState } from "../../src/assembly/from-kernel-state.js";
import { project } from "../../src/assembly/project.js";
import { ResultStore } from "../../src/assembly/result-store.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import type { KernelState } from "../../src/kernel/state/kernel-state.js";
import type { ReasoningStep } from "../../src/types/index.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";

// ── C4 acceptance: compaction property tests ─────────────────────────────────
// The single compaction path re-projects the window while PROTECTING declared
// classes (goal / preserveOnCompaction / recent evidence), enumerates dropped
// refs honestly (no "summarized" lie), and either shrinks or fires an event.

/** Provider-validity invariant (native-FC): opens with user; no orphan tool_result. */
function assertValidThread(messages: readonly CompactMessage[]) {
  expect(messages.length).toBeGreaterThan(0);
  expect(messages[0]!.role).toBe("user");
  let openIds = new Set<string>();
  for (const m of messages) {
    if (m.role === "assistant" && Array.isArray(m.toolCalls)) {
      openIds = new Set((m.toolCalls as Array<{ id: string }>).map((tc) => tc.id));
    } else if (m.role === "tool_result") {
      expect(m.toolCallId).toBeDefined();
      expect(openIds.has(m.toolCallId!)).toBe(true);
      openIds.delete(m.toolCallId!);
    } else if (m.role === "assistant") {
      openIds = new Set();
    }
  }
}

/** Build a thread of N assistant→tool_result exchanges, each result ~size chars. */
function buildThread(
  n: number,
  size: number,
  opts?: { preserveIdx?: number },
): { messages: CompactMessage[]; resultInfo: Map<string, ResultInfo>; refs: string[] } {
  const messages: CompactMessage[] = [{ role: "user", content: "GOAL: research the thing" }];
  const resultInfo = new Map<string, ResultInfo>();
  const refs: string[] = [];
  for (let i = 0; i < n; i++) {
    const callId = `c${i}`;
    const ref = mintScratchpadRef(i);
    refs.push(ref);
    messages.push({ role: "assistant", content: "", toolCalls: [{ id: callId, name: "web-search", arguments: {} }] });
    messages.push({ role: "tool_result", toolCallId: callId, toolName: "web-search", content: "x".repeat(size) });
    resultInfo.set(callId, { ref, preserve: opts?.preserveIdx === i });
  }
  return { messages, resultInfo, refs };
}

describe("compaction — protected classes survive", () => {
  it("goal + preserved + recent survive; only droppable old evidence is stubbed", () => {
    // 6 exchanges of 500 chars each = 3000 chars of results; preserve exchange #1.
    const { messages, resultInfo, refs } = buildThread(6, 500, { preserveIdx: 1 });
    const before = messages.reduce((n, m) => n + m.content.length, 0);
    const r = compact({ messages, limitChars: 1000, resultInfo });

    expect(r.attempted).toBe(true);
    // goal survives at the front
    expect(r.messages[0]!.role).toBe("user");
    expect(r.messages[0]!.content).toContain("GOAL:");
    // the preserved result (#1) survives even though it is OLD
    const survivingResults = r.messages.filter((m) => m.role === "tool_result");
    expect(survivingResults.some((m) => m.toolCallId === "c1")).toBe(true);
    // the most-recent evidence (#5) survives
    expect(survivingResults.some((m) => m.toolCallId === "c5")).toBe(true);
    // some old droppable evidence was dropped
    expect(r.droppedBlocks).toBeGreaterThan(0);
    expect(r.droppedRefs.length).toBeGreaterThan(0);
    // dropped refs are droppable ones — NOT the preserved/goal/recent
    expect(r.droppedRefs).not.toContain(refs[1]!); // preserved
    expect(r.droppedRefs).not.toContain(refs[5]!); // recent
    // strictly shrank
    expect(messages.reduce((n, m) => n + m.content.length, 0)).toBe(before);
    const after = r.messages.reduce((n, m) => n + m.content.length, 0);
    expect(after).toBeLessThan(before);
    assertValidThread(r.messages);
  });
});

describe("compaction — preserveOnCompaction is LIVE (audit 03-F4)", () => {
  it("PIN old behavior: without preserve, an old exchange IS dropped", () => {
    const { messages, resultInfo, refs } = buildThread(6, 500); // no preserve
    const r = compact({ messages, limitChars: 1000, resultInfo });
    // the oldest exchange (#0) is dropped when nothing protects it
    expect(r.droppedRefs).toContain(refs[0]!);
  });

  it("NEW behavior: preserve:true on the SAME old exchange keeps it", () => {
    const { messages, resultInfo, refs } = buildThread(6, 500, { preserveIdx: 0 });
    const r = compact({ messages, limitChars: 1000, resultInfo });
    // #0 is now protected → survives, never in droppedRefs
    expect(r.droppedRefs).not.toContain(refs[0]!);
    expect(r.messages.filter((m) => m.role === "tool_result").some((m) => m.toolCallId === "c0")).toBe(true);
  });
});

describe("compaction — strictly shrinks OR event fires", () => {
  it("droppable content present → shrinks, no event", () => {
    const { messages, resultInfo } = buildThread(6, 500);
    const before = messages.reduce((n, m) => n + m.content.length, 0);
    const r = compact({ messages, limitChars: 1000, resultInfo });
    expect(r.shrank).toBe(true);
    expect(r.noShrinkEvent).toBe(false);
    expect(r.messages.reduce((n, m) => n + m.content.length, 0)).toBeLessThan(before);
  });

  it("everything protected → does NOT shrink → no-shrink event fires (not silent)", () => {
    // Every exchange preserved AND they are all recent-or-preserved → nothing droppable.
    const messages: CompactMessage[] = [{ role: "user", content: "GOAL" }];
    const resultInfo = new Map<string, ResultInfo>();
    for (let i = 0; i < 4; i++) {
      const callId = `c${i}`;
      messages.push({ role: "assistant", content: "", toolCalls: [{ id: callId, name: "t", arguments: {} }] });
      messages.push({ role: "tool_result", toolCallId: callId, toolName: "t", content: "y".repeat(500) });
      resultInfo.set(callId, { ref: mintScratchpadRef(i), preserve: true });
    }
    const r = compact({ messages, limitChars: 100, resultInfo });
    expect(r.attempted).toBe(true);
    expect(r.shrank).toBe(false);
    expect(r.noShrinkEvent).toBe(true);
    expect(r.droppedBlocks).toBe(0);
  });

  it("under budget → no-op, not attempted, no event", () => {
    const { messages, resultInfo } = buildThread(2, 50);
    const r = compact({ messages, limitChars: 100_000, resultInfo });
    expect(r.attempted).toBe(false);
    expect(r.noShrinkEvent).toBe(false);
    expect(r.droppedRefs.length).toBe(0);
  });
});

describe("compaction — every stub ref is resolvable (no summarized lie)", () => {
  it("stub enumerates dropped recallable refs, each matched by the ONE grammar + in the store", () => {
    const { messages, resultInfo, refs } = buildThread(6, 500);
    // A store that holds every ref (the compaction never mutates it).
    const store = new ResultStore();
    for (const ref of refs) store.putWithRef(ref, "web-search", { ok: true });

    const r = compact({ messages, limitChars: 1000, resultInfo });
    // find the stub (the injected user summary carrying recall pointers)
    const stub = r.messages.find(
      (m) => m.role === "user" && m.content.includes("history compacted"),
    );
    expect(stub).toBeDefined();
    // it does NOT claim a bare "summarized" with no pointers
    const enumerated = surfacedRecallRefs(stub!.content);
    expect(enumerated.length).toBeGreaterThan(0);
    // every enumerated ref: matched by the gate grammar AND resolvable in the store
    for (const ref of enumerated) {
      expect(isRecallableRef(ref)).toBe(true);
      expect(SURFACED_RECALL_REF.test(`recall("${ref}"`)).toBe(true);
      expect(store.has(ref)).toBe(true);
    }
    // every enumerated ref was actually dropped
    for (const ref of enumerated) expect(r.droppedRefs).toContain(ref);
  });
});

// ── Wiring: preserveOnCompaction flows step → EventLog → compaction ────────────

function makeStep(id: string, type: ReasoningStep["type"], metadata?: ReasoningStep["metadata"]): ReasoningStep {
  return { id: id as ReasoningStep["id"], type, content: "obs", timestamp: new Date(), metadata };
}

function stateWithObservation(callId: string, success: boolean, content: string): KernelState {
  const obs = makeObservationResult("web-search", success, content);
  return {
    taskId: "c4-wiring",
    strategy: "reactive",
    kernelType: "react",
    steps: [makeStep("s1", "observation", { observationResult: obs, toolCallId: callId })],
    toolsUsed: new Set(["web-search"]),
    scratchpad: new Map<string, string>(),
    iteration: 1,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    status: "thinking",
    output: null,
    error: null,
    llmCalls: 1,
    meta: {},
    controllerDecisionLog: [],
    messages: [
      { role: "user", content: "do it" },
      { role: "assistant", content: "", toolCalls: [{ id: callId, name: "web-search", arguments: {} }] },
      { role: "tool_result", toolCallId: callId, toolName: "web-search", content },
    ],
  } as KernelState;
}

describe("from-kernel-state — reads preserveOnCompaction (the flag that was dead)", () => {
  it("a failed observation (preserve=true) sets preserve on its tool_result event", () => {
    // makeObservationResult marks !success as preserveOnCompaction:true.
    const input = fromKernelState(stateWithObservation("c1", false, "boom"), CONTEXT_PROFILES.mid, { system: "A" }, { schemas: [] });
    const ev = input.log.byKind("tool_result").find((e) => e.callId === "c1");
    expect(ev).toBeDefined();
    expect(ev!.preserve).toBe(true);
  });

  it("a successful observation (preserve=false) leaves preserve unset", () => {
    const input = fromKernelState(stateWithObservation("c2", true, "fine"), CONTEXT_PROFILES.mid, { system: "A" }, { schemas: [] });
    const ev = input.log.byKind("tool_result").find((e) => e.callId === "c2");
    expect(ev).toBeDefined();
    expect(ev!.preserve).toBeUndefined();
  });
});

describe("project() — compaction trace is populated end-to-end", () => {
  it("over-budget projection reports droppedRefs + shrank on the trace", () => {
    // Tiny window forces compaction; many exchanges so there is droppable history.
    const messages: KernelState["messages"] = [{ role: "user", content: "research many things" }];
    const scratchpad = new Map<string, string>();
    const steps: ReasoningStep[] = [];
    for (let i = 0; i < 8; i++) {
      const callId = `c${i}`;
      const storedKey = mintScratchpadRef(i);
      scratchpad.set(storedKey, JSON.stringify({ blob: "z".repeat(400) }));
      messages.push({ role: "assistant", content: "", toolCalls: [{ id: callId, name: "web-search", arguments: {} }] });
      messages.push({ role: "tool_result", toolCallId: callId, toolName: "web-search", content: `[STORED:${storedKey}]`, storedKey });
      steps.push(makeStep(`s${i}`, "observation", { observationResult: makeObservationResult("web-search", true, "ok"), toolCallId: callId }));
    }
    const state = {
      taskId: "c4-e2e", strategy: "reactive", kernelType: "react", steps,
      toolsUsed: new Set(["web-search"]), scratchpad, iteration: 8, tokens: 0,
      inputTokens: 0, outputTokens: 0, cost: 0, status: "thinking", output: null,
      error: null, llmCalls: 8, meta: {}, controllerDecisionLog: [], messages,
    } as KernelState;

    const tinyProfile = { ...CONTEXT_PROFILES.mid, maxTokens: 200 };
    const input = fromKernelState(state, tinyProfile, { system: "A" }, { schemas: [{ name: "recall" }] });
    const { request, trace } = project(input);

    expect(trace.compaction).toBeDefined();
    expect(trace.compaction!.shrank).toBe(true);
    expect(trace.compaction!.droppedRefs.length).toBeGreaterThan(0);
    // thread still opens with a user turn
    expect(request.messages[0]!.role).toBe("user");
  });
});
