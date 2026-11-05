// Run: bun test packages/reasoning/tests/kernel/staleness-after-deliverable.test.ts --timeout 20000
//
// H3 baseline 2026-11-05, defect 1 (trace 01M6PHCBGQT7VJH5AAS2PG9W8G, qwen rw-9
// run1): the evidence-staleness loop pattern (e) read the assessment taken at the
// TOP of the pass, before act. On the pass whose act wrote every contract
// deliverable, detection still saw the pre-act staleness (3/3), fired
// loop_resolution, and the run ended as a failure although the model was about to
// answer correctly. Staleness at the turn boundary must reflect what the act
// just produced.
//
// RED-ON-CUT: at the iterate-pass detectLoopPattern call, pass the pass-start
// `evidenceStaleIterations` instead of `staleIterationsAtTurnBoundary(...)` and
// the first test fails (pattern e fires on the file-write pass).
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { toTraceEvent, type TraceEvent } from "@reactive-agents/trace";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import { staleIterationsAtTurnBoundary } from "../../src/kernel/loop/iterate-assessment-seam.js";
import { initialKernelState, transitionState, type KernelInput, type KernelRunOptions } from "../../src/kernel/state/kernel-state.js";
import { appendEntries, type RunLedger } from "../../src/kernel/ledger/run-ledger.js";
import { artifactProduced } from "../../src/kernel/capabilities/verify/post-conditions.js";
import { makeRunContract } from "../../src/testing/kernel-fixtures.js";

const P = (name: string, type = "string") => ({ name, type, required: true });
const SCHEMAS = [
  { name: "gather", description: "gather data", parameters: [P("q")] },
  { name: "probe", description: "probe a source", parameters: [P("q")] },
  { name: "lookup", description: "look up a source", parameters: [P("q")] },
  { name: "file-write", description: "write a file", parameters: [P("path"), P("content")] },
  {
    name: "todo",
    description: "checklist",
    parameters: [P("action"), { name: "items", type: "array", required: false }],
  },
];

// Unique ~700-token thoughts keep the token-delta and repeated-thought guards quiet.
let padN = 0;
const pad = (): string => {
  padN += 1;
  return Array.from({ length: 450 }, (_, i) => `s${padN}x${i}`).join(" ");
};
const call = (name: string, args: Record<string, unknown>) => ({ text: pad(), toolCall: { name, args } });
const FINAL_TEXT = "Report written to ./report.md: the core metric rose 12% last quarter.";

const input: KernelInput = {
  task: "Gather the core metric, then write a one-line report to ./report.md and tell me what it says.",
  availableToolSchemas: SCHEMAS,
  metaTools: { todo: true },
  contextProfile: { tier: "local" },
} as KernelInput;

const opts: KernelRunOptions = {
  maxIterations: 14,
  strategy: "reactive",
  kernelType: "react",
  taskId: "staleness-after-deliverable",
  modelId: "llama3.2:3b",
};

// gather lands substantive evidence; probe returns a no-op (non-progress), so the
// passes between the gather and the write are evidence-stale.
const tools = mockToolServiceLayer({
  execute: (req) =>
    Effect.succeed(
      req.toolName === "gather"
        ? { success: true, result: { finding: "KEY FACT: the core metric rose 12% last quarter." } }
        : req.toolName === "file-write"
          ? { success: true, result: "Wrote 52 bytes to ./report.md" }
          : { success: true, result: "No results found." },
    ),
  getTool: (name: string) =>
    Effect.succeed({ name, description: "test", parameters: SCHEMAS.find((s) => s.name === name)?.parameters ?? [] }),
});

async function run(turns: Parameters<typeof TestLLMServiceLayer>[0]) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const events = yield* Ref.make<AgentEvent[]>([]);
      const bus = yield* EventBus;
      yield* bus.subscribe((ev) => Ref.update(events, (xs) => [...xs, ev]));
      const pass = yield* runPass(reactKernel, input, opts);
      const raw = yield* Ref.get(events);
      const trace = raw.flatMap((e, i): TraceEvent[] => {
        const t = toTraceEvent(e, i);
        return t ? [t] : [];
      });
      return { state: pass.state, trace };
    }).pipe(Effect.provide(Layer.mergeAll(TestLLMServiceLayer(turns), tools, EventBusLive))),
  );
}

