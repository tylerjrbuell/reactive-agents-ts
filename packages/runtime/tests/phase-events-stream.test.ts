/**
 * Lifecycle phases on the PUBLIC runStream() surface (Debt Register B5).
 *
 * `PhaseStarted` / `PhaseCompleted` were declared in AgentStreamEvent and
 * advertised as density:"full" events (ui-core protocol + the docs streaming
 * page) — with ZERO writers. `engine/pipeline.ts:runObservablePhase` publishes
 * `ExecutionPhaseEntered` / `ExecutionPhaseCompleted` on the EventBus for every
 * one of the 10 ExecutionEngine phases, and observability subscribes to build
 * metrics, but nothing projected them onto the public stream. Net effect: a
 * density:"full" consumer waited forever for phase events that fired internally
 * but never surfaced. Byte-identical to the tool-events gap fixed in 61f05489.
 *
 * Red-on-cut: delete the two `eb.on("ExecutionPhase…")` blocks in
 * execute-stream.ts and the density:"full" assertions below go 0 → fail.
 *
 * Run: bun test packages/runtime/tests/phase-events-stream.test.ts --timeout 30000
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

async function buildAgent(name: string) {
    return ReactiveAgents.create()
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
        // turn on its own prompt (mirrors tool-events-stream.test.ts).
        .withRequiredTools({ adaptive: false })
        .withMaxIterations(4)
        .build();
}

describe("runStream() public handle — lifecycle phase events (B5)", () => {
    test('density "full" delivers PhaseStarted + PhaseCompleted with phase names', async () => {
        const agent = await buildAgent("phase-events-full");
        try {
            const events: AgentStreamEvent[] = [];
            for await (const event of agent.runStream("echo hello", { density: "full" })) {
                events.push(event);
            }

            const started = events.filter((e) => e._tag === "PhaseStarted") as Extract<
                AgentStreamEvent,
                { _tag: "PhaseStarted" }
            >[];
            const completed = events.filter((e) => e._tag === "PhaseCompleted") as Extract<
                AgentStreamEvent,
                { _tag: "PhaseCompleted" }
            >[];

            // The gap: both were 0 before the projection was wired.
            expect(started.length).toBeGreaterThanOrEqual(1);
            expect(completed.length).toBeGreaterThanOrEqual(1);

            // Each chunk names its phase (one of the 10 ExecutionEngine phases).
            expect(started[0]!.phase.length).toBeGreaterThan(0);
            expect(completed[0]!.phase.length).toBeGreaterThan(0);
            // PhaseStarted stamps a projection-time timestamp; PhaseCompleted a duration.
            expect(typeof started[0]!.timestamp).toBe("number");
            expect(typeof completed[0]!.durationMs).toBe("number");

            // A completed phase name must also have been started (balanced lifecycle).
            const startedPhases = new Set(started.map((e) => e.phase));
            expect(startedPhases.has(completed[0]!.phase)).toBe(true);

            // Terminal-ordering guard: anything queued after StreamCompleted is
            // never delivered (the consumer's unfold stops at the terminal tag).
            const completedIdx = events.findIndex((e) => e._tag === "PhaseCompleted");
            const terminalIdx = events.findIndex((e) => e._tag === "StreamCompleted");
            expect(completedIdx).toBeGreaterThanOrEqual(0);
            expect(completedIdx).toBeLessThan(terminalIdx);
        } finally {
            await agent.dispose();
        }
    }, 30000);

    test("default density does NOT emit phase events (they are opt-in via density:'full')", async () => {
        const agent = await buildAgent("phase-events-default-density");
        try {
            const events: AgentStreamEvent[] = [];
            for await (const event of agent.runStream("echo hello")) events.push(event);
            expect(events.some((e) => e._tag === "PhaseStarted")).toBe(false);
            expect(events.some((e) => e._tag === "PhaseCompleted")).toBe(false);
            // …but the run still really ran its phases — this is a projection
            // policy, not an execution difference.
            const terminal = events.find((e) => e._tag === "StreamCompleted");
            expect(terminal).toBeDefined();
        } finally {
            await agent.dispose();
        }
    }, 30000);
});
