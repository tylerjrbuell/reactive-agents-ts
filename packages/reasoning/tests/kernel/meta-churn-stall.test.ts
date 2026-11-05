// Run: bun test packages/reasoning/tests/kernel/meta-churn-stall.test.ts --timeout 20000
//
// Plan 9 Phase 2a (Plan 8 K2/B5, long-horizon audit finding F-E): meta-tool
// churn never accrues the stall counter. `todo` was 61% of tool calls in long
// runs and every meta-only think/act pass counted as a stall, so
// stall_deliverable ended productive runs before the model synthesized.
//
// RED-ON-CUT: drop the `isMetaOnlyPass(...)` argument at the iterate-pass
// nextStalledCount call (or make nextStalledCount ignore it) and the churn run
// is ended by stall_deliverable again; drop the `metaCallsExcluded` spread in
// stall-deliverable.ts and the idle-run metadata assertion fails.
import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import { toTraceEvent, type TraceEvent } from "@reactive-agents/trace";
import { succeedingToolLayer } from "../../src/testing/tool-service-mock.js";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import type { KernelInput, KernelRunOptions } from "../../src/kernel/state/kernel-state.js";

const GATHER = { name: "gather", description: "gather data", parameters: [{ name: "q", type: "string", required: true }] };
const SCHEMAS = [
  GATHER,
  {
    name: "todo",
    description: "checklist",
    parameters: [
      { name: "action", type: "string", required: true },
      { name: "items", type: "array", required: false },
      { name: "id", type: "number", required: false },
    ],
  },
];

// Unique ~700-token thoughts keep the token-delta and repeated-thought guards quiet.
let padN = 0;
const pad = (): string => {
  padN += 1;
  return Array.from({ length: 450 }, (_, i) => `m${padN}x${i}`).join(" ");
};
const call = (name: string, args: Record<string, unknown>) => ({ text: pad(), toolCall: { name, args } });
const FINAL_TEXT = "The answer is 42: the core metric rose 12% last quarter.";

const input: KernelInput = {
  task: "Gather the core metric, track your steps, and report the answer.",
  availableToolSchemas: SCHEMAS,
  metaTools: { todo: true },
  contextProfile: { tier: "local" },
} as KernelInput;

const opts: KernelRunOptions = {
  maxIterations: 14,
  strategy: "reactive",
  kernelType: "react",
  taskId: "meta-churn-stall",
  modelId: "llama3.2:3b",
};

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
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          TestLLMServiceLayer(turns),
          succeedingToolLayer({ finding: "KEY FACT: the core metric rose 12% last quarter." }, GATHER.parameters),
          EventBusLive,
        ),
      ),
    ),
  );
}

const stallFires = (trace: readonly TraceEvent[]) =>
  trace.flatMap((e) => (e.kind === "guard-fired" && e.guard === "stall_deliverable" ? [e] : []));

describe("meta churn does not accrue the stall counter (default path)", () => {
  it("a todo-churn run is NOT ended by stall_deliverable before it synthesizes", async () => {
    const { state, trace } = await run([
      call("gather", { q: "core metric" }),
      call("todo", { action: "add", items: ["gather", "report"] }),
      call("todo", { action: "start", id: 2 }),
      call("todo", { action: "done", id: 1 }),
      call("todo", { action: "done", id: 2 }),
      { text: FINAL_TEXT },
    ]);
    expect(stallFires(trace)).toEqual([]);
    expect(state.output ?? "").toContain("The answer is 42");
  });

  it("CONTROL: a genuinely idle run (repeated non-meta gathers, no new evidence) is still ended by the stall guard, and names the meta calls it excluded", async () => {
    const { trace } = await run([
      call("gather", { q: "core metric" }),
      call("todo", { action: "add", items: ["gather", "report"] }),
      ...Array.from({ length: 8 }, () => call("gather", { q: "core metric" })),
      { text: FINAL_TEXT },
    ]);
    const fired = stallFires(trace);
    expect(fired.length).toBeGreaterThan(0);
    const m = fired[0]!.metadata as Record<string, unknown>;
    expect(m.metaCallsExcluded).toBe(1);
  });
});
