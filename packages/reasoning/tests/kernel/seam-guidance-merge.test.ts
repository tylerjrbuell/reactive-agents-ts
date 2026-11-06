// Run: bun test packages/reasoning/tests/kernel/seam-guidance-merge.test.ts --timeout 15000
//
// Guidance merges by kind (2026-11-06). Every PendingGuidance writer contributes
// its own kind and keeps the others: a writer that replaced the whole record
// dropped the hint explaining the model's last failure (last writer won). Pins:
//  1. Each formerly-replacing writer keeps a prior kind it does not own.
//  2. At strike 2 (tools withheld next turn) the ICS steer never says "call X":
//     it would contradict the plain-text instruction.
//  3. The resolver's reparse hint for a known tool whose call text could not be
//     parsed reaches the next request (it used to land only in state.steps).
// The source-level drift pin (no whole-record write outside the channel) lives
// in seam-guidance-channel.test.ts. Zero-token: scripted LLM, direct seam calls.
import { describe, expect, it, test } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { LLMService, TestLLMService, type StreamEvent, type LLMErrors } from "@reactive-agents/llm-provider"
import { executeReactive } from "../../src/strategies/reactive.js"
import { defaultReasoningConfig } from "../../src/types/config.js"
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js"
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js"
import { makeKernelInput, makeKernelRunOptions } from "../../src/testing/kernel-fixtures.js"
import { initialKernelState, transitionState, type KernelState } from "../../src/kernel/state/kernel-state.js"
import type { PendingGuidance } from "../../src/kernel/state/guidance-channel.js"
import { CONTEXT_PROFILES } from "../../src/context/context-profile.js"
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js"
import { runIcsNudgeStep } from "../../src/kernel/loop/iterate-guard-seams.js"
import { continueThinking } from "../../src/kernel/capabilities/reason/continue-thinking.js"
import {
  UNRESOLVED_STEP_META,
  guardUnresolvedToolCall,
  shouldWithholdTools,
} from "../../src/kernel/capabilities/reason/unresolved-tool-call.js"
import { resolveDetectedLoop } from "../../src/kernel/loop/runner-helpers/loop-resolution.js"
import { runStallDeliverableStep } from "../../src/kernel/loop/runner-helpers/stall-deliverable.js"
import { defaultVerifier } from "../../src/kernel/capabilities/verify/verifier.js"
import { lastCallNotRunHint } from "../../src/kernel/capabilities/reason/unavailable-tool-hint.js"

/** A prior record holding kinds none of the writers below own. */
const PRIOR: PendingGuidance = { toolUnavailable: "PRIOR-UNAVAILABLE", gatherDedup: "PRIOR-DEDUP" }
const keepsPrior = (g: PendingGuidance | undefined) => {
  expect(g?.toolUnavailable).toBe("PRIOR-UNAVAILABLE")
  expect(g?.gatherDedup).toBe("PRIOR-DEDUP")
}

const options = makeKernelRunOptions({ strategy: "reactive" })
const base = (patch: Partial<KernelState> = {}): KernelState =>
  transitionState(initialKernelState(options), { pendingGuidance: PRIOR, ...patch })
/** Evidence is ledger-derived; a direct spread sets a run-wide unresolved failure for the recovery branches. */
const withFailedTool = (s: KernelState): KernelState => ({ ...s, evidence: { ...s.evidence, permanentlyFailed: ["web-search"] } })
const turn = (s: KernelState) => ({ newSteps: s.steps, newTokens: 0, newInputTokens: 0, newOutputTokens: 0, newCost: 0 })
const noLog = () => Effect.void

