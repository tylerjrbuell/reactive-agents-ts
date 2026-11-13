// Run: bun test packages/reasoning/tests/kernel/loop-state-progress.test.ts --timeout 30000
//
// Loop detection measures STATE CHANGE, not call classification (design law #5),
// and a detection is answered with graduated guidance before it may stop a run.
//
// Real-trace root cause (Cortex run 01M78GC3H6JW5RWNRS7FCSC7X3): `todo` was called
// with varied args (start/done per row), each result a DIFFERENT list ("Todo (4/8
// done)" -> "(5/8 done)" -> "(7/8 done)"). `todo` is a META tool, so the arbiter
// classed every call non-progress, pattern (d) tripped at 3/3, `loop_resolution`
// proposed the stop and the run ended `loop-after-work` (failed) with 23 artifacts.
//
// RED-ON-CUT (each verified):
//   - pins 1/2 (todo state delta): make `changesTrackedState` return false.
//   - pin 3 (unchanged repeats still caught): make `changesTrackedState` return true.
//   - pin 4 (guidance first, then stop): make `applyLoopGuidance` return null
//     (no guidance) or `loopGuidanceBudget` return a huge number (never stops).
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { toTraceEvent, type TraceEvent } from "@reactive-agents/trace";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import type { KernelInput, KernelRunOptions } from "../../src/kernel/state/kernel-state.js";
import { assess } from "../../src/kernel/assessment/assess.js";
import { appendEntries } from "../../src/kernel/ledger/run-ledger.js";
import { makeRunContract } from "../../src/testing/kernel-fixtures.js";
import { detectLoopPattern } from "../../src/kernel/capabilities/reflect/loop-detector.js";
import { loopGuidanceBudget, loopGuidanceCycles } from "../../src/kernel/loop/runner-helpers/loop-guidance.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import type { ReasoningStep } from "../../src/types/index.js";

// ── Unit fixtures (detector level) ───────────────────────────────────────────
let n = 0;
function act(tool: string, args: Record<string, unknown>, id: string): ReasoningStep {
  return {
    id: `a-${n++}` as ReasoningStep["id"],
    type: "action",
    content: JSON.stringify({ tool, input: JSON.stringify(args) }),
    timestamp: new Date(),
    metadata: { toolCall: { id, name: tool, arguments: args } },
  };
}
function obs(toolCallId: string, content: string, success = true): ReasoningStep {
  return {
    id: `o-${n++}` as ReasoningStep["id"],
    type: "observation",
    content,
    timestamp: new Date(),
    metadata: { toolCallId, observationResult: { success, toolName: "x" } },
  };
}
const todoList = (done: number, total: number): string =>
  `Todo (${done}/${total} done):\n` + Array.from({ length: total }, (_, i) => `[${i < done ? "x" : " "}] ${i + 1}. step ${i + 1}`).join("\n");

// local tier shape: maxSameTool=2 (so (d) threshold 3), thoughts high so (b)/(c) stay quiet.
const A = 2, RT = 50, CT = 50;

