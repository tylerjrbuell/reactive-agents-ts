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
import { AgentStream } from "../src/agent-stream.js";
import { generateReceiptKeyPair, verifyReceipt } from "../src/receipt-signing.js";

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
            let completed: Extract<import("../src/stream-types.js").AgentStreamEvent, { _tag: "StreamCompleted" }> | undefined;
            for await (const event of agent.runStream("echo hello")) {
                tags.push(event._tag);
                if (event._tag === "TrustEvent") {
                    trust = { verdict: event.verdict, confidence: event.confidence };
                }
                if (event._tag === "StreamCompleted") completed = event;
            }

            // Invariant 1: the TrustEvent reached the public surface.
            const trustIdx = tags.indexOf("TrustEvent");
            expect(trustIdx).toBeGreaterThanOrEqual(0);

            // Invariant 2: it preceded the terminal StreamCompleted — an event
            // queued after the terminal tag is never delivered (unfold stops).
            const completedIdx = tags.indexOf("StreamCompleted");
            expect(completedIdx).toBeGreaterThan(trustIdx);

            // Deterministic content on this scenario: one successful substantive
            // tool call + a final answer → tool-grounded. The plumbing this
            // comment anticipated LANDED on 2026-07-12: result-boundary
            // verification runs the terminal verifier on every path and
            // forwards its verdict to the receipt sites, so a clean answer
            // carries verifierVerdict="pass" → confidence 0.9 (receipt.ts
            // rule: pass raises confidence; reject/escalate caps the verdict).
            expect(trust?.verdict).toBe("tool-grounded");
            expect(trust?.confidence).toBe(0.9);

            // Invariant 3 (Task 8 closure): the FULL receipt rides on
            // StreamCompleted — streamed runs are runs; "receipt on every run"
            // includes this path, not just the TrustEvent summary.
            expect(completed?.receipt?.verdict).toBe("tool-grounded");
            // The verifier verdict reached the STREAM receipt too (the summary
            // TrustEvent carries only verdict+confidence by design).
            expect(completed?.receipt?.verifierVerdict).toBe("pass");
            expect(completed?.receipt?.toolsUsed).toEqual(["echo-tool"]);
            // Unsigned by default — no key configured on this agent.
            expect(completed?.receipt?.signature).toBeUndefined();
        } finally {
            await agent.dispose();
        }
    }, 30000);

    test("AgentStream.collect() carries the receipt into the reconstructed AgentResult", async () => {
        const agent = await buildEchoAgent("trust-collect");
        try {
            const result = await AgentStream.collect(agent.runStream("echo hello"));
            // collect()'s doc says "equivalent to agent.run()" — that includes
            // result.receipt (this reconstruction dropped it before the fix).
            expect(result.receipt?.verdict).toBe("tool-grounded");
            expect(result.receipt?.toolsUsed).toEqual(["echo-tool"]);
        } finally {
            await agent.dispose();
        }
    }, 30000);

    test("streamed receipt is SIGNED when .withReceiptSigning() is configured, and verifies", async () => {
        const { privateKeyJwk } = await generateReceiptKeyPair();
        const agent = await buildEchoAgent("trust-stream-signed", (b) =>
            b.withReceiptSigning({ privateKeyJwk }),
        );
        try {
            let completed: Extract<import("../src/stream-types.js").AgentStreamEvent, { _tag: "StreamCompleted" }> | undefined;
            for await (const event of agent.runStream("echo hello")) {
                if (event._tag === "StreamCompleted") completed = event;
            }
            expect(completed?.receipt?.verdict).toBe("tool-grounded");
            expect(completed?.receipt?.signature?.alg).toBe("ed25519");
            expect(await verifyReceipt(completed!.receipt!)).toBe(true);
        } finally {
            await agent.dispose();
        }
    }, 30000);
});

/** Same kernel echo-tool agent as the first test — shared so the collect()
 * and signing tests exercise the identical scenario alignment. */
async function buildEchoAgent(
    name: string,
    customize?: (b: ReturnType<typeof ReactiveAgents.create>) => ReturnType<typeof ReactiveAgents.create>,
) {
    let b = ReactiveAgents.create()
        .withName(name)
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
        .withRequiredTools({ adaptive: false })
        .withMaxIterations(4);
    if (customize) b = customize(b);
    return b.build();
}
