/**
 * INVARIANT: every ToolCallStarted gets a ToolCallCompleted.
 *
 * `onAction` publishes ToolCallStarted for any tool call. `onObservation`
 * publishes the matching ToolCallCompleted *only if the preceding action step
 * carries `metadata.toolUsed`* — that lookup is how it distinguishes a real tool
 * from a system-injected observation (a nudge, a completion-guard redirect),
 * which must stay out of tool metrics.
 *
 * Six of the nine action-step sites in act.ts omitted `toolUsed`: the
 * allowedTools block, the meta-tool handler, final-answer accept, final-answer
 * reject, the blocked batch call, and the guard-blocked call. All six published
 * a START and silently dropped the COMPLETE — so tool metrics under-counted, and
 * once the stream projection landed (2026-07-12) a UI would render a spinner for
 * a blocked or rejected tool that never resolved. A blocked tool is precisely the
 * one a user needs to see resolve.
 *
 * Caught by the probe fleet's runtime-hygiene check, which greps the kernel's own
 * "no ToolCallCompleted emitted" debug line for `lastStepType:action`.
 *
 * This pins the PAIRING PROPERTY rather than the six sites, because the same
 * disease has now recurred at five different layers of this codebase.
 *
 * Run: bun test packages/reasoning/tests/kernel/tool-event-pairing.test.ts
 */
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";

import { buildKernelHooks } from "../../src/kernel/state/kernel-hooks.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import type { KernelState } from "../../src/kernel/state/kernel-state.js";

interface Published {
    readonly _tag: string;
    readonly toolName?: string;
    readonly callId?: string;
}

/** Minimal EventBus double (a `MaybeService`) recording what the hooks publish. */
function makeRecordingBus(sink: Published[]) {
    return {
        _tag: "Some" as const,
        value: {
            publish: (event: unknown) =>
                Effect.sync(() => {
                    sink.push(event as Published);
                }),
        },
    };
}

function baseState(steps: KernelState["steps"]): KernelState {
    return {
        taskId: "task-1",
        strategy: "reactive",
        iteration: 1,
        steps,
        meta: {},
        messages: [],
        toolsUsed: new Set<string>(),
        tokens: 0,
        cost: 0,
        llmCalls: 0,
        status: "thinking",
        output: null,
    } as unknown as KernelState;
}

describe("kernel hooks — ToolCallStarted/ToolCallCompleted pairing", () => {
    /**
     * Each case is an action step exactly as one of act.ts's sites mints it.
     * The observation that follows must still emit a completion.
     */
    const CASES = [
        { name: "allowedTools-blocked", tool: "file-write", success: false },
        { name: "meta-tool", tool: "todo", success: true },
        { name: "final-answer-accepted", tool: "final-answer", success: true },
        { name: "final-answer-rejected", tool: "final-answer", success: false },
        { name: "guard-blocked", tool: "shell-execute", success: false },
    ] as const;

    for (const c of CASES) {
        test(`${c.name}: a started tool call is also completed`, async () => {
            const published: Published[] = [];
            const hooks = buildKernelHooks(makeRecordingBus(published) as never);

            const actionStep = makeStep("action", `${c.tool}({})`, {
                toolCall: { id: "call-abc", name: c.tool, arguments: {} },
                toolUsed: c.tool,
            });

            await Effect.runPromise(
                hooks.onAction(baseState([]), c.tool, "{}", { callId: "call-abc" }),
            );
            await Effect.runPromise(
                hooks.onObservation(baseState([actionStep]), "observation text", c.success),
            );

            const started = published.filter((e) => e._tag === "ToolCallStarted");
            const completed = published.filter((e) => e._tag === "ToolCallCompleted");

            expect(started).toHaveLength(1);
            // The invariant. Six act.ts sites failed exactly this.
            expect(completed).toHaveLength(1);
            expect(completed[0]!.toolName).toBe(c.tool);
            // …and the two are joinable: a consumer must be able to match them.
            expect(completed[0]!.callId).toBe(started[0]!.callId);
        });
    }

    test("a system-injected observation (no action behind it) emits NO completion", async () => {
        // The other half of the invariant: nudges and completion-guard redirects
        // must stay OUT of tool metrics, which is why toolUsed is the gate.
        const published: Published[] = [];
        const hooks = buildKernelHooks(makeRecordingBus(published) as never);
        const thoughtStep = makeStep("thought", "just thinking", {});

        await Effect.runPromise(
            hooks.onObservation(baseState([thoughtStep]), "harness nudge", true),
        );

        expect(published.filter((e) => e._tag === "ToolCallCompleted")).toHaveLength(0);
    });
});