describe("state-delta progress: unit (detector + assess)", () => {
  it("PIN 1: 25 todo calls, varied args, each moving the list -> no loop verdict", () => {
    const steps: ReasoningStep[] = [];
    for (let i = 1; i <= 25; i++) {
      steps.push(act("todo", { action: i % 2 ? "start" : "done", ids: [i] }, `t${i}`));
      steps.push(obs(`t${i}`, todoList(Math.floor(i / 2), 25)));
      expect(detectLoopPattern(steps, A, RT, CT)).toBeNull();
    }
  });

  it("PIN 1b: assess credits each list-moving todo call as new evidence (pattern (e) stays quiet)", () => {
    const contract = makeRunContract({ requirements: [], deliverables: [] });
    let ledger = appendEntries([], []);
    for (let i = 1; i <= 25; i++) {
      ledger = appendEntries(ledger, [
        { kind: "tool-invocation", iteration: i, toolName: "todo", args: { action: "start", ids: [i] }, toolCallId: `t${i}` },
        { kind: "tool-result", iteration: i, toolName: "todo", success: true, preview: todoList(i, 40), toolCallId: `t${i}` },
      ]);
      const a = assess(contract, ledger, { iteration: i, maxIterations: 60, tokensUsed: 0, costUsd: 0 });
      expect(a.evidenceDelta).toBe(1);
      expect(a.health.iterationsSinceEvidence).toBe(0);
    }
  });

  it("PIN 2: same read tool, different paths, each returning new content, 25x -> no loop", () => {
    const steps: ReasoningStep[] = [];
    for (let i = 1; i <= 25; i++) {
      steps.push(act("file-read", { path: `./f${i}.txt` }, `r${i}`));
      steps.push(obs(`r${i}`, `contents of file number ${i}: ${"data ".repeat(i)}`));
      expect(detectLoopPattern(steps, A, RT, CT)).toBeNull();
    }
  });

  it("PIN 3: same tool, same args, same result 5x -> still caught (pattern a)", () => {
    const steps: ReasoningStep[] = [];
    for (let i = 1; i <= 5; i++) {
      steps.push(act("file-read", { path: "./same.txt" }, `s${i}`));
      steps.push(obs(`s${i}`, "unchanged contents"));
    }
    expect(detectLoopPattern(steps, 5, RT, CT)?.pattern.id).toBe("a");
  });

  it("PIN 3b: todo with varied args that leaves the list UNCHANGED is still thrash (pattern d)", () => {
    const steps: ReasoningStep[] = [];
    for (let i = 1; i <= 4; i++) {
      steps.push(act("todo", { action: "start", ids: [i] }, `u${i}`));
      steps.push(obs(`u${i}`, todoList(2, 8)));
    }
    expect(detectLoopPattern(steps, A, RT, CT)?.pattern.id).toBe("d");
  });

  it("an identical call whose RESULTS keep changing (polling) is not a pattern-(a) loop", () => {
    const steps: ReasoningStep[] = [];
    for (let i = 1; i <= 4; i++) {
      steps.push(act("job-status", { id: "j1" }, `p${i}`));
      steps.push(obs(`p${i}`, `job j1 progress ${i * 25}%`));
    }
    expect(detectLoopPattern(steps, 3, RT, CT)).toBeNull();
  });
});

describe("graduated response: budget + derived cycle counter", () => {
  it("budget scales with maxIterations and long-horizon (documented thresholds)", () => {
    expect(loopGuidanceBudget(10, false)).toBe(2);
    expect(loopGuidanceBudget(40, false)).toBe(4);
    expect(loopGuidanceBudget(100, false)).toBe(6);
    expect(loopGuidanceBudget(500, false)).toBe(6);
    expect(loopGuidanceBudget(100, true)).toBe(8);
    expect(loopGuidanceBudget(10, true)).toBe(4);
  });

  const guidance = (): ReasoningStep =>
    makeStep("harness_signal", "w", { intervention: { actor: "loop-guidance", authorityClass: "deterministic", evidence: "", whatChanged: "", iter: 0 } });

  it("counts guidance since the last PROGRESS action; progress resets it; unanswered actions are not progress", () => {
    const stuck = [act("probe", { q: "a" }, "g1"), obs("g1", "No results found."), guidance(), guidance()];
    expect(loopGuidanceCycles(stuck)).toBe(2);
    const progressed = [...stuck, act("file-read", { path: "x" }, "g2"), obs("g2", "real new content here")];
    expect(loopGuidanceCycles(progressed)).toBe(0);
    const unanswered = [...stuck, act("file-read", { path: "x" }, "g3")];
    expect(loopGuidanceCycles(unanswered)).toBe(2);
  });
});

// ── Kernel-level scripted scenarios ──────────────────────────────────────────
const P = (name: string, type = "string") => ({ name, type, required: true });
const SCHEMAS = [
  { name: "probe", description: "probe a source", parameters: [P("q")] },
  { name: "file-read", description: "read a file", parameters: [P("path")] },
  { name: "todo", description: "checklist", parameters: [P("action"), { name: "items", type: "array", required: false }] },
];

let padN = 0;
const pad = (): string => {
  padN += 1;
  return Array.from({ length: 450 }, (_, i) => `k${padN}x${i}`).join(" ");
};
const call = (name: string, args: Record<string, unknown>) => ({ text: pad(), toolCall: { name, args } });
const FINAL_TEXT = "All steps are done and the work is complete.";

const input: KernelInput = {
  task: "Work through the checklist step by step, then report.",
  availableToolSchemas: SCHEMAS,
  metaTools: { todo: true },
  contextProfile: { tier: "local" },
} as KernelInput;

const opts = (maxIterations: number): KernelRunOptions => ({
  maxIterations,
  strategy: "reactive",
  kernelType: "react",
  taskId: "loop-state-progress",
  modelId: "llama3.2:3b",
});

const tools = mockToolServiceLayer({
  execute: (req) =>
    Effect.succeed(
      req.toolName === "file-read"
        ? { success: true, result: `file body for ${JSON.stringify(req.arguments)} — unique content ${Math.random()}` }
        : { success: true, result: "No results found." },
    ),
  getTool: (name: string) =>
    Effect.succeed({ name, description: "test", parameters: SCHEMAS.find((s) => s.name === name)?.parameters ?? [] }),
});

