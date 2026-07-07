/**
 * TDD: RunController.noteCheckpoint() / inspect() — live kernel-state
 * introspection via a LAZY snapshot thunk (Arc 1 Task 5).
 *
 * Binding perf constraint: non-durable runs must not pay per-iteration
 * serialization. `noteCheckpoint` stores a THUNK; the thunk only executes
 * when `inspect()` is actually called. This test asserts the thunk-call
 * count is 0 immediately after noteCheckpoint() and exactly 1 after the
 * first inspect() call (subsequent inspect() calls re-invoke the SAME thunk
 * — the controller does not cache the deserialized result, since a caller
 * may call inspect() again after storing a NEW checkpoint).
 *
 * The fake envelope mirrors the REAL codec shape produced by
 * `serializeKernelState` (packages/reasoning/src/kernel/state/kernel-codec.ts):
 *   { codecVersion: number, state: <encodeValue(KernelState)> }
 * KernelState field paths (packages/reasoning/src/kernel/state/kernel-state.ts):
 *   - state.status: KernelStatus ("thinking" | "acting" | ...) — NOT surfaced
 *     directly on RunInspection (that field reports the controller's own
 *     RunStatus instead — see run-controller.ts).
 *   - state.steps: readonly ReasoningStep[] ({ type, content, ... })
 *   - state.messages: readonly KernelMessage[]
 *   - state.meta.pendingNativeToolCalls: readonly ToolCallSpec[] ({ id, name, arguments })
 *   - state.meta.lastThought?: string — cleared to undefined by the act phase,
 *     so `inspect()` falls back to the last steps[] entry with type "thought".
 */
import { describe, test, expect } from "bun:test";
import { RunController } from "../src/run-controller.js";

// Mirrors serializeKernelState()'s envelope — codecVersion + encodeValue(KernelState).
// meta.lastThought deliberately OMITTED so this also exercises the steps[]
// fallback path (real runs clear meta.lastThought during the act phase).
const SNAPSHOT = JSON.stringify({
    codecVersion: 1,
    state: {
        status: "acting",
        steps: [
            { id: "s1", type: "thought", content: "I should use the calculator to compute the product.", timestamp: { $ra: "date", v: "2026-07-05T00:00:00.000Z" } },
            { id: "s2", type: "action", content: "calculator", timestamp: { $ra: "date", v: "2026-07-05T00:00:01.000Z" } },
        ],
        messages: [
            { role: "user", content: "hi" },
            { role: "assistant", content: "" },
        ],
        meta: {
            pendingNativeToolCalls: [{ id: "call_1", name: "calculator", arguments: { expression: "1+1" } }],
        },
    },
});

describe("RunController.noteCheckpoint / inspect", () => {
    test("thunk is NOT invoked until inspect() is called (lazy perf constraint)", () => {
        const c = new RunController(new AbortController());
        let serialized = 0;
        c.noteCheckpoint(() => {
            serialized++;
            return SNAPSHOT;
        }, 3);
        expect(serialized).toBe(0);
        const i = c.inspect();
        expect(serialized).toBe(1);
        expect(i).toBeDefined();
    });

    test("projects real codec field paths onto RunInspection", () => {
        const c = new RunController(new AbortController());
        c.noteCheckpoint(() => SNAPSHOT, 3);
        const i = c.inspect();
        expect(i).toBeDefined();
        expect(i!.iteration).toBe(3);
        expect(i!.stepsCount).toBe(2);
        expect(i!.messagesCount).toBe(2);
        expect(i!.pendingToolCalls).toEqual(["calculator"]);
        expect(i!.lastThought).toContain("calculator");
        expect(typeof i!.capturedAt).toBe("number");
        expect(i!.status).toBe(c.status());
    });

    test("truncates lastThought to 500 chars", () => {
        const c = new RunController(new AbortController());
        const longThought = "x".repeat(600);
        const snap = JSON.stringify({
            codecVersion: 1,
            state: {
                status: "thinking",
                steps: [{ id: "s1", type: "thought", content: longThought, timestamp: { $ra: "date", v: "2026-07-05T00:00:00.000Z" } }],
                messages: [],
                meta: {},
            },
        });
        c.noteCheckpoint(() => snap, 1);
        const i = c.inspect();
        expect(i!.lastThought?.length).toBe(500);
    });

    test("undefined before any checkpoint", () => {
        const c = new RunController(new AbortController());
        expect(c.inspect()).toBeUndefined();
    });

    test("undefined (never throws) on a corrupt/non-JSON snapshot", () => {
        const c = new RunController(new AbortController());
        c.noteCheckpoint(() => "{not json", 5);
        expect(() => c.inspect()).not.toThrow();
        expect(c.inspect()).toBeUndefined();
    });

    test("undefined (never throws) when the thunk itself throws", () => {
        const c = new RunController(new AbortController());
        c.noteCheckpoint(() => {
            throw new Error("boom");
        }, 1);
        expect(() => c.inspect()).not.toThrow();
        expect(c.inspect()).toBeUndefined();
    });

    test("empty pendingToolCalls and stepsCount 0 when meta/steps absent", () => {
        const c = new RunController(new AbortController());
        const snap = JSON.stringify({ codecVersion: 1, state: { status: "thinking" } });
        c.noteCheckpoint(() => snap, 0);
        const i = c.inspect();
        expect(i).toBeDefined();
        expect(i!.stepsCount).toBe(0);
        expect(i!.messagesCount).toBe(0);
        expect(i!.pendingToolCalls).toEqual([]);
        expect(i!.lastThought).toBeUndefined();
    });
});

// ─── Integration: public runStream() handle exposes inspect() ───────────────
// Guards the exact gap the T5 live smoke caught: unit tests import
// RunController from src and stay green while the PUBLIC handle returned by
// agent.runStream() silently lacks the method (wrapper site missed, or a
// consumer running a stale dist). Keyless — test provider, kernel path.
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

describe("runStream() public handle — inspect() integration", () => {
    test("handle exposes inspect(); undefined pre-iteration; live values on kernel path", async () => {
        const agent = await ReactiveAgents.create()
            .withName("run-inspect-integration")
            .withTestScenario([
                { toolCall: { name: "echo-tool", args: { input: "hello" } } },
                { text: "FINAL ANSWER: done" },
            ])
            .withTools({
                tools: [
                    {
                        definition: makeToolDef("echo-tool"),
                        handler: (args: Record<string, unknown>) => Effect.succeed(`echoed: ${String(args.input)}`),
                    },
                ],
            })
            .withReasoning()
            .withMaxIterations(4)
            .build();
        try {
            const handle = agent.runStream("echo hello");
            // The wiring gap this test exists for: the PUBLIC handle must have it.
            expect(typeof handle.inspect).toBe("function");
            // Before the first iteration boundary: undefined, never a throw.
            expect(handle.inspect()).toBeUndefined();

            const seen: Array<{ iteration: number; stepsCount: number }> = [];
            for await (const _event of handle) {
                const i = handle.inspect();
                if (i) seen.push({ iteration: i.iteration, stepsCount: i.stepsCount });
            }

            // The kernel path crossed at least one iteration boundary mid-run.
            expect(seen.length).toBeGreaterThan(0);
            const last = handle.inspect();
            expect(last).toBeDefined();
            // Multi-pass run (tool call then final answer): the latest snapshot
            // reflects a later boundary, not the pristine iteration-0 state.
            expect(last!.iteration).toBeGreaterThanOrEqual(1);
            expect(last!.stepsCount).toBeGreaterThanOrEqual(1);
        } finally {
            await agent.dispose();
        }
    }, 30000);
});
