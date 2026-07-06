/**
 * TrustEvent on the PUBLIC runStream() surface (Arc 1 Task 8, review fix 1).
 *
 * Guards the exact gap class T5 hit: unit tests on the pure function stay
 * green while the public streaming surface silently misbehaves. Two invariants
 * locked here, both discovered the hard way during Task 8:
 *
 *   1. A TrustEvent ARRIVES on the public async-iterator at all. The receipt
 *      wiring lives in execute-stream.ts's finalization tap — a regression
 *      there (or a consumer on a stale dist) is invisible to the core
 *      receipt.test.ts unit suite.
 *   2. The TrustEvent arrives BEFORE StreamCompleted. The stream's consumer
 *      unfold loop stops reading the queue the moment it sees a terminal tag,
 *      so an event queued after StreamCompleted is silently NEVER delivered —
 *      the original wiring bug, fixed by ordering the Queue.offer calls.
 *
 * Keyless — test provider, kernel path (mirrors run-inspect.test.ts's
 * integration pattern).
 *
 * Run: bun test packages/runtime/tests/trust-event-stream.test.ts --timeout 15000
 */
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgents } from "../src/builder.js";

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

describe("runStream() public handle — TrustEvent integration", () => {
    test("TrustEvent arrives on the public stream and precedes StreamCompleted", async () => {
        const agent = await ReactiveAgents.create()
            .withName("trust-event-stream")
            .withTestScenario([
                { toolCall: { name: "echo-tool", args: { input: "hello" } } },
                { text: "FINAL ANSWER: done" },
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
            .withReasoning({ defaultStrategy: "reactive" })
            // Disable adaptive tool-relevance classification: it fires an extra
            // LLM round-trip during setup that would consume the FIRST scenario
            // turn (the tool call) before think() ever sees it — the run would
            // never execute the tool and the receipt would grade "ungrounded".
            // Same alignment pattern as approval-real-pause-resume.test.ts.
            .withRequiredTools({ adaptive: false })
            .withMaxIterations(4)
            .build();
        try {
            const tags: string[] = [];
            let trust: { verdict: string; confidence: number } | undefined;
            for await (const event of agent.runStream("echo hello")) {
                tags.push(event._tag);
                if (event._tag === "TrustEvent") {
                    trust = { verdict: event.verdict, confidence: event.confidence };
                }
            }

            // Invariant 1: the TrustEvent reached the public surface.
            const trustIdx = tags.indexOf("TrustEvent");
            expect(trustIdx).toBeGreaterThanOrEqual(0);

            // Invariant 2: it preceded the terminal StreamCompleted — an event
            // queued after the terminal tag is never delivered (unfold stops).
            const completedIdx = tags.indexOf("StreamCompleted");
            expect(completedIdx).toBeGreaterThan(trustIdx);

            // Deterministic content on this scenario: one successful substantive
            // tool call + a final answer → tool-grounded at 0.8 (no verifier
            // "pass" is currently forwarded to the receipt sites — see the
            // Task 8 report's verifier-gap note; bump if that plumbing lands).
            expect(trust?.verdict).toBe("tool-grounded");
            expect(trust?.confidence).toBe(0.8);
        } finally {
            await agent.dispose();
        }
    }, 30000);
});
