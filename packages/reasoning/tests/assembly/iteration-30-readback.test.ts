import { describe, it, expect } from "bun:test";
import { fromKernelState } from "../../src/assembly/from-kernel-state.js";
import { project } from "../../src/assembly/project.js";
import type { KernelState } from "../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js";
import {
  SURFACED_RECALL_REF,
  isRecallableRef,
  mintScratchpadRef,
} from "../../src/assembly/ref-grammar.js";
import { recallKeyVisibleInWindow } from "../../src/kernel/capabilities/reason/think-guards.js";

// ── Sweep acceptance #3: iteration-30 read-back ───────────────────────────────
// A fact stored at iteration 3 must be retrievable at iteration 30 via its ref,
// through the ONE grammar — proving the ref the projector emitted at iter 3
// resolves after 27 more iterations (the long-horizon read-back the sweep
// found dead: refs the projector minted the recall gate never accepted).

const FACT_REF = mintScratchpadRef(3); // "_tool_result_3"
const SENTINEL = "SENTINEL-FACT-42-open-PRs";
// A large payload so the projector compresses it to preview+ref (the path that
// emits a recall pointer), and one that carries the sentinel fact.
const BIG_FACT = {
  sentinel: SENTINEL,
  rows: Array.from({ length: 400 }, (_, i) => ({ id: i, note: `detail row ${i} lorem ipsum` })),
};

/** Build a 30-iteration KernelState. Iteration 3 stores BIG_FACT under FACT_REF;
 *  every other iteration is a small gather so the thread stays modest. */
function make30IterState(): KernelState {
  const messages: KernelState["messages"] = [
    { role: "user", content: "Research many things across 30 steps then report." },
  ];
  const scratchpad = new Map<string, string>();
  for (let i = 1; i <= 30; i++) {
    const callId = `c${i}`;
    const isFactStep = i === 3;
    const storedKey = mintScratchpadRef(i);
    const value = isFactStep ? BIG_FACT : { small: `result ${i}` };
    scratchpad.set(storedKey, JSON.stringify(value));
    messages.push({
      role: "assistant",
      content: `step ${i}`,
      toolCalls: [{ id: callId, name: "web-search", arguments: { q: `query ${i}` } }],
    });
    messages.push({
      role: "tool_result",
      toolCallId: callId,
      toolName: "web-search",
      content: `[STORED:${storedKey}]`,
      storedKey,
    });
  }
  return {
    taskId: "lh-readback",
    strategy: "reactive",
    kernelType: "react",
    steps: [],
    toolsUsed: new Set(["web-search"]),
    scratchpad,
    iteration: 30,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    status: "thinking",
    output: null,
    error: null,
    llmCalls: 30,
    meta: {},
    controllerDecisionLog: [],
    messages,
  } as KernelState;
}

const persona = { system: "You are a long-horizon research agent." };
const tools = { schemas: [{ name: "recall" }] as readonly unknown[] };
const profile = CONTEXT_PROFILES.mid;

describe("iteration-30 read-back — iter-3 fact resolvable at iter 30 via the ONE grammar", () => {
  it("the fact stored at iteration 3 survives to iteration 30 in the store", () => {
    const input = fromKernelState(make30IterState(), profile, persona, tools);
    const stored = input.store.get(FACT_REF);
    expect(stored).toBeDefined();
    expect((stored?.value as { sentinel: string }).sentinel).toBe(SENTINEL);
    expect(stored?.recallable).toBe(true); // seeded via putWithRef → recall-resolvable
  });

  it("the iter-3 ref is a recallable ref the gate matcher accepts", () => {
    const input = fromKernelState(make30IterState(), profile, persona, tools);
    // The projector's own recall-hint for this ref is matched by the gate.
    const hint = input.store.summarize(FACT_REF);
    expect(isRecallableRef(FACT_REF)).toBe(true);
    expect(SURFACED_RECALL_REF.test(hint)).toBe(true);
    expect(hint).toContain(`recall("${FACT_REF}"`);
  });

  it("project() emits a recall-resolvable pointer for the iter-3 fact, and it resolves", () => {
    const input = fromKernelState(make30IterState(), profile, persona, tools);
    const { request } = project(input);

    // The projector rendered the iter-3 result as a preview+ref carrying a
    // recall pointer to FACT_REF (the big result overflows → preview+ref path).
    const carriers = request.messages.filter(
      (m) => typeof m.content === "string" && m.content.includes(`recall("${FACT_REF}"`),
    );
    expect(carriers.length).toBeGreaterThan(0);

    // Every recall ref the projector emitted for this fact resolves in the store
    // (no dead pointer) — the round-trip that was structurally dead pre-C3.
    for (const m of carriers) {
      const refs = [...(m.content as string).matchAll(/recall\("([^"]+)"/g)].map((x) => x[1]!);
      for (const ref of refs) {
        if (ref === FACT_REF) expect(input.store.get(ref)).toBeDefined();
      }
    }

    // …and the recall gate unlocks recall at iteration 30 because the pointer is
    // visible in the projected window (the SAME matcher the projector feeds).
    expect(
      recallKeyVisibleInWindow(
        request.messages.map((m) => ({ role: m.role, content: m.content })),
      ),
    ).toBe(true);
  });
});
