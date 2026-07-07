import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { applyStrategySwitch } from "../src/kernel/loop/runner-helpers/strategy-switch.js"
import {
    initialKernelState,
    transitionState,
    type KernelContext,
    type KernelHooks,
    type KernelInput,
    type KernelRunOptions,
} from "../src/kernel/state/kernel-state.js"
import { makeStep } from "../src/kernel/capabilities/sense/step-utils.js"

// P4 (2026-07-07, A2 #3): a strategy switch reset kernel state, losing every
// successful tool observation and the toolsUsed ledger — the new strategy both
// lacked the data and was redirected by the required-tools gate to re-call
// tools that already succeeded (~2× run cost observed after escalation).
describe("applyStrategySwitch carries successful tool results + toolsUsed", () => {
    const hooks = {
        onStrategySwitched: () => Effect.void,
    } as unknown as KernelHooks

    const options = { strategy: "react" } as unknown as KernelRunOptions
    const input = { task: "t", requiredTools: ["web-search"] } as unknown as KernelInput
    const context = { input } as unknown as KernelContext

    const buildPriorState = () => {
        let s = initialKernelState(options)
        const okStep = makeStep("observation", "search found 3 results", {
            observationResult: {
                toolName: "web-search",
                success: true,
                displayText: "search found 3 results",
                category: "data" as const,
                resultKind: "success" as const,
                preserveOnCompaction: true,
                trustLevel: "untrusted" as const,
            },
        })
        const failStep = makeStep("observation", "tool x failed", {
            observationResult: {
                toolName: "broken-tool",
                success: false,
                displayText: "tool x failed",
                category: "error" as const,
                resultKind: "error" as const,
                preserveOnCompaction: false,
                trustLevel: "trusted" as const,
            },
        })
        s = transitionState(s, {
            steps: [...s.steps, okStep, failStep],
            toolsUsed: new Set(["web-search"]),
        })
        return s
    }

    test("successful observations and toolsUsed survive the switch", async () => {
        const result = await Effect.runPromise(
            applyStrategySwitch({
                state: buildPriorState(),
                currentInput: input,
                context,
                options,
                hooks,
                triedStrategies: ["react"],
                switchCount: 0,
                fromStrategy: "react",
                toStrategy: "plan-execute",
                failureReason: "loop detected",
            }),
        )
        const carried = result.state.steps.filter(
            (s) => (s.metadata?.observationResult as { success?: boolean } | undefined)?.success === true,
        )
        expect(carried.length).toBe(1)
        expect(carried[0]?.content).toContain("search found 3 results")
        expect(result.state.toolsUsed.has("web-search")).toBe(true)
        // Failed observations are NOT carried as results (the synthetic
        // permanently-unavailable path owns that signal).
        const carriedFailures = result.state.steps.filter(
            (s) => (s.metadata?.observationResult as { toolName?: string } | undefined)?.toolName === "broken-tool",
        )
        expect(carriedFailures.length).toBe(0)
    })
})
