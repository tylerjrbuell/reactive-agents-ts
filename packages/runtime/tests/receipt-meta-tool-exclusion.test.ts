/**
 * Trust receipt — META/termination tool exclusion (Arc 1 Task 8, live-smoke fix).
 *
 * Live smoke on ollama qwen3:4b found: a pure-knowledge run ("capital of
 * France") graded {"verdict":"tool-grounded","toolsUsed":["find","final-answer"]}.
 * Both names are kernel META tools — `final-answer` is how EVERY kernel run
 * terminates, so counting it as grounding evidence made verdict "ungrounded"
 * UNREACHABLE on the kernel path and graded pure-knowledge answers
 * "tool-grounded" — inverting the receipt's whole purpose (distinguishing
 * tool-grounded answers from the model answering from itself).
 *
 * Fix under test: deriveReceiptToolCalls excludes META_TOOLS +
 * HARNESS_PSEUDO_TOOLS + abstain + request_user_input at BOTH derivation
 * sources (kernel steps AND the receiptToolCalls event-log fallback), sourced
 * from the owning packages' exported constants (kernel-constants.ts is the
 * single source of truth — "Not counted as 'real work'").
 *
 * Run: bun test packages/runtime/tests/receipt-meta-tool-exclusion.test.ts --timeout 15000
 */
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { computeTrustReceipt } from "@reactive-agents/core";
import { deriveReceiptToolCalls } from "../src/builder/helpers.js";
import { ReactiveAgents } from "../src/builder.js";

// Kernel-shaped action/observation step pairs — mirrors the exact metadata
// stamped by packages/reasoning/src/kernel/capabilities/act/act.ts (action:
// metadata.toolCall{id,name,arguments}; observation: metadata.toolCallId +
// metadata.observationResult.success).
const kernelSteps = (
    calls: ReadonlyArray<{ name: string; ok: boolean; id: string }>,
) =>
    calls.flatMap((c) => [
        {
            type: "action",
            metadata: { toolCall: { id: c.id, name: c.name, arguments: {} } },
        },
        {
            type: "observation",
            metadata: {
                toolCallId: c.id,
                observationResult: { success: c.ok, toolName: c.name, displayText: "x" },
            },
        },
    ]);

const receiptBase = {
    terminatedBy: "final_answer_tool",
    goalAchieved: true,
    abstained: false,
    success: true,
    modelId: "test-model",
    now: 1000,
};

describe("deriveReceiptToolCalls — meta-tool exclusion (unit)", () => {
    test("kernel steps with ONLY final-answer derive to zero calls → ungrounded", () => {
        const toolCalls = deriveReceiptToolCalls({
            reasoningSteps: kernelSteps([{ name: "final-answer", ok: true, id: "c1" }]),
        });
        expect(toolCalls).toEqual([]);
        const r = computeTrustReceipt({ ...receiptBase, toolCalls });
        expect(r.verdict).toBe("ungrounded");
        expect(r.toolsUsed).toEqual([]);
        expect(r.toolCallStats).toEqual({ ok: 0, failed: 0 });
    });

    test("live-smoke R2 mirror: find + final-answer (both META) → ungrounded", () => {
        const toolCalls = deriveReceiptToolCalls({
            reasoningSteps: kernelSteps([
                { name: "find", ok: true, id: "c1" },
                { name: "final-answer", ok: true, id: "c2" },
            ]),
        });
        expect(toolCalls).toEqual([]);
        expect(computeTrustReceipt({ ...receiptBase, toolCalls }).verdict).toBe("ungrounded");
    });

    test("substantive tool + final-answer → tool-grounded on the substantive tool ONLY", () => {
        const toolCalls = deriveReceiptToolCalls({
            reasoningSteps: kernelSteps([
                { name: "calculator", ok: true, id: "c1" },
                { name: "final-answer", ok: true, id: "c2" },
            ]),
        });
        expect(toolCalls).toEqual([{ name: "calculator", ok: true }]);
        const r = computeTrustReceipt({ ...receiptBase, toolCalls });
        expect(r.verdict).toBe("tool-grounded");
        expect(r.toolsUsed).toEqual(["calculator"]);
        expect(r.toolCallStats).toEqual({ ok: 1, failed: 0 });
    });

    test("receiptToolCalls fallback (minimal loop) also excludes meta tools", () => {
        const toolCalls = deriveReceiptToolCalls({
            receiptToolCalls: [
                { name: "final-answer", ok: true },
                { name: "web-search", ok: true },
            ],
        });
        expect(toolCalls).toEqual([{ name: "web-search", ok: true }]);
    });

    test("abstain exclusion does NOT break verdict rule 1 — abstention reads terminatedBy", () => {
        const toolCalls = deriveReceiptToolCalls({
            reasoningSteps: kernelSteps([{ name: "abstain", ok: true, id: "c1" }]),
        });
        expect(toolCalls).toEqual([]);
        const r = computeTrustReceipt({
            ...receiptBase,
            terminatedBy: "abstained",
            goalAchieved: false,
            abstained: true,
            toolCalls,
        });
        expect(r.verdict).toBe("abstained");
        expect(r.confidence).toBe(0.95);
    });
});