describe("1. writers merge by kind (a prior kind they do not own survives)", () => {
  it("ICS steer (iterate-guard-seams.ts)", async () => {
    const out = await Effect.runPromise(runIcsNudgeStep({
      state: base({ iteration: 1 }),
      currentInput: makeKernelInput({ requiredTools: ["web-search"] }),
      effectiveToolsUsed: new Set(),
      profile: CONTEXT_PROFILES.local,
      shouldAllowIcsNudge: true,
    }))
    expect(out.pendingGuidance?.icsGuidance).toContain("web-search")
    keepsPrior(out.pendingGuidance)
  })

  it("standard thinking handler (continue-thinking.ts)", () => {
    const s = base()
    const out = continueThinking({
      state: s, input: makeKernelInput({ requiredTools: ["web-search"] }), profile: CONTEXT_PROFILES.local, adapter: {},
      turn: turn(s), thinkingContent: "thinking", shaped: false, reqTools: ["web-search"], missingReq: ["web-search"], unavailableHint: undefined,
    })
    expect(out.pendingGuidance?.requiredToolsPending).toEqual(["web-search"])
    keepsPrior(out.pendingGuidance)
  })

  it("strike-2 plain-text instruction (unresolved-tool-call.ts)", async () => {
    const s = base({ steps: [makeStep("thought", "{bad", UNRESOLVED_STEP_META)] })
    const out = await Effect.runPromise(guardUnresolvedToolCall(s, turn(s), "{bad again"))
    expect(out?.pendingGuidance?.errorRecovery).toContain("Answer the task now in plain prose")
    keepsPrior(out?.pendingGuidance)
  })

  it("loop recovery redirect (loop-resolution.ts)", async () => {
    const r = await Effect.runPromise(resolveDetectedLoop({
      state: withFailedTool(base()), currentInput: makeKernelInput({ availableToolSchemas: [] }), currentOptions: options, loopMsg: "loop",
      failureRecoveryRedirects: 0, requiredToolNudgeCount: 0, maxFailureRecoveryRedirects: 2, maxRequiredToolNudges: 2, emitLog: noLog,
    }))
    expect(r.outcome).toBe("next")
    expect(r.state.pendingGuidance?.errorRecovery).toBeDefined()
    keepsPrior(r.state.pendingGuidance)
  })

  const stallArgs = (state: KernelState, missing: readonly string[]) => ({
    state, currentInput: makeKernelInput({ requiredTools: [...missing] }), currentOptions: options,
    missingRequiredByCount: missing, stallTriggered: true, totalArtifacts: 0, consecutiveStalled: 3,
    requiredToolNudgeCount: 0, failureRecoveryRedirects: 0, maxRequiredToolNudges: 3, maxFailureRecoveryRedirects: 2,
    verifier: defaultVerifier, emitLog: noLog,
  })

  it("stall required-tool nudge (stall-deliverable.ts)", async () => {
    const r = await Effect.runPromise(runStallDeliverableStep(stallArgs(base(), ["file-write"])))
    expect(r.outcome).toBe("next")
    expect(r.state.pendingGuidance?.requiredToolsPending).toEqual(["file-write"])
    keepsPrior(r.state.pendingGuidance)
  })

  it("stall recovery redirect (stall-deliverable.ts)", async () => {
    const r = await Effect.runPromise(runStallDeliverableStep(stallArgs(withFailedTool(base()), [])))
    expect(r.outcome).toBe("next")
    expect(r.state.pendingGuidance?.errorRecovery).toBeDefined()
    keepsPrior(r.state.pendingGuidance)
  })
})

describe("2. no 'call X' steer while tools are withheld", () => {
  it("ICS at strike 2 keeps the plain-text instruction and adds no call steer", async () => {
    const s0 = base({ iteration: 2, steps: [makeStep("thought", "{bad", UNRESOLVED_STEP_META)] })
    const struck = await Effect.runPromise(guardUnresolvedToolCall(s0, turn(s0), "{bad again"))
    expect(struck).not.toBeNull()
    expect(shouldWithholdTools(struck!)).toBe(true)
    const out = await Effect.runPromise(runIcsNudgeStep({
      state: struck!,
      currentInput: makeKernelInput({ requiredTools: ["web-search"] }),
      effectiveToolsUsed: new Set(),
      profile: CONTEXT_PROFILES.local,
      shouldAllowIcsNudge: true,
    }))
    expect(out.pendingGuidance?.icsGuidance).toBeUndefined()
    expect(out.pendingGuidance?.errorRecovery).toContain("Do NOT call a tool")
  })
})

// ── Runner-level (scripted LLM): what the next request actually carries ──────

const WEB_SEARCH = {
  name: "web-search",
  description: "Search the web",
  parameters: [{ name: "query", type: "string", description: "query", required: true }],
}

