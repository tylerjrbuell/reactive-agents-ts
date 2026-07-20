// File: tests/strategies/terminatedby-abstention-boundary.test.ts
//
// Debt-burndown Wave 2, boundary B2 (register B2 + P0-5 + §5.1).
//
// THE BOUNDARY: only `strategies/reactive.ts` used to forward `terminatedBy` +
// `abstention` across the strategy→engine result boundary. The other 8 paths
// did not, so:
//   • execution-engine.ts read `rr?.metadata?.terminatedBy ?? "end_turn"` →
//     every non-reactive run was mislabeled `end_turn`, so `goalAchieved`
//     (helpers.ts deriveGoalAchieved) derived wrong;
//   • engine/abstention-projection.ts (`projectAbstention`) needs BOTH
//     `terminatedBy === "abstained"` AND `metadata.abstention` — so an honest
//     decline on any non-reactive strategy shipped as an ordinary answer and
//     `receipt.abstained` was permanently false on 8 of 9 paths.
//
// This suite is the MUTATION TEST: it goes red when the forward is cut.
//   1. A NON-reactive strategy (plan-execute) driven to ABSTAIN surfaces
//      terminatedBy === "abstained" AND the abstention descriptor — the exact
//      two fields projectAbstention keys on. Also proven on the kernel-state
//      path (tree-of-thought).
//   2. A non-abstaining non-reactive run (plan-execute, completed) reports a
//      CORRECT non-`end_turn` terminatedBy (`final_answer`) so goalAchieved
//      derives right.
//   3. §5.1 — an adaptive run whose first sub-strategy wrote a REAL tool step
//      then fell back preserves that step in the merged result.
//
// Red-on-cut proofs are documented per-assertion; see the boundary report.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { ToolService } from "@reactive-agents/tools";
import { executePlanExecute } from "../../src/strategies/plan-execute.js";
import { executeTreeOfThought } from "../../src/strategies/tree-of-thought.js";
import { executeAdaptive } from "../../src/strategies/adaptive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import type { ReasoningResult, ReasoningStep } from "../../src/types/index.js";

const WEB_SEARCH_SCHEMA = {
  name: "web-search",
  description: "Search the web",
  parameters: [{ name: "query", type: "string", description: "query", required: true }],
};

/** Records executed tools; `web-search` succeeds, everything else fails so an
 *  injected required-tool step (e.g. file-write) never lands in the completed
 *  set — the grounded-abstention trigger for plan-execute. */
function makeToolService() {
  const executed: string[] = [];
  const layer = Layer.succeed(
    ToolService,
    ToolService.of({
      execute: (req: { toolName: string }) => {
        executed.push(req.toolName);
        return req.toolName === "web-search"
          ? Effect.succeed({
              success: true,
              result: { results: [{ title: "hit", url: "https://example.com", content: "data" }] },
            })
          : Effect.succeed({ success: false, error: "tool unavailable" });
      },
      getTool: (name: string) =>
        Effect.succeed({
          name,
          description: "test tool",
          parameters: [{ name: "query", type: "string", required: true }],
        }),
      register: () => Effect.void,
      listTools: () => Effect.succeed([]),
      deregister: () => Effect.void,
    } as unknown as Parameters<typeof ToolService.of>[0]),
  );
  return { executed, layer };
}

const TOOL_PLAN = JSON.stringify({
  steps: [
    {
      title: "Search",
      instruction: "search the web",
      type: "tool_call",
      toolName: "web-search",
      toolArgs: { query: "test" },
      rationale: { why: "need data", confidence: 0.9 },
    },
    { title: "Summarize", instruction: "summarize the result", type: "analysis" },
  ],
});

/** Metadata is statically typed to the closed ReasoningMetadata struct; the
 *  boundary fields ride the runtime object (mirrors execution-engine.ts). */
function meta(r: ReasoningResult): Record<string, unknown> {
  return r.metadata as unknown as Record<string, unknown>;
}

function webSteps(steps: readonly ReasoningStep[]): readonly ReasoningStep[] {
  return steps.filter(
    (s) =>
      s.metadata?.toolCall?.name === "web-search" ||
      s.metadata?.observationResult?.toolName === "web-search",
  );
}

