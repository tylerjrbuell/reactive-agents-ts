// Run: bun test packages/reasoning/tests/kernel/loop/evidence-escalation-e2e.test.ts
//
// END-TO-END coverage for the deterministic remedy layer's Evidence Escalation
// path (FM-17 layers 1-3). Every OTHER test for these layers hand-injects a
// `RunAssessment` / `requirementProgress` fixture at a fixed iteration, which is
// exactly why the ledger-stamp PHASE mismatch (C1) survived 9 commits and 6
// reviews: no test ever drove the real loop across enough iterations for the
// mint site's stamp and the assess() read site's `currentIter` to disagree.
//
// This test drives the REAL kernel (`reactKernel` via `runKernel`) with a
// scripted test provider and a real ToolService whose result is far too large to
// render under the base budget, then reads the ACTUAL rendered `tool_result`
// content the model received on each turn — the observable, not a computed
// intermediate.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";
import type { LLMMessage } from "@reactive-agents/llm-provider";
import { ToolService } from "@reactive-agents/tools";
import { runKernel } from "../../../src/kernel/loop/runner.js";
import { reactKernel } from "../../../src/kernel/loop/react-kernel.js";
import { compileRunContract } from "../../../src/kernel/contract/run-contract.js";

const TASK = "Find and list all three episode names for season 1.";
const TOOL = "web-search";

/** Far larger than any tier's default per-result budget, so it MUST truncate. */
const BIG_RESULT = Array.from(
  { length: 34 },
  (_, i) => `Episode candidate ${i}: a long descriptive sentence about season 1 material.`,
).join("\n");

const TOOL_SCHEMA = {
  name: TOOL,
  description: "search the web",
  parameters: [{ name: "query", type: "string", description: "query", required: true }],
};

function toolLayer() {
  return Layer.succeed(
    ToolService,
    ToolService.of({
      execute: () => Effect.succeed({ success: true, result: BIG_RESULT }),
      getTool: (name: string) =>
        Effect.succeed({
          name,
          description: "search the web",
          parameters: [{ name: "query", type: "string", required: true }],
        }),
      register: () => Effect.void,
      listTools: () => Effect.succeed([TOOL_SCHEMA]),
      deregister: () => Effect.void,
    } as unknown as Parameters<typeof ToolService.of>[0]),
  );
}

/**
 * Wrap the deterministic test provider so every AGENT turn's rendered messages
 * are captured. This is what makes the assertion observable-level: we read the
 * literal `tool_result` text the model was handed, per iteration.
 */
function recordingLLM(scenario: Parameters<typeof TestLLMService>[0]) {
  const turns: (readonly LLMMessage[])[] = [];
  const base = TestLLMService(scenario);
  const record = (req: { messages: readonly LLMMessage[]; purpose?: string }) => {
    if (req.purpose === undefined || req.purpose === "think") turns.push(req.messages);
  };
  const layer = Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      complete: (req) => {
        record(req as never);
        return base.complete(req);
      },
      stream: (req) => {
        record(req as never);
        return base.stream(req);
      },
    }),
  );
  return { layer, turns };
}

/** The rendered tool_result payloads the model saw on one turn. */
function toolResultChars(messages: readonly LLMMessage[]): number[] {
  return messages
    .filter((m) => m.role === "tool_result" || m.role === "tool")
    .map((m) => (typeof m.content === "string" ? m.content.length : 0));
}

const SCENARIO = [
  { toolCall: { name: TOOL, args: { query: "season 1 episode list" } } },
  { toolCall: { name: TOOL, args: { query: "season 1 episode names official" } } },
  { toolCall: { name: TOOL, args: { query: "season 1 episode titles wiki" } } },
  { toolCall: { name: TOOL, args: { query: "season 1 episode guide" } } },
  { toolCall: { name: TOOL, args: { query: "season 1 all episodes" } } },
  { toolCall: { name: TOOL, args: { query: "season 1 episode roster" } } },
];

const INPUT = {
  task: TASK,
  availableToolSchemas: [TOOL_SCHEMA],
  allToolSchemas: [TOOL_SCHEMA],
} as never;

async function driveRun() {
  const { layer, turns } = recordingLLM(SCENARIO as never);
  const state = await Effect.runPromise(
    runKernel(reactKernel, INPUT, {
      maxIterations: 6,
      strategy: "react",
      kernelType: "react",
    } as never).pipe(Effect.provide(Layer.merge(layer, toolLayer()))),
  );
  return { state, turns };
}

describe("Evidence Escalation — real loop (FM-17 layers 1-3)", () => {
  it("PRECONDITION: the task compiles an enumeration-hinted answer requirement", () => {
    const contract = compileRunContract(TASK);
    const answer = contract.requirements.find((r) => r.id === "answer");
    expect(answer?.spec.enumeration).toBeDefined();
  });

  it("PRECONDITION: the run really iterates and really truncates", async () => {
    const { state, turns } = await driveRun();
    // A 1-iteration run, or a run whose oversized result never clipped, would
    // make every assertion below vacuous.
    expect(turns.length).toBeGreaterThanOrEqual(4);
    const truncationFacts = (state.ledger ?? []).filter((e) => e.kind === "result-truncated");
    expect(truncationFacts.length).toBeGreaterThanOrEqual(2);
  }, 30000);

  it("C1: the render budget genuinely widens on a later iteration", async () => {
    const { turns } = await driveRun();
    // Tool results render in stable order, so index 0 is the SAME ref on every
    // turn that has one. The oldest result is the one that clips under the base
    // budget; the latest always keeps the generous recency budget.
    const oldest = turns.map(toolResultChars).filter((r) => r.length >= 2).map((r) => r[0]!);
    expect(oldest.length).toBeGreaterThanOrEqual(2);
    const first = oldest[0]!;
    const widest = Math.max(...oldest);
    // Pre-fix this is flat: stallCount is 0 on EVERY pass because think.ts
    // stamped `state.iteration` while assess() reads `currentIter` one ahead, so
    // the oldest result renders at the base budget forever.
    expect(widest).toBeGreaterThan(first);
  }, 30000);

  it("I2: an escalated ref does not flip back to the base budget next turn", async () => {
    const { turns } = await driveRun();
    const perTurn = turns.map(toolResultChars).filter((r) => r.length >= 2);
    // Track ref position 0 across turns: once widened it must never shrink.
    const oldest = perTurn.map((r) => r[0]!);
    for (let i = 1; i < oldest.length; i++) {
      expect(oldest[i]!).toBeGreaterThanOrEqual(oldest[i - 1]!);
    }
    // And the widening must actually have happened (guards against a
    // trivially-monotonic all-flat sequence passing this test).
    expect(oldest[oldest.length - 1]!).toBeGreaterThan(oldest[0]!);
  }, 30000);

  it("C2: escalation does not spill onto every tool result at once", async () => {
    const { turns } = await driveRun();
    const perTurn = turns.map(toolResultChars).filter((r) => r.length >= 3);
    expect(perTurn.length).toBeGreaterThanOrEqual(1);
    // On the turn where the oldest ref has escalated, the most recently-added
    // NON-latest ref has not yet stalled and must still sit at the base budget.
    // A predicate that matched "any tool result" would widen it too.
    const firstWide = perTurn.find((r) => r[0]! > r[r.length - 2]!);
    expect(firstWide).toBeDefined();
  }, 30000);
});
