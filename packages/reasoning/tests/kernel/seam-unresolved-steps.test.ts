import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { detectLoopPattern } from "../../src/kernel/capabilities/reflect/loop-detector.js"
import { resolveDetectedLoop } from "../../src/kernel/loop/runner-helpers/loop-resolution.js"
import { applyStrategySwitch } from "../../src/kernel/loop/runner-helpers/strategy-switch.js"
import { countConsecutiveUnresolved, UNRESOLVED_STEP_META } from "../../src/kernel/capabilities/reason/unresolved-tool-call.js"
import { lastDeliverableThought, trailingUnresolvedRun } from "../../src/kernel/capabilities/reflect/unresolved-steps.js"
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js"
import {
  initialKernelState,
  transitionState,
} from "../../src/kernel/state/kernel-state.js"
import {
  makeKernelContext,
  makeKernelHooks,
  makeKernelInput,
  makeKernelRunOptions,
} from "../../src/testing/kernel-fixtures.js"

// F2 follow-up (2026-10-29-text-tool-call-after-fix.md gap 2): the loop detector,
// strategy switch and loop-resolution must all treat shaped-reply thoughts as
// strike-guard artifacts, never as thinking / output.

const RAW = '{"name":"nope","parameters":{"q":"x"}}'
const HINT = "Tool call used unavailable name(s): nope. Use one of: web-search."
/** One strike as the dispatcher records it: untagged twin + tagged (raw + hint). */
const strike = () => [
  makeStep("thought", RAW),
  makeStep("observation", "nudge"),
  makeStep("thought", `${RAW}\n\n${HINT}`, UNRESOLVED_STEP_META),
]

describe("loop-detector exempts shaped-reply thoughts", () => {
  test("3 strikes do not trip pattern (b) or (c)", () => {
    const steps = [...strike(), ...strike(), ...strike()]
    expect(detectLoopPattern(steps, 2, 3, 3)).toBeNull()
  })
  test("control: 3 plain thoughts still trip (c)", () => {
    const steps = [makeStep("thought", "a"), makeStep("thought", "b"), makeStep("thought", "c")]
    expect(detectLoopPattern(steps, 2, 5, 3)?.pattern.id).toBe("c")
  })
  test("plain thoughts mixed with shaped ones still count only the plain ones", () => {
    const steps = [...strike(), makeStep("thought", "p1"), makeStep("thought", "p2"), ...strike()]
    expect(detectLoopPattern(steps, 2, 9, 3)).toBeNull()
  })
})

describe("strategy switch carries the strike run", () => {
  test("countConsecutiveUnresolved survives applyStrategySwitch", async () => {
    const options = makeKernelRunOptions({ strategy: "react" })
    const input = makeKernelInput({ task: "t" })
    const hooks = makeKernelHooks()
    let prior = initialKernelState(options)
    prior = transitionState(prior, { steps: [...strike(), ...strike()] })
    expect(countConsecutiveUnresolved(prior.steps)).toBe(2)
    const r = await Effect.runPromise(
      applyStrategySwitch({
        state: prior, currentInput: input, context: makeKernelContext({ input }), options, hooks,
        triedStrategies: ["react"], switchCount: 0, fromStrategy: "react", toStrategy: "plan-execute-reflect",
        failureReason: "loop",
      }),
    )
    expect(countConsecutiveUnresolved(r.state.steps)).toBe(2)
    expect(trailingUnresolvedRun(r.state.steps).length).toBe(4)
  })
})

describe("loop-resolution never delivers a shaped thought", () => {
  const resolve = (steps: ReturnType<typeof strike>) => {
    const options = makeKernelRunOptions({ strategy: "react" })
    const state = transitionState(initialKernelState(options), { steps })
    return Effect.runPromise(
      resolveDetectedLoop({
        state, currentInput: makeKernelInput({ task: "t" }), currentOptions: options, loopMsg: "loop",
        failureRecoveryRedirects: 0, requiredToolNudgeCount: 0, maxFailureRecoveryRedirects: 2, maxRequiredToolNudges: 2,
        emitLog: () => Effect.void,
      }),
    )
  }
  test("only shaped thoughts => tool_call_unresolved, no JSON / hint in output", async () => {
    const r = await resolve([...strike(), ...strike()])
    expect(r.state.meta.terminatedBy).toBe("tool_call_unresolved")
    const out = r.state.output ?? ""
    expect(out).not.toContain("nope")
    expect(out).not.toContain("unavailable name")
  })
  test("prose thought before shaped ones is delivered instead", async () => {
    const r = await resolve([makeStep("thought", "The answer is 42, plainly."), ...strike()])
    expect(r.state.output ?? "").toContain("The answer is 42")
    expect(r.state.output ?? "").not.toContain("nope")
  })
  test("lastDeliverableThought skips tagged + twin", () => {
    expect(lastDeliverableThought(strike())).toBeUndefined()
  })
})