const loopFires = (trace: readonly TraceEvent[]) =>
  trace.flatMap((e) => (e.kind === "guard-fired" && e.guard === "loop_resolution" ? [e] : []));

const STALE_PREFIX = [
  call("gather", { q: "core metric" }),
  call("probe", { q: "source a" }),
  call("todo", { action: "add", items: ["gather", "write", "report"] }),
  call("probe", { q: "source b" }),
];

describe("evidence staleness is read at the turn boundary (after act)", () => {
  it("the pass whose act writes the contract deliverable is not vetoed as stale; the model answers", async () => {
    const { state, trace } = await run([
      ...STALE_PREFIX,
      call("file-write", { path: "./report.md", content: "The core metric rose 12% last quarter." }),
      { text: FINAL_TEXT },
    ]);
    const staleFires = loopFires(trace).filter((e) => (e.metadata as Record<string, unknown>).pattern === "e");
    expect(staleFires).toEqual([]);
    expect(state.output ?? "").toContain("rose 12%");
    expect(state.meta.terminatedBy).not.toBe("harness_deliverable");
  });

  it("CONTROL: the same pass shape whose act produces nothing still trips evidence-staleness", async () => {
    const { trace } = await run([
      ...STALE_PREFIX,
      call("lookup", { q: "source c" }),
      { text: FINAL_TEXT },
    ]);
    const fired = loopFires(trace).map((e) => (e.metadata as Record<string, unknown>).pattern);
    expect(fired).toContain("e");
  });
});

// Direct-import seam pin for staleIterationsAtTurnBoundary (iterate-assessment-seam.ts).
describe("staleIterationsAtTurnBoundary (seam pin)", () => {
  const contract = makeRunContract({
    requirements: [
      {
        id: "artifact:report.md",
        kind: "artifact-produced",
        spec: { description: "write report.md", condition: artifactProduced("report.md"), acceptance: "deterministic" },
      },
      { id: "answer", kind: "question-answered", spec: { description: "answer", acceptance: "self-critique" } },
    ],
    deliverables: [{ id: "artifact:report.md", kind: "file", matcher: artifactProduced("report.md") }],
  });
  const at = (iteration: number, ledger: RunLedger, withContract = true) =>
    transitionState(initialKernelState(opts), {
      iteration,
      ledger,
      meta: withContract ? { runContract: contract } : {},
    });
  const probeAt = (i: number): RunLedger =>
    appendEntries([], [{ kind: "tool-result", iteration: i, toolName: "probe", success: true, preview: "No results found.", toolCallId: `p${i}` }]);

  it("keeps the pass-start count when the act produced no new evidence and work remains", () => {
    expect(staleIterationsAtTurnBoundary(at(5, probeAt(5)), 3, opts)).toBe(3);
  });

  it("drops to 0 when the act wrote the last deterministic deliverable (phase synthesize)", () => {
    const ledger = appendEntries(probeAt(4), [{ kind: "artifact", iteration: 5, path: "./report.md", op: "write", toolCallId: "w5" }]);
    expect(staleIterationsAtTurnBoundary(at(5, ledger), 3, opts)).toBe(0);
  });

  it("drops to 0 when the act landed new substantive evidence", () => {
    const ledger = appendEntries([], [
      { kind: "tool-invocation", iteration: 5, toolName: "gather", args: { q: "x" }, toolCallId: "g5" },
      { kind: "tool-result", iteration: 5, toolName: "gather", success: true, preview: "KEY FACT: 12%", toolCallId: "g5" },
    ]);
    expect(staleIterationsAtTurnBoundary(at(5, ledger), 3, opts)).toBe(0);
  });

  it("is the identity with no compiled contract", () => {
    expect(staleIterationsAtTurnBoundary(at(5, [], false), 3, opts)).toBe(3);
  });
});
