import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { applyStrategySwitch } from "../src/kernel/loop/runner-helpers/strategy-switch.js";
import { initialKernelState, transitionState } from "../src/kernel/state/kernel-state.js";
import {
  makeKernelContext,
  makeKernelHooks,
  makeKernelInput,
  makeKernelRunOptions,
} from "../src/testing/kernel-fixtures.js";
import { appendEntry } from "../src/kernel/ledger/run-ledger.js";
import { renderStandingFrame } from "../src/assembly/standing-frame.js";
import { makeStep } from "../src/kernel/capabilities/sense/step-utils.js";

const hooks = makeKernelHooks();
const options = makeKernelRunOptions({ strategy: "reactive" });
const input = makeKernelInput({ task: "t", requiredTools: [] });
const context = makeKernelContext({ input });

const priorWithLedger = () => {
  const s = initialKernelState(options);
  const ledger = appendEntry(s.ledger, {
    kind: "harness-signal",
    iteration: 1,
    signal: "prior-fact",
  });
  return transitionState(transitionState(s, { ledger }), { iteration: 3 });
};

/**
 * A prior state that ALSO carries a real, successful `observation` step (with
 * a `toolCallId`) added via `transitionState`'s ordinary steps-growth path —
 * so it already has a matching `tool-result` ledger entry, exactly like a
 * live run. This is the concrete duplication scenario Step 4 named: carrying
 * `priorState.ledger` forward AND re-appending this same step (via
 * `carriedObservations`) must not mint a SECOND `tool-result` for the same
 * call. `priorWithLedger()` alone cannot exercise this — it never adds an
 * observation step, so `carriedObservations` stays empty and the dedupe path
 * never runs (the gap a prior review round found).
 */
const priorWithObservation = () => {
  let s = initialKernelState(options);
  const okStep = makeStep("observation", "search found 3 results", {
    toolCallId: "call-1",
    observationResult: {
      toolName: "web-search",
      success: true,
      displayText: "search found 3 results",
      category: "data" as const,
      resultKind: "success" as const,
      preserveOnCompaction: true,
      trustLevel: "untrusted" as const,
    },
  });
  s = transitionState(s, { steps: [...s.steps, okStep] });
  return transitionState(s, { iteration: 3 });
};

const doSwitch = (state: ReturnType<typeof priorWithLedger> = priorWithLedger()) =>
  Effect.runPromise(
    applyStrategySwitch({
      state,
      currentInput: input,
      context,
      options,
      hooks,
      triedStrategies: ["reactive"],
      switchCount: 0,
      fromStrategy: "reactive",
      toStrategy: "plan-execute-reflect",
      failureReason: "loop detected",
    }),
  );

describe("strategy switch — ledger", () => {
  test("prior ledger facts survive the switch", async () => {
    const r = await doSwitch();
    expect((r.state.ledger ?? []).some((e) => e.kind === "harness-signal" && e.signal === "prior-fact")).toBe(true);
  });

  test("the switch mints exactly one handoff entry", async () => {
    const r = await doSwitch();
    const handoffs = (r.state.ledger ?? []).filter((e) => e.kind === "handoff");
    expect(handoffs).toHaveLength(1);
    const h = handoffs[0]!;
    if (h.kind !== "handoff") throw new Error("narrow");
    expect(h.from).toBe("reactive");
    expect(h.to).toBe("plan-execute-reflect");
    expect(h.summary).toContain("loop detected");
  });

  test("handoff is no longer string-folded into priorContext", async () => {
    const r = await doSwitch();
    expect(r.currentInput.priorContext ?? "").not.toContain("Strategy Switch Handoff");
  });

  test("the standing frame renders the handoff from the ledger", async () => {
    const r = await doSwitch();
    const frame = renderStandingFrame({ ledger: r.state.ledger } as Parameters<typeof renderStandingFrame>[0]);
    expect(frame.sections.map((s) => s.name)).toContain("handoff");
  });

  // Step 4 guard: carrying `priorState.ledger` forward means any carried
  // observation `steps` growth must not re-project a SECOND `tool-result`
  // entry for a call id the carried ledger already recorded. Uses
  // `priorWithObservation()` — a fixture with a REAL successful observation
  // step (toolCallId "call-1") that already has a matching `tool-result` in
  // `priorState.ledger` AND is eligible to be re-added via
  // `carriedObservations` on switch, so this actually exercises the
  // duplicate-producing path (a fixture with no observation steps, like
  // `priorWithLedger()`, cannot: `carriedObservations` stays empty and the
  // dedupe call is never reached — confirmed by review round 1's mutation
  // test finding this gap).
  test("no tool-result is duplicated for the same call id after the carry", async () => {
    const r = await doSwitch(priorWithObservation());
    const toolResults = (r.state.ledger ?? []).filter((e) => e.kind === "tool-result");
    const callIds = toolResults.map((e) => (e.kind === "tool-result" ? e.toolCallId : undefined)).filter(
      (id): id is string => id !== undefined,
    );
    // The concrete scenario: exactly ONE tool-result for "call-1", not two.
    expect(callIds.filter((id) => id === "call-1")).toHaveLength(1);
    expect(new Set(callIds).size).toBe(callIds.length);
  });
});
