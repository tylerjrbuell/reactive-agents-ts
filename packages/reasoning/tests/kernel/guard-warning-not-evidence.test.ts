// Run: bun test packages/reasoning/tests/kernel/guard-warning-not-evidence.test.ts --timeout 20000
//
// Design law 5 (one progress arbiter): only substantive tool results are
// progress. A guard that blocks a call (repetitionGuard's "already called X N
// times", duplicateGuard's "[Already done ...]") returns HARNESS-authored text as
// the call's observation. Found while pinning H3 defect 1 (2026-11-05): that
// warning was projected to the ledger as a success:true tool-result for the real
// tool, so assess() credited it as new evidence (evidenceDelta 1) and reset the
// evidence-staleness clock on a pass that produced nothing.
//
// RED-ON-CUT: in progress-arbiter.ts classifyToolResult, drop the
// `if (harnessAuthored) return nonProgress("harness-authored")` line and the
// end-to-end test fails (evidenceDelta 1 on the warning pass).
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import type { KernelInput, KernelRunOptions } from "../../src/kernel/state/kernel-state.js";
import { classifyToolResult } from "../../src/kernel/assessment/progress-arbiter.js";
import { stepToEntries } from "../../src/kernel/ledger/step-projection.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import { GUARD_OBSERVATION_TAG } from "../../src/kernel/state/kernel-constants.js";

const P = (name: string, type = "string") => ({ name, type, required: true });
const SCHEMAS = [{ name: "probe", description: "probe a source", parameters: [P("q")] }];

let padN = 0;
const pad = (): string => {
  padN += 1;
  return Array.from({ length: 450 }, (_, i) => `g${padN}x${i}`).join(" ");
};
const call = (name: string, args: Record<string, unknown>) => ({ text: pad(), toolCall: { name, args } });

const input: KernelInput = {
  task: "Probe the source and report what it says.",
  availableToolSchemas: SCHEMAS,
  contextProfile: { tier: "local" },
} as KernelInput;

const opts: KernelRunOptions = {
  maxIterations: 6,
  strategy: "reactive",
  kernelType: "react",
  taskId: "guard-warning-not-evidence",
  modelId: "llama3.2:3b",
};

// probe never lands evidence: every real call fails. A failed prior result does
// not trip duplicateGuard, so the third identical call reaches repetitionGuard
// and gets "already called probe 2 times" back as a success:true observation.
const tools = mockToolServiceLayer({
  execute: () => Effect.succeed({ success: false, result: "upstream timeout" }),
  getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: SCHEMAS[0]!.parameters }),
});

describe("a guard's own warning is never credited as evidence", () => {
  it("the repeat-call warning pass keeps evidenceDelta 0", async () => {
    const { steps, deltas } = await Effect.runPromise(
      Effect.gen(function* () {
        const events = yield* Ref.make<AgentEvent[]>([]);
        const bus = yield* EventBus;
        yield* bus.subscribe((ev) => Ref.update(events, (xs) => [...xs, ev]));
        const pass = yield* runPass(reactKernel, input, opts);
        const raw = yield* Ref.get(events);
        const deltas = raw.flatMap((e) => (e._tag === "AssessmentEmitted" ? [e.evidenceDelta] : []));
        return { steps: pass.state.steps, deltas };
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            TestLLMServiceLayer([
              call("probe", { q: "source a" }),
              call("probe", { q: "source a" }),
              call("probe", { q: "source a" }),
              { text: "The source returned nothing." },
            ]),
            tools,
            EventBusLive,
          ),
        ),
      ),
    );
    const warnings = steps.filter((s) => s.type === "observation" && s.content.includes("already called probe 2 times"));
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.every((s) => s.metadata?.frameworkInstrumentation === GUARD_OBSERVATION_TAG)).toBe(true);
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.every((d) => d === 0)).toBe(true);
  });
});

describe("guard-authored observations (seam pin)", () => {
  const warning =
    "⚠️ You have already called probe 2 times. Stop repeating this tool. Use final-answer if you already have what you need; otherwise try a different tool or different arguments.";

  it("the ledger projection marks a guard observation harness-authored", () => {
    const step = makeStep("observation", warning, {
      toolCallId: "c3",
      frameworkInstrumentation: GUARD_OBSERVATION_TAG,
      observationResult: makeObservationResult("probe", true, warning),
    });
    const [entry] = stepToEntries(step, 3);
    expect(entry).toMatchObject({ kind: "tool-result", toolName: "probe", success: true, harnessAuthored: true });
  });

  it("a real tool observation is not marked", () => {
    const step = makeStep("observation", "KEY FACT: 12%", {
      toolCallId: "c1",
      observationResult: makeObservationResult("probe", true, "KEY FACT: 12%"),
    });
    const [entry] = stepToEntries(step, 1);
    expect(entry && "harnessAuthored" in entry).toBe(false);
  });

  it("the arbiter classifies harness-authored content as non-progress", () => {
    expect(classifyToolResult("probe", true, warning, true)).toEqual({ kind: "non-progress", reason: "harness-authored" });
    expect(classifyToolResult("probe", true, warning).kind).toBe("substantive");
  });
});
