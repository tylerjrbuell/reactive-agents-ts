// Run: bun test packages/reasoning/src/kernel/loop/terminal-outcome-reconcile.integration.test.ts --timeout 20000
//
// Plan 8 K1 golden — the `stall_deliverable` shape, scripted end to end.
//
// SHAPE (2026-11-02 diagnosis, R1): the model gathers, then keeps calling tools
// without producing a synthesis; the stall guard takes over and the harness
// assembles the deliverable (`terminatedBy=harness_deliverable`). The terminal
// verify gate refuses it (`output-is-model-authored`) — and before K1 the run
// still reached the caller as a success because the engine's
// "partial + substantive output => success" lane saw no unmet requirement.
//
// This test asserts on the RESULT the engine consumes. CUT: remove the
// `deliverableDecisionEnvelope` join in finalize-result.ts (or the
// `deliverableDecision` read in resolveCompletionStatus) and the golden goes red.

import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { executeReactive } from "../../strategies/reactive.js";
import { defaultReasoningConfig } from "../../types/config.js";
import { succeedingToolLayer } from "../../testing/tool-service-mock.js";
import { provideTestEnvelope } from "../envelope/run-envelope.js";
import type { TerminalOutcome } from "../state/terminal-outcome.js";

const GATHER = {
  name: "gather",
  description: "gather research data",
  parameters: [{ name: "q", type: "string", required: true }],
};

const run = (turns: Parameters<typeof TestLLMServiceLayer>[0], task: string, tools: readonly string[]) =>
  Effect.runPromise(
    executeReactive({
      taskDescription: task,
      taskType: "research",
      memoryContext: "",
      availableTools: [...tools],
      availableToolSchemas: tools.length > 0 ? [GATHER] : [],
      config: defaultReasoningConfig,
      maxIterations: 8,
    } as never).pipe(
      Effect.provide(
        Layer.merge(
          TestLLMServiceLayer(turns),
          succeedingToolLayer({ finding: "KEY FACT: the core metric rose 12% last quarter." }, GATHER.parameters),
        ),
      ),
      provideTestEnvelope,
    ),
  );

const outcomeOf = (r: Awaited<ReturnType<typeof run>>): TerminalOutcome => {
  const o = (r.metadata.extensions as Record<string, unknown> | undefined)?.terminalOutcome;
  expect(o).toBeDefined();
  return o as TerminalOutcome;
};

const outstandingOf = (r: Awaited<ReturnType<typeof run>>): readonly string[] =>
  ((r.metadata as Record<string, unknown>).outstandingCriteria as readonly string[] | undefined) ?? [];

describe("K1 golden — stall_deliverable: refused harness deliverable never reads as success", () => {
  const stalled = () =>
    run(
      [
        ...Array.from({ length: 5 }, () => ({ toolCall: { name: "gather", args: { q: "a" } } })),
        { text: "FINAL ANSWER: unsynthesized guess." },
      ],
      "Research the topic and summarize it.",
      ["gather"],
    );

  it("reproduces the shape: harness-authored deliverable, verdict refused", async () => {
    const r = await stalled();
    const md = r.metadata as Record<string, unknown>;
    expect(md.rawTerminatedBy).toBe("harness_deliverable");
    expect(md.harnessAuthoredOutput).toBe(true);
    expect(r.output).toBeTruthy(); // honest partial: the work is preserved
  });

  it("status, verdict, ledger answer and the engine-visible requirement set agree", async () => {
    const r = await stalled();
    const o = outcomeOf(r);
    expect(r.status).toBe("partial");
    expect(o.status).toBe("partial");
    expect(o.verdict?.accepted).toBe(false);
    expect(o.answerSatisfied).toBe(false);
    expect(o.terminatedBy).toBe("harness_deliverable");
    expect(o.provenance).not.toBe("none");
    expect(o.success).toBe(false);
    // The engine's outstanding-criteria veto reads this exact field: without it
    // the "partial + substantive output" lane maps the run to success=true.
    expect(outstandingOf(r)).toContain("answer");
  });

  it("corpus invariant: success claim => accepted verdict && answer satisfied", async () => {
    for (const r of [await stalled()]) {
      const o = outcomeOf(r);
      if (o.success) {
        expect(o.verdict?.accepted).not.toBe(false);
        expect(o.answerSatisfied).not.toBe(false);
      }
    }
  });

  it("CONTROL: a clean model-authored completion keeps success, no outstanding criteria", async () => {
    const r = await run([{ text: "FINAL ANSWER: 4." }], "What is 2 + 2?", []);
    const o = outcomeOf(r);
    expect(r.status).toBe("completed");
    expect(o).toMatchObject({ status: "completed", success: true, answerSatisfied: true });
    expect(o.verdict?.accepted).toBe(true);
    expect(outstandingOf(r)).not.toContain("answer");
  });
});