describe("B2 — terminatedBy + abstention cross the strategy→engine boundary", () => {
  // ── Assertion #1a: plan-execute (hand-rolled, kernel-less) abstains ──
  //
  // A SATISFIED reflection over a plan whose required `file-write` tool never
  // executed drives plan-execute's grounded-terminal gate: redirect once, then
  // abstain. The strategy must forward BOTH fields projectAbstention keys on.
  //
  // RED-ON-CUT: delete `terminatedBy` + the `abstention` block from
  // plan-execute.ts's main buildStrategyResult → terminatedBy is absent
  // (engine defaults it to "end_turn") and abstention is undefined → both
  // expectations below fail; projectAbstention could never set receipt.abstained.
  it("plan-execute abstention surfaces terminatedBy + descriptor", async () => {
    const { executed, layer } = makeToolService();
    const scenario = TestLLMServiceLayer([
      { match: "planning agent", text: TOOL_PLAN },
      { match: "OVERALL GOAL", text: "FINAL ANSWER: done." },
      { match: "GOAL:", text: "SATISFIED: complete." },
      { match: "Synthesize", text: "syn" },
      { match: "", text: "SATISFIED: complete." },
    ]);

    const r = await Effect.runPromise(
      executePlanExecute({
        taskDescription: "Search the web then write the report to ./out.md for me now",
        taskType: "simple",
        memoryContext: "",
        availableTools: ["web-search"],
        availableToolSchemas: [WEB_SEARCH_SCHEMA],
        requiredTools: ["file-write"],
        config: defaultReasoningConfig,
      } as Parameters<typeof executePlanExecute>[0]).pipe(
        Effect.provide(Layer.merge(scenario, layer)),
      ),
    );

    // The two fields projectAbstention (abstention-projection.ts) requires.
    expect(meta(r).terminatedBy).toBe("abstained");
    const abstention = meta(r).abstention as
      | { reason: string; missing: readonly string[] }
      | undefined;
    expect(abstention).toBeDefined();
    expect(abstention!.missing).toContain("file-write");
    // Grounded abstention is an honest non-success.
    expect(r.status).toBe("partial");
    // The real tool DID run — abstention is about the ungrounded *required* tool.
    expect(executed).toContain("web-search");
  });

  // ── Assertion #1b: tree-of-thought (kernel-state path) abstains ──
  //
  // The trivial-skip fast-path runs a single react kernel; a required tool that
  // is structurally unavailable forces an honest kernel abstention. ToT must
  // forward deriveTerminatedBy(state) + state.meta.abstention (mirrors reactive).
  //
  // RED-ON-CUT: remove the `terminatedBy`/`abstention` lines from the ToT skip
  // return → terminatedBy absent, abstention undefined → both fail.
  it("tree-of-thought abstention crosses the boundary (kernel-state path)", async () => {
    const scenario = TestLLMServiceLayer([{ match: "", text: "The answer is 4." }]);
    const r = await Effect.runPromise(
      executeTreeOfThought({
        taskDescription: "What is 2+2?",
        taskType: "simple",
        memoryContext: "",
        availableTools: ["web-search"],
        availableToolSchemas: [WEB_SEARCH_SCHEMA],
        requiredTools: ["nonexistent-db"],
        config: defaultReasoningConfig,
      } as Parameters<typeof executeTreeOfThought>[0]).pipe(Effect.provide(scenario)),
    );
    expect(meta(r).terminatedBy).toBe("abstained");
    expect(meta(r).abstention).toBeDefined();
  });

  // ── Assertion #2: non-abstaining non-reactive run → correct non-end_turn ──
  //
  // A completed plan-execute run delivered a synthesized answer. It must report
  // `final_answer` (NOT the `end_turn` default) so deriveGoalAchieved returns
  // true instead of null.
  //
  // RED-ON-CUT: delete `terminatedBy` from plan-execute's main
  // buildStrategyResult → terminatedBy absent → NOT "final_answer" (engine
  // would fall back to "end_turn", goalAchieved null) → this fails.
  it("plan-execute completed run reports final_answer (not end_turn)", async () => {
    const { layer } = makeToolService();
    const scenario = TestLLMServiceLayer([
      { match: "planning agent", text: TOOL_PLAN },
      { match: "OVERALL GOAL", text: "FINAL ANSWER: summary done." },
      { match: "GOAL:", text: "SATISFIED: complete." },
      { match: "Synthesize", text: "Final synthesized answer." },
    ]);
    const r = await Effect.runPromise(
      executePlanExecute({
        taskDescription: "Find test data",
        taskType: "simple",
        memoryContext: "",
        availableTools: ["web-search"],
        availableToolSchemas: [WEB_SEARCH_SCHEMA],
        config: defaultReasoningConfig,
      } as Parameters<typeof executePlanExecute>[0]).pipe(
        Effect.provide(Layer.merge(scenario, layer)),
      ),
    );
    expect(r.status).toBe("completed");
    expect(meta(r).terminatedBy).toBe("final_answer");
    expect(meta(r).terminatedBy).not.toBe("end_turn");
  });

  // ── §5.1: adaptive fallback preserves the prior sub-strategy's real steps ──
  //
  // Adaptive selects plan-execute (task matches the plan heuristic), plan-execute
  // grounded-abstains (partial) after its web-search tool step landed, and
  // adaptive falls back to reactive. The failed sub-strategy's REAL tool write
  // must survive the merge (previously it vanished → the ledger/receipt reported
  // produced deliverables as missing).
  //
  // RED-ON-CUT: revert the merge to `[...steps, ...finalSubResult.steps]` (drop
  // `priorSubSteps`) → the reactive fallback never called web-search, so the
  // web-search step vanishes → webSteps === 0 → this fails.
  it("adaptive fallback preserves the sub-strategy's real tool step (§5.1)", async () => {
    const { layer } = makeToolService();
    const scenario = TestLLMServiceLayer([
      { match: "planning agent", text: TOOL_PLAN },
      { match: "OVERALL GOAL", text: "FINAL ANSWER: done." },
      { match: "GOAL:", text: "SATISFIED: complete." },
      { match: "Synthesize", text: "syn" },
      { match: "", text: "SATISFIED: complete." },
    ]);
    const r = await Effect.runPromise(
      executeAdaptive({
        taskDescription:
          "First search the web and then write the report to ./out.md, following these steps carefully now",
        taskType: "simple",
        memoryContext: "",
        availableTools: ["web-search"],
        availableToolSchemas: [WEB_SEARCH_SCHEMA],
        requiredTools: ["file-write"],
        config: defaultReasoningConfig,
      } as Parameters<typeof executeAdaptive>[0]).pipe(
        Effect.provide(Layer.merge(scenario, layer)),
      ),
    );

    expect(meta(r).fallbackOccurred).toBe(true);
    // The plan-execute web-search action+observation pair survives the fallback.
    expect(webSteps(r.steps).length).toBeGreaterThanOrEqual(1);
    // And adaptive relays the sub-strategy's terminatedBy (abstained here) — not
    // the `end_turn` default (proves the terminatedBy forward on adaptive too).
    expect(meta(r).terminatedBy).toBe("abstained");
  });
});