function run(scenario: Parameters<typeof TestLLMService>[0], requiredTools: string[] = []) {
  const inner = TestLLMService(scenario)
  const requests: { tools: number; wire: string }[] = []
  const llm = Layer.succeed(
    LLMService,
    LLMService.of({
      ...inner,
      stream: (request) => {
        requests.push({ tools: request.tools?.length ?? 0, wire: JSON.stringify(request.messages) })
        return inner.stream(request) as Effect.Effect<Stream.Stream<StreamEvent, LLMErrors>, LLMErrors>
      },
    }),
  )
  const tools = mockToolServiceLayer({
    execute: () => Effect.succeed({ success: true, result: { results: [{ title: "hit", content: "data" }] } }),
    getTool: (name: string) =>
      Effect.succeed({ name, description: "t", parameters: [{ name: "query", type: "string", required: true }] }),
  })
  const result = Effect.runPromise(
    provideTestEnvelope(
      executeReactive({
        taskDescription: "Find the population of Lyon.",
        taskType: "simple",
        memoryContext: "",
        availableTools: ["web-search"],
        requiredTools,
        availableToolSchemas: [WEB_SEARCH],
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(Layer.merge(llm, tools))),
    ),
  )
  return { requests, result }
}

const HIDDEN_NATIVE = { toolCall: { name: "file-read", args: { path: "notes.txt" } } }
/** A known tool printed as text with call text the parser cannot bind (two positionals, one required param). */
const UNPARSEABLE_KNOWN = { text: 'web-search(query="Lyon population", "2024")' }
const ANSWER = { text: "FINAL ANSWER: I could not look it up." }

describe("2b. runner: the tools-withheld request (strike 2, required tools)", () => {
  // In this scenario the stall required-tool nudge is the writer after the
  // strike-2 guard (ICS does not fire here; pin 2 covers the ICS gate). It used
  // to replace the record, dropping the unavailable-tool fact.
  test("the last-call fact survives the stall nudge, and no ICS call steer is sent", async () => {
    const { requests, result } = run([HIDDEN_NATIVE, HIDDEN_NATIVE, ANSWER], ["web-search"])
    await result
    expect(requests.length).toBeGreaterThanOrEqual(3)
    expect(requests[2]!.tools).toBe(0)
    // Neither ICS call steer (ics-coordinator.ts: "Now call X" / "Still required before finishing").
    expect(requests[2]!.wire).not.toContain("Now call")
    expect(requests[2]!.wire).not.toContain("Still required before finishing")
    expect(requests[2]!.wire).toContain("file-read is not enabled for this run")
    // Known residual (reported 2026-11-06, not fixed here): the stall
    // required-tool nudge writes the same kind (errorRecovery) after the
    // strike-2 guard, so it replaces the plain-text instruction on this request.
  })
})

describe("3. the resolver's reparse hint reaches the next request", () => {
  test("a known tool with unparseable call text: the next request says why and how to call it", async () => {
    const { requests, result } = run([UNPARSEABLE_KNOWN, ANSWER])
    await result
    expect(requests.length).toBeGreaterThanOrEqual(2)
    expect(requests[0]!.wire).not.toContain("could not be parsed")
    expect(requests[1]!.wire).toContain("Your tool call could not be parsed")
    expect(requests[1]!.wire).toContain("web-search(query)")
    expect(requests[1]!.tools).toBeGreaterThan(0)
  })

  test("lastCallNotRunHint: the resolver's appended text only, and the unavailable hint wins", () => {
    const raw = 'web-search(query="a", "b")'
    const resolved = `${raw}\n\nYour tool call could not be parsed: x. Call web-search(query) natively.`
    expect(lastCallNotRunHint({ shaped: true, unavailable: [], callable: [], resolved, raw })).toBe(
      "Your tool call could not be parsed: x. Call web-search(query) natively.",
    )
    // Nothing appended (an ordinary thought), or not a shaped turn: no hint.
    expect(lastCallNotRunHint({ shaped: true, unavailable: [], callable: [], resolved: raw, raw })).toBeUndefined()
    expect(lastCallNotRunHint({ shaped: false, unavailable: [], callable: [], resolved, raw })).toBeUndefined()
    // A blank reply: the whole resolved text is the hint.
    expect(lastCallNotRunHint({ shaped: true, unavailable: [], callable: [], resolved: "Hint only.", raw: "" })).toBe("Hint only.")
    // An off-surface name: the kernel's own unavailable-tool hint, not the resolver's.
    expect(
      lastCallNotRunHint({ shaped: true, unavailable: [{ name: "file-read", exists: true }], callable: [], resolved, raw }),
    ).toContain("file-read is not enabled for this run")
  })
})
