/**
 * Tool lifecycle on the PUBLIC runStream() surface.
 *
 * `ToolCallStarted` / `ToolCallCompleted` were declared in AgentStreamEvent and
 * documented as density:"full" events — with ZERO writers. Both loops published
 * them on the EventBus, and execution-engine subscribed to build the receipt,
 * but nothing projected them onto the stream. Net effect (2026-07-12 probe
 * fleet, p8): a run wrote a file, the receipt said "tool-grounded", and a
 * consumer of the public stream observed [TextDelta, TrustEvent, StreamCompleted]
 * — no tool activity whatsoever. The receipt read the bus; the stream didn't.
 *
 * Both loops are pinned here on purpose. The kernel path (.withReasoning()) and
 * the DEFAULT minimal path project through different publishers, and the
 * pre-existing iteration-progress pin covered only the kernel path — which is
 * precisely why the minimal-loop hole survived.
 *
 * Run: bun test packages/runtime/tests/tool-events-stream.test.ts --timeout 15000
 */
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgents } from "../src/builder.js";
import type { AgentStreamEvent } from "../src/stream-types.js";

function makeToolDef(name: string) {
    return {
        name,
        description: `Tool ${name}`,
        parameters: [
            { name: "input", type: "string" as const, description: "Input", required: true },
        ],
        riskLevel: "low" as const,
        timeoutMs: 5_000,
        requiresApproval: false,
        source: "function" as const,
    };
}

/** `kernel` uses .withReasoning(); `minimal` is the DEFAULT inline agent loop. */
async function buildAgent(name: string, loop: "kernel" | "minimal") {
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
        // The tool-relevance classifier would otherwise burn the first scenario
        // turn (the tool call) on its own prompt and the tool would never run.
        .withRequiredTools({ adaptive: false })
        .withMaxIterations(4);
    if (loop === "kernel") b = b.withReasoning({ defaultStrategy: "reactive" });
    return b.build();
}

describe("runStream() public handle — tool lifecycle events", () => {
    for (const loop of ["kernel", "minimal"] as const) {
        test(`${loop} loop: density "full" delivers ToolCallStarted + ToolCallCompleted`, async () => {
            const agent = await buildAgent(`tool-events-${loop}`, loop);
            try {
                const events: AgentStreamEvent[] = [];
                for await (const event of agent.runStream("echo hello", { density: "full" })) {
                    events.push(event);
                }

                const started = events.filter((e) => e._tag === "ToolCallStarted");
                const completed = events.filter((e) => e._tag === "ToolCallCompleted");

                // The gap: both were 0 before the projection was wired.
                expect(started.length).toBeGreaterThanOrEqual(1);
                expect(completed.length).toBeGreaterThanOrEqual(1);

                expect(started[0]!.toolName).toBe("echo-tool");
                expect(completed[0]!.toolName).toBe("echo-tool");
                expect(completed[0]!.success).toBe(true);

                // callId symmetry: a UI must be able to pair a completion with its
                // start. The kernel published the action's tc.id on start but the
                // step's own ULID on completion, so the two never matched.
                expect(started[0]!.callId).toBe(completed[0]!.callId);
                expect(started[0]!.callId.length).toBeGreaterThan(0);

                // Terminal-ordering guard: anything queued after StreamCompleted is
                // never delivered (the consumer's unfold stops at the terminal tag).
                const completedIdx = events.findIndex((e) => e._tag === "ToolCallCompleted");
                const terminalIdx = events.findIndex((e) => e._tag === "StreamCompleted");
                expect(completedIdx).toBeLessThan(terminalIdx);
            } finally {
                await agent.dispose();
            }
        }, 30000);
    }

    test("default density does NOT emit tool events (they are opt-in via density:'full')", async () => {
        const agent = await buildAgent("tool-events-default-density", "kernel");
        try {
            const events: AgentStreamEvent[] = [];
            for await (const event of agent.runStream("echo hello")) events.push(event);
            expect(events.some((e) => e._tag === "ToolCallStarted")).toBe(false);
            expect(events.some((e) => e._tag === "ToolCallCompleted")).toBe(false);
            // …but the run still really used the tool — this is a projection
            // policy, not an execution difference.
            const terminal = events.find((e) => e._tag === "StreamCompleted") as
                | Extract<AgentStreamEvent, { _tag: "StreamCompleted" }>
                | undefined;
            expect(terminal?.receipt?.toolsUsed).toEqual(["echo-tool"]);
        } finally {
            await agent.dispose();
        }
    }, 30000);
});
