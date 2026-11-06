// Run: bun test packages/reasoning/tests/kernel/seam-refusal-not-failure.test.ts --timeout 20000
//
// A tool-gate refusal is not a tool failure, and correct required calls are
// not deferred. H3 at 6a6a7f4d5 (ledger entry 24, trace
// 01M6Q3F6Z90Q97DB1C4JMAG9S2 seq 189-223): the model emitted 6 correct
// file-writes in one turn; the gate ran only the first required batch and
// answered the other 5 with an error tool_result; the reactive observer read
// those as 5 consecutive file-write failures, tool-failure-redirect fired, and
// dispatcher_early_stop ended the run that same turn (h3-todo-heavy 0/5).
//
// Pins:
//   (a) refusals never advance the tool-failure streak, so the controller is
//       never told about one and the run is not early-stopped;
//   (b) every required call of a turn runs that turn, non-parallel-safe calls
//       one at a time;
//   (c) control: an error tool_result that is not a refusal still counts.
//
// RED-ON-CUT (shown during the mission, then restored):
//   - drop the `refused` skip in reflect/tool-failure-streak.ts: (a) fails
//     (streak 3, run ends on dispatcher_early_stop);
//     (cut shown: `controller_early_stop:dispatcher_early_stop`, the H3 terminal);
//   - admit only the first required call (`settle(towardMissing.slice(0, 1), ...)`)
//     in decide/tool-gating.ts: (b) and (b2) fail (1 write runs, rest refused).
//   - drop the `isError` spread for failed observations in
//     act/conversation-assembly.ts: (d) fails (`isError` undefined, streak 0,
//     the tool-failure-streak guard can never fire — Task #29).
import { describe, it, expect } from "bun:test";
import { Context, Effect, Layer, Ref } from "effect";
import { TestLLMServiceLayer, type TestTurn } from "@reactive-agents/llm-provider";
import { EntropySensorService, EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { toolFailureStreak } from "../../src/kernel/capabilities/reflect/tool-failure-streak.js";
import { isFailedToolObservation, blockedCallSteps } from "../../src/kernel/utils/observation-helpers.js";
import { refusalSteps } from "../../src/kernel/capabilities/decide/tool-call-refusals.js";
import { stepToEntries as projectStepToEntries } from "../../src/kernel/ledger/step-projection.js";
import { appendEntries } from "../../src/kernel/ledger/run-ledger.js";
import { assess, type BudgetState } from "../../src/kernel/assessment/assess.js";
import type { KernelInput, KernelMessage } from "../../src/kernel/state/kernel-state.js";

const schema = (name: string, param: string) => ({
  name,
  description: `${name} tool`,
  parameters: [{ name: param, type: "string", required: true }],
});
const SEARCH = schema("web-search", "query");
const WRITE = { ...schema("file-write", "path"), parameters: [{ name: "path", type: "string", required: true }, { name: "content", type: "string", required: true }] };

type GuardEvent = Extract<AgentEvent, { _tag: "GuardFiredEmitted" }>;

// ── Reactive-intelligence stubs (the reasoning package does not depend on it) ──
// The controller mirrors the real tool-failure-streak evaluator's threshold
// (consecutiveToolFailures >= 2 on one tool); the dispatcher mirrors the
// escalation to an early-stop patch.
const calibration = { modelId: "test", calibrated: false, sampleCount: 0, highEntropyThreshold: 0.8, convergenceThreshold: 0.4, driftDetected: false };
const entropySensor: EntropySensorService["Type"] = {
  score: () =>
    Effect.succeed({
      composite: 0.5,
      sources: { token: 0, structural: 0.5, semantic: 0, behavioral: 0, contextPressure: 0 },
      trajectory: { derivative: 0, shape: "flat" as const, momentum: 0 },
      confidence: "high" as const,
      modelTier: "unknown" as const,
      iteration: 0,
      iterationWeight: 1,
      timestamp: Date.now(),
    }),
  scoreContext: () => Effect.succeed({ utilizationPct: 0, sections: [], atRiskSections: [], compressionHeadroom: 1 }),
  getCalibration: () => Effect.succeed(calibration),
  updateCalibration: () => Effect.succeed(calibration),
  getTrajectory: () => Effect.succeed({ history: [], derivative: 0, momentum: 0, shape: "flat" as const }),
};
const entropyLayer = Layer.succeed(EntropySensorService, entropySensor);

type Decision = { readonly decision: string; readonly reason: string };
type EvalParams = { readonly consecutiveToolFailures?: number; readonly failingToolName?: string };
const ControllerTag = Context.GenericTag<{ readonly evaluate: (p: EvalParams) => Effect.Effect<readonly Decision[]> }>("ReactiveControllerService");
const DispatcherTag = Context.GenericTag<{
  readonly dispatch: (d: readonly Decision[]) => Effect.Effect<{
    readonly appliedPatches: readonly { readonly decisionType: string; readonly patch: { readonly kind: string; readonly reason?: string } }[];
    readonly skipped: readonly { decisionType: string; reason: string }[];
    readonly totalCost: { tokens: number; latencyMs: number };
  }>;
}>("InterventionDispatcherService");

/** Run the real react kernel with the controller stubs; record streak reads and tool executions. */
async function run(input: KernelInput, turns: TestTurn[], opts: { readonly failTool?: string } = {}) {
  const executed: string[] = [];
  const order: string[] = [];
  const streaks: number[] = [];
  const tools = mockToolServiceLayer({
    execute: (req) =>
      Effect.gen(function* () {
        // Path healing resolves `path` to an absolute path; keep the basename.
        const raw = String((req.arguments as Record<string, unknown>)["path"] ?? (req.arguments as Record<string, unknown>)["query"] ?? "");
        const target = raw.split("/").pop() ?? raw;
        order.push(`start:${target}`);
        yield* Effect.sleep("2 millis");
        order.push(`end:${target}`);
        executed.push(req.toolName);
        return req.toolName === opts.failTool
          ? { success: false, result: "Error: upstream unavailable" }
          : { success: true, result: { ok: true, tool: req.toolName } };
      }),
  });
  const controller = Layer.succeed(ControllerTag, {
    evaluate: (p: EvalParams) => {
      streaks.push(p.consecutiveToolFailures ?? 0);
      return Effect.succeed(
        (p.consecutiveToolFailures ?? 0) >= 2 && p.failingToolName
          ? [{ decision: "tool-failure-redirect", reason: `"${p.failingToolName}" failed ${p.consecutiveToolFailures} times` }]
          : [],
      );
    },
  });
  const dispatcher = Layer.succeed(DispatcherTag, {
    dispatch: (ds: readonly Decision[]) =>
      Effect.succeed({
        appliedPatches: ds
          .filter((d) => d.decision === "tool-failure-redirect")
          .map((d) => ({ decisionType: d.decision, patch: { kind: "early-stop", reason: d.reason } })),
        skipped: [],
        totalCost: { tokens: 0, latencyMs: 0 },
      }),
  });
  const { pass, events } = await Effect.runPromise(
    Effect.gen(function* () {
      const log = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      yield* bus.subscribe((ev) => Ref.update(log, (xs) => [...xs, ev]));
      const pass = yield* runPass(reactKernel, input, { maxIterations: 6, strategy: "reactive", kernelType: "react", taskId: "refusal-not-failure" });
      return { pass, events: yield* Ref.get(log) };
    }).pipe(Effect.provide(Layer.mergeAll(TestLLMServiceLayer(turns), tools, EventBusLive, entropyLayer, controller, dispatcher))),
  );
  const refusals = events.filter((e): e is GuardEvent => e._tag === "GuardFiredEmitted" && e.guard === "tool-gate");
  return { pass, executed, order, streaks, refusals };
}

const terminatedBy = (pass: { readonly state: { readonly meta: Record<string, unknown> } }) => String(pass.state.meta["terminatedBy"] ?? "");

describe("a tool-gate refusal is not a tool failure", () => {
  it("(a) one run + three refused calls: the streak stays 0 and the run is not early-stopped", async () => {
    const { pass, executed, refusals, streaks } = await run(
      { task: "Write a.md", availableToolSchemas: [WRITE, SEARCH], requiredTools: ["file-write"] },
      [
        {
          toolCalls: [
            { id: "w1", name: "file-write", args: { path: "a.md", content: "A" } },
            { id: "s1", name: "web-search", args: { query: "x" } },
            { id: "s2", name: "web-search", args: { query: "y" } },
            { id: "s3", name: "web-search", args: { query: "z" } },
          ],
        },
        { text: "FINAL ANSWER: wrote a.md." },
      ],
    );
    expect(executed).toEqual(["file-write"]);
    expect(refusals.length).toBe(3);
    // The refusals are still answered as errors for the model.
    const s1 = pass.messages.find((m): m is Extract<KernelMessage, { role: "tool_result" }> => m.role === "tool_result" && m.toolCallId === "s1");
    expect(s1?.isError).toBe(true);
    expect(s1?.refused).toBe(true);
    // End to end first: the run is not early-stopped and ends on the model's answer.
    expect(terminatedBy(pass)).not.toContain("early_stop");
    expect(pass.output).toContain("wrote a.md");
    // The controller did evaluate (the stub is wired), and never saw a streak.
    expect(streaks.length).toBeGreaterThan(0);
    expect(Math.max(0, ...streaks)).toBe(0);
  }, 20000);

  it("(c) control: an error tool_result that is not a refusal still advances the streak", () => {
    const msg = (id: string, isError: boolean, refused = false): KernelMessage => ({
      role: "tool_result",
      toolCallId: id,
      toolName: "web-search",
      content: "x",
      ...(isError ? { isError: true } : {}),
      ...(refused ? { refused: true as const } : {}),
    });
    // The streak counts batches (seam-redirect-pending-batch.test.ts), so each
    // result here sits in its own assistant turn.
    const turn: KernelMessage = { role: "assistant", content: "", toolCalls: [{ id: "t", name: "web-search", arguments: {} }] };
    const turns = (...results: KernelMessage[]): KernelMessage[] => results.flatMap((r) => [turn, r]);
    expect(toolFailureStreak(turns(msg("1", false), msg("2", true), msg("3", true)))).toEqual({ count: 2, toolName: "web-search" });
    // Refusals are skipped: neither a failure nor a success.
    expect(toolFailureStreak(turns(msg("1", true), msg("2", true, true), msg("3", true)))).toEqual({ count: 2, toolName: "web-search" });
    expect(toolFailureStreak(turns(msg("1", false), msg("2", true, true), msg("3", true, true)))).toEqual({ count: 0, toolName: undefined });
  });

  it("(a2) step and ledger failure counters skip refusals; a real failure still counts", () => {
    const call = { id: "s1", name: "web-search", arguments: { query: "x" } };
    const [, refusedObs] = refusalSteps([{ call, kind: "required-first", reason: "not now." }], 1);
    const [, failedObs] = blockedCallSteps({ ...call, id: "s2" }, "Error: 500", false);
    expect(isFailedToolObservation(refusedObs!)).toBe(false);
    expect(isFailedToolObservation(failedObs!)).toBe(true);

    const refusedEntries = projectStepToEntries(refusedObs!, 1);
    expect(refusedEntries.find((e) => e.kind === "tool-result")).toMatchObject({ refused: true, success: false });
    const ledger = appendEntries(undefined, [
      { kind: "tool-result", iteration: 1, toolName: "web-search", success: false, preview: "err", toolCallId: "f1" },
      ...refusedEntries,
      ...projectStepToEntries(refusalSteps([{ call: { ...call, id: "s3" }, kind: "required-first", reason: "not now." }], 1)[1]!, 1),
    ]);
    const budget: BudgetState = { iteration: 1, maxIterations: 10, tokensUsed: 0, costUsd: 0 };
    const a = assess({ requirements: [], deliverables: [], constraints: [], horizon: "short", postConditions: [] }, ledger, budget);
    expect(a.health.consecutiveFailures).toBe(1);
    expect(a.health.recentFailures).toBe(1);
  });
});

describe("a real tool failure is a failure on the kernel path", () => {
  // Task #29: the kernel built tool_result messages without `isError`, so
  // toolFailureStreak always read 0 and the tool-failure-streak guard could
  // never fire. A failed observation (observationResult.success === false)
  // now marks its tool_result `isError: true` (act/conversation-assembly.ts).
  it("(d) a tool that fails twice running advances the streak and the guard fires", async () => {
    const { pass, executed, streaks } = await run(
      { task: "Search for x", availableToolSchemas: [SEARCH] },
      [
        { toolCalls: [{ id: "f1", name: "web-search", args: { query: "x" } }] },
        { toolCalls: [{ id: "f2", name: "web-search", args: { query: "x again" } }] },
        { toolCalls: [{ id: "f3", name: "web-search", args: { query: "x third" } }] },
        { text: "FINAL ANSWER: could not search." },
      ],
      { failTool: "web-search" },
    );
    expect(executed.length).toBeGreaterThanOrEqual(2);
    const f1 = pass.messages.find((m): m is Extract<KernelMessage, { role: "tool_result" }> => m.role === "tool_result" && m.toolCallId === "f1");
    expect(f1?.isError).toBe(true);
    expect(f1?.refused).toBeUndefined();
    expect(Math.max(0, ...streaks)).toBeGreaterThanOrEqual(2);
    expect(terminatedBy(pass)).toContain("early_stop");
  }, 20000);

  it("(d2) a successful call carries no isError", async () => {
    const { pass } = await run(
      { task: "Search for x", availableToolSchemas: [SEARCH] },
      [{ toolCalls: [{ id: "ok1", name: "web-search", args: { query: "x" } }] }, { text: "FINAL ANSWER: done." }],
    );
    const ok1 = pass.messages.find((m): m is Extract<KernelMessage, { role: "tool_result" }> => m.role === "tool_result" && m.toolCallId === "ok1");
    expect(ok1).toBeDefined();
    expect(ok1?.isError).toBeUndefined();
  }, 20000);
});

describe("every required call of a turn runs that turn", () => {
  it("(b) six distinct required file-writes in one turn: all six run, one at a time", async () => {
    const paths = ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md"];
    const { executed, refusals, order } = await run(
      { task: "Write six notes", availableToolSchemas: [WRITE, SEARCH], requiredTools: ["file-write"] },
      [
        { toolCalls: paths.map((p, i) => ({ id: `w${i + 1}`, name: "file-write", args: { path: p, content: p } })) },
        { text: "FINAL ANSWER: wrote six notes." },
      ],
    );
    expect(executed).toEqual(paths.map(() => "file-write"));
    expect(refusals.filter((e) => (e.metadata as { toolName: string }).toolName === "file-write")).toEqual([]);
    // Sequential: each write ends before the next starts, in emitted order.
    expect(order).toEqual(paths.flatMap((p) => [`start:${p}`, `end:${p}`]));
  }, 20000);

  it("(b2) required calls still run first; non-required calls are refused as before", async () => {
    const { executed, refusals } = await run(
      { task: "Write a.md and b.md", availableToolSchemas: [WRITE, SEARCH], requiredTools: ["file-write"] },
      [
        {
          toolCalls: [
            { id: "s1", name: "web-search", args: { query: "x" } },
            { id: "w1", name: "file-write", args: { path: "a.md", content: "A" } },
            { id: "w2", name: "file-write", args: { path: "b.md", content: "B" } },
          ],
        },
        { text: "FINAL ANSWER: wrote both." },
      ],
    );
    expect(executed).toEqual(["file-write", "file-write"]);
    expect(refusals.map((e) => (e.metadata as { toolCallId: string; kind: string }))).toMatchObject([{ toolCallId: "s1", kind: "required-first" }]);
  }, 20000);
});