function makeToolDef(name: string) {
    return {
        name,
        description: `Tool ${name}`,
        parameters: [
            {
                name: "input",
                type: "string" as const,
                description: "Input",
                required: true,
            },
        ],
        riskLevel: "low" as const,
        timeoutMs: 5_000,
        requiresApproval: false,
        source: "function" as const,
    };
}

describe("receipt meta-tool exclusion — keyless kernel integration", () => {
    test("kernel run answering via final-answer WITHOUT substantive tools grades ungrounded", async () => {
        // Mirrors live-smoke R2 exactly: a substantive tool is AVAILABLE
        // (echo-tool) but the model only touches META tools — an introspection
        // call (pulse; the live run used find) then the final-answer
        // termination tool. Both produce kernel action/observation step pairs
        // with observationResult.success === true; before the fix that graded
        // "tool-grounded". The pulse call is also load-bearing for the repro:
        // shouldShowFinalAnswer (tools/skills/final-answer.ts) only offers the
        // final-answer tool after ≥1 tool call, so a zero-call scenario never
        // reaches the defect path.
        const agent = await ReactiveAgents.create()
            .withName("receipt-meta-exclusion")
            .withTestScenario([
                { toolCall: { name: "pulse", args: {} } },
                {
                    toolCall: {
                        name: "final-answer",
                        args: {
                            output: "Paris is the capital of France.",
                            format: "text",
                            summary: "pure-knowledge answer, no tools needed",
                        },
                    },
                },
            ])
            .withTools({
                tools: [
                    {
                        definition: makeToolDef("echo-tool"),
                        handler: (args: Record<string, unknown>) =>
                            Effect.succeed(`echoed: ${String(args.input)}`),
                    },
                ],
            })
            // pulse went opt-in on 2026-07-10 (task-facing default set); this
            // repro NEEDS a meta-tool call, so opt in explicitly.
            .withMetaTools({ pulse: true })
            .withReasoning({ defaultStrategy: "reactive" })
            // Scenario alignment (see trust-event-stream.test.ts): the adaptive
            // classifier would consume the first scenario turn pre-kernel.
            .withRequiredTools({ adaptive: false })
            .withMaxIterations(5)
            .build();
        try {
            const result = await agent.run("What is the capital of France?");

            // The run terminated through the final-answer META tool…
            expect(result.success).toBe(true);
            expect(result.terminatedBy).toBe("final_answer_tool");

            // …which is NOT grounding evidence: the model answered from itself.
            expect(result.receipt?.verdict).toBe("ungrounded");
            expect(result.receipt?.toolsUsed).toEqual([]);
            expect(result.receipt?.toolCallStats).toEqual({ ok: 0, failed: 0 });
        } finally {
            await agent.dispose();
        }
    }, 30000);
});
