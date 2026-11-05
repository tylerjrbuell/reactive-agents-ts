import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { applyStrategySwitch } from "../../src/kernel/loop/runner-helpers/strategy-switch.js"
import { resolveDetectedLoop } from "../../src/kernel/loop/runner-helpers/loop-resolution.js"
import {
  UNRESOLVED_STEP_META,
  carriedProtocolStrikes,
  chooseFallbackThought,
  guardUnresolvedToolCall,
  shouldWithholdTools,
  unresolvedStrikes,
  unresolvedStrikesOf,
} from "../../src/kernel/capabilities/reason/unresolved-tool-call.js"
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js"
import {
  initialKernelState,
  transitionState,
  type KernelState,
} from "../../src/kernel/state/kernel-state.js"
import {
  makeKernelContext,
  makeKernelHooks,
  makeKernelInput,
  makeKernelRunOptions,
} from "../../src/testing/kernel-fixtures.js"

// Plan 8 K3 / R6: protocol strike counts persist across a strategy switch
// (ledger `handoff.protocolStrikes`, not re-derived from the reset `steps`),
// and a run left with only shaped-reply history terminates `tool_call_unresolved`.

const RAW = '{"name":"nope","parameters":{"q":"x"}}'
const HINT = "Tool call used unavailable name(s): nope. Use one of: web-search."
const strike = () => [
  makeStep("thought", RAW),
  makeStep("observation", "nudge"),
  makeStep("thought", `${RAW}\n\n${HINT}`, UNRESOLVED_STEP_META),
]
const failedNativeCall = () => [
  makeStep("action", "web-search"),
  makeStep("observation", "boom", { observationResult: { toolName: "web-search", success: false } } as never),
]
const successfulObservation = () =>
  makeStep("observation", "ok", { observationResult: { toolName: "web-search", success: true } } as never)

const options = makeKernelRunOptions({ strategy: "react" })
const input = makeKernelInput({ task: "t" })
const hooks = makeKernelHooks()
const context = makeKernelContext({ input })

const switchFrom = (steps: ReturnType<typeof strike>): Promise<KernelState> => {
  const prior = transitionState(initialKernelState(options), { steps })
  return Effect.runPromise(
    applyStrategySwitch({
      state: prior, currentInput: input, context, options, hooks,
      triedStrategies: ["react"], switchCount: 0, fromStrategy: "react", toStrategy: "plan-execute-reflect",
      failureReason: "loop",
    }),
  ).then((r) => r.state)
}

describe("K3: strike counts persist across a strategy switch", () => {
  // shaped, failing native call, shaped: the steps-derived total is 2 but the
  // TRAILING run (all a steps carry can preserve) is 1.
  const interleaved = () => [...strike(), ...failedNativeCall(), ...strike()]

  test("precondition: derived total 2, only 1 survives as carried steps", async () => {
    expect(unresolvedStrikes(interleaved())).toBe(2)
    const next = await switchFrom(interleaved())
    expect(unresolvedStrikes(next.steps)).toBe(1)
  })

  test("the carried count rides the ledger handoff and restores strikes after the switch", async () => {
    const next = await switchFrom(interleaved())
    expect(carriedProtocolStrikes(next.ledger)).toBe(2)
    expect(unresolvedStrikesOf(next)).toBe(2)
    // Strike 2 already reached: the next think call must ship with NO tools.
    expect(shouldWithholdTools(next)).toBe(true)
  })

  test("the first shaped reply after the switch is strike 3: honest terminal, not another reprompt", async () => {
    const next = await switchFrom(interleaved())
    const turn = { newSteps: [], newTokens: 0, newInputTokens: 0, newOutputTokens: 0, newCost: 0 }
    const out = await Effect.runPromise(guardUnresolvedToolCall(next, turn, RAW))
    expect(out).not.toBeNull()
    expect(out!.meta.terminatedBy).toBe("tool_call_unresolved")
    expect(out!.output ?? "").not.toContain("nope")
  })

  test("a SUCCESSFUL tool call after the switch clears the carried debt", async () => {
    const next = await switchFrom(interleaved())
    const progressed = transitionState(next, { steps: [...next.steps, successfulObservation()] })
    expect(carriedProtocolStrikes(progressed.ledger)).toBe(0)
    expect(shouldWithholdTools(progressed)).toBe(false)
  })

  test("a switch from a clean run carries nothing", async () => {
    const next = await switchFrom([makeStep("thought", "plain prose")])
    expect(carriedProtocolStrikes(next.ledger)).toBe(0)
  })

  test("strikes accumulate through a second switch", async () => {
    const first = await switchFrom(interleaved())
    const second = await Effect.runPromise(
      applyStrategySwitch({
        state: first, currentInput: input, context, options, hooks,
        triedStrategies: ["react"], switchCount: 1, fromStrategy: "plan-execute-reflect", toStrategy: "reflexion",
        failureReason: "loop",
      }),
    )
    expect(carriedProtocolStrikes(second.state.ledger)).toBe(2)
  })
})

describe("K3: shaped-only history terminates honestly", () => {
  // Prior run ends on a failing native call, so NO shaped step is carried: the
  // switched state's steps hold no shaped thought at all.
  const carriedOnly = () => switchFrom([...strike(), ...strike(), ...failedNativeCall()])

  // Plan 9 item 9: failure-recovery steering reads the run's evidence, so the
  // pre-switch web-search failure (carried on the ledger) is failed unresolved
  // after the switch too. With redirect budget left, loop resolution steers
  // recovery first; once the budget is spent it terminates honestly.
  const resolve = (state: KernelState, failureRecoveryRedirects: number) =>
    Effect.runPromise(
      resolveDetectedLoop({
        state, currentInput: input, currentOptions: options, loopMsg: "loop",
        failureRecoveryRedirects, requiredToolNudgeCount: 0, maxFailureRecoveryRedirects: 2, maxRequiredToolNudges: 2,
        emitLog: () => Effect.void,
      }),
    )

  test("loop resolution after the switch: recovery steering for the carried failure while budget remains", async () => {
    const r = await resolve(await carriedOnly(), 0)
    expect(r.outcome).toBe("next")
    expect(r.failureRecoveryRedirects).toBe(1)
    expect(r.state.pendingGuidance?.errorRecovery ?? "").toContain("web-search")
  })

  test("loop resolution after the switch: tool_call_unresolved, no JSON/hint delivered", async () => {
    const state = await carriedOnly()
    expect(unresolvedStrikes(state.steps)).toBe(0)
    const r = await resolve(state, 2)
    expect(r.state.meta.terminatedBy).toBe("tool_call_unresolved")
    expect(r.state.output ?? "").not.toContain("nope")
    expect(r.state.output ?? "").not.toContain("unavailable name")
  })

  test("fallback chooser: carried strikes + no prose => unresolved; prose still wins", async () => {
    const state = await carriedOnly()
    expect(chooseFallbackThought(state.steps)).toBeUndefined()
    expect(chooseFallbackThought(state.steps, { carriedUnresolved: true })).toEqual({ kind: "unresolved" })
    const withProse = [...state.steps, makeStep("thought", "The answer is 42, plainly.")]
    expect(chooseFallbackThought(withProse, { carriedUnresolved: true })).toEqual({
      kind: "prose",
      content: "The answer is 42, plainly.",
    })
  })
})
