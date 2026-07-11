// Run: bun test packages/reasoning/src/strategies/reflexion-honest-partial.integration.test.ts --timeout 20000
//
// #40 / spec §1b (CompletionEnvelope) — reflexion joins the generate/improve
// sub-kernel envelopes at the result boundary.
//
// Before #40, reflexion mapped `reason.kind === "satisfied"` straight to
// `status:"completed"` (reflexion.ts finalize) — the critique judges TEXT
// quality and cannot see that the generate pass shipped a budget-terminal
// honest partial, and `runPass`'s kernel meta markers never crossed the
// boundary. These tests pin the join: strip `capStatusToEnvelope` /
// `honestEnvelopeMetadata` at reflexion's return site and they go red.
//
// Scenario: the artifact expectation (report.md) rides `memoryContext` — the
// generate KERNEL's compiled contract sees it (buildGenerationPrompt embeds
// CONTEXT into the kernel task) and keeps a deterministic OUTSTANDING
// requirement, so with tokenLimit:1 + long horizon the terminal pace band
// ships a budget-terminal partial. Reflexion's OWN gates do not see it
// (deriveConditions reads the raw taskDescription, which names no file;
// requiredTools is unset), so the critique's SATISFIED is accepted — only the
// envelope join makes the honest partial reach the caller.

import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { executeReflexion } from "./reflexion.js";
import { defaultReasoningConfig } from "../types/config.js";
import { succeedingToolLayer } from "../testing/tool-service-mock.js";

const GATHER_SCHEMA = {
  name: "gather",
  description: "gather research data",
  parameters: [{ name: "q", type: "string", required: true }],
};

const gatherToolLayer = succeedingToolLayer(
  { finding: "KEY FACT: the topic's core metric rose 12% last quarter." },
  GATHER_SCHEMA.parameters,
);

const TASK = "Research the topic thoroughly.";
const CONTEXT = "Write your findings to report.md.";

const budgetScenario = () =>
  TestLLMServiceLayer([
    // 1. generate think → gather call (burns tokens past the cliff).
    { match: "report\\.md", toolCall: { name: "gather", args: { q: "topic" } } },
    // 2. forced terminal synthesis (long-horizon pace band; prompt says "professional").
    { match: "professional", text: "SYNTHESIZED REPORT: the metric rose 12% last quarter." },
    // 3. critique — reflexion's OWN authority accepts.
    { match: "COMPLETED based on the execution evidence", text: "SATISFIED: the research is complete." },
    // 4. quality-gate synthesis, if it fires.
    { text: "POLISHED: the metric rose 12% last quarter." },
  ]);

// CONTROL — mirrors the reactive control ("What is 2 + 2?"): a trivial task
// with NO deliverable expectation, so the generate sub-kernel terminates on a
// clean model-authored final answer (a report.md context would drive the
// completion guard into a harness-deliverable stall — which the envelope
// CORRECTLY reports as partial, but that is the treatment arm, not a control).
const cleanScenario = () =>
  TestLLMServiceLayer([
    // 1. generate think → clean model-authored final answer.
    { match: "2 \\+ 2", text: "FINAL ANSWER: 4." },
    // 2. critique accepts.
    { match: "COMPLETED based on the execution evidence", text: "SATISFIED: answered." },
    // 3. quality-gate synthesis, if it fires.
    { text: "4." },
  ]);

const runReflexion = (
  scenario: ReturnType<typeof TestLLMServiceLayer>,
  extra: Record<string, unknown>,
) =>
  Effect.runPromise(
    executeReflexion({
      taskDescription: TASK,
      taskType: "research",
      memoryContext: CONTEXT,
      availableTools: ["gather"],
      availableToolSchemas: [GATHER_SCHEMA],
      config: defaultReasoningConfig,
      ...extra,
    } as never).pipe(Effect.provide(Layer.merge(scenario, gatherToolLayer))),
  );

describe("#40 (reflexion) — a sub-kernel's unverified ship never reaches the caller as completed", () => {
  it("budget-terminal partial in the generate pass: result.status is PARTIAL with the honesty metadata", async () => {
    const result = await runReflexion(budgetScenario(), {
      horizonProfile: "long",
      budgetLimits: { tokenLimit: 1 },
    });

    // Real work is preserved…
    expect(result.output).toBeTruthy();
    // …but the critique's SATISFIED cannot upgrade past the joined envelope.
    expect(result.status).toBe("partial");
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.budgetTerminalPartial).toBe(true);
    expect(String(meta.verificationWarning ?? "")).toContain("report.md");
  });

  it("CONTROL: a clean satisfied run still reports completed with no honesty markers", async () => {
    const result = await runReflexion(cleanScenario(), {
      taskDescription: "What is 2 + 2?",
      taskType: "qa",
      memoryContext: "",
      availableTools: [],
      availableToolSchemas: [],
    });
    expect(result.status).toBe("completed");
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.budgetTerminalPartial).toBeUndefined();
    expect(meta.harnessAuthoredOutput).toBeUndefined();
  });
});