async function run(turns: Parameters<typeof TestLLMServiceLayer>[0], maxIterations: number) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const events = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      yield* bus.subscribe((ev) => Ref.update(events, (xs) => [...xs, ev]));
      const pass = yield* runPass(reactKernel, input, opts(maxIterations));
      const raw = yield* Ref.get(events);
      const trace = raw.flatMap((e, i): TraceEvent[] => {
        const t = toTraceEvent(e, i);
        return t ? [t] : [];
      });
      return { state: pass.state, trace };
    }).pipe(Effect.provide(Layer.mergeAll(TestLLMServiceLayer(turns), tools, EventBusLive))),
  );
}

const guards = (trace: readonly TraceEvent[], name: string) =>
  trace.flatMap((e, idx) => (e.kind === "guard-fired" && e.guard === name ? [{ e, idx }] : []));

describe("loop detection never force-finalizes varied-progress work (kernel, scripted)", () => {
  it("PIN 1 (kernel): 26 todo calls with varied args, each moving the list -> success, no loop guard", async () => {
    const turns = [
      ...Array.from({ length: 26 }, (_, i) => call("todo", { action: "add", items: [`step ${i + 1}`] })),
      { text: FINAL_TEXT },
    ];
    const { state, trace } = await run(turns, 60);
    expect(guards(trace, "loop_guidance")).toEqual([]);
    expect(guards(trace, "loop_resolution")).toEqual([]);
    expect(state.steps.some((s) => s.content.includes("Loop detected"))).toBe(false);
    expect(state.status).toBe("done");
    expect(state.meta.terminatedBy).not.toBe("max_iterations");
  });

  it("PIN 2 (kernel): 26 reads of different paths, each returning new content -> success, no loop guard", async () => {
    const turns = [
      ...Array.from({ length: 26 }, (_, i) => call("file-read", { path: `./doc-${i + 1}.txt` })),
      { text: FINAL_TEXT },
    ];
    const { state, trace } = await run(turns, 60);
    expect(guards(trace, "loop_guidance")).toEqual([]);
    expect(guards(trace, "loop_resolution")).toEqual([]);
    expect(state.status).toBe("done");
  });

  it("PIN 4: varied-args thrash with no new evidence -> guidance FIRST, then the stop", async () => {
    // META todo calls with varied args that re-add the SAME item: the list never
    // moves ("Skipped 1 duplicate"), so there is no state delta. (A meta-only pass
    // holds the artifact-stall counter, so loop detection is what meets this.)
    const turns = [
      call("todo", { action: "add", items: ["alpha"] }),
      ...Array.from({ length: 16 }, (_, i) => call("todo", { action: "add", items: ["alpha"], note: `retry ${i + 1}` })),
      { text: FINAL_TEXT },
    ];
    const { trace } = await run(turns, 30);
    const guided = guards(trace, "loop_guidance");
    const stopped = guards(trace, "loop_resolution");
    // maxIterations 30 -> budget 2 + floor(30/20) = 3 warnings before any stop.
    expect(guided.length).toBe(loopGuidanceBudget(30, false));
    expect(stopped.length).toBeGreaterThan(0);
    expect(guided[guided.length - 1]!.idx).toBeLessThan(stopped[0]!.idx);
  });
});

describe("plan-execute long-horizon: 32 scripted steps end success", () => {
  it("every step completes; loop detection never ends the run", async () => {
    const STEPS = 32;
    const id = (i: number) => `p${String(i).padStart(2, "0")}x`;
    const plan = {
      steps: Array.from({ length: STEPS }, (_, i) => ({
        title: `Step ${i + 1}`,
        instruction: `Summarize the ${id(i + 1)} findings.`,
        type: "composite",
      })),
    };
    const turns = [
      { json: plan },
      ...Array.from({ length: STEPS }, (_, i) => ({ match: `${id(i + 1)} findings`, text: `FINAL ANSWER: ${id(i + 1)} done.` })),
    ];
    const result = await Effect.runPromise(
      provideTestEnvelope(
        executePlanExecute({
          taskDescription: "Write a long multi-part findings report.",
          taskType: "simple",
          memoryContext: "",
          availableTools: [],
          availableToolSchemas: [],
          config: defaultReasoningConfig,
        } as never).pipe(Effect.provide(TestLLMServiceLayer(turns))),
      ),
    );
    expect(result.status).toBe("completed");
    expect(result.output).toContain(`${id(STEPS)} done`);
  });
});
