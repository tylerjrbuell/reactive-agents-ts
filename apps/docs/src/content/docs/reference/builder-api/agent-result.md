---
title: AgentResult and debrief
description: >-
  Reference for AgentResult: how to tell what happened, terminatedBy values, abstention rules, exhausted-run behavior and the AgentDebrief shape.
sidebar:
  order: 11
topic: config-reference
related:
  - reference/builder-api
  - features/process-model
  - guides/troubleshooting
---

What `run()` returns and how to read it. Part of the [builder reference](/reference/builder-api/).

## AgentResult

<!-- docs-skip-typecheck -->
```typescript
interface AgentResult {
    output: string // The agent's response
    success: boolean // Whether the task completed successfully
    taskId: string // Unique task identifier
    agentId: string // Agent that ran the task
    metadata: {
        duration: number // Execution time in milliseconds
        cost: number // Estimated cost in USD
        tokensUsed: number // Tokens of every LLM call up to the result (sub-agents included); excludes background debrief synthesis
        inputTokens?: number // Prompt tokens, same source as tokensUsed
        outputTokens?: number // Completion tokens, same source as tokensUsed
        llmCalls?: number // LLM calls up to the result (sub-agents included); excludes background debrief synthesis
        strategyUsed?: string // Reasoning strategy that finished the run (if reasoning enabled)
        strategySwitches?: { from: string; to: string; iteration?: number }[] // Every mid-run strategy switch, in order; absent when the run never switched
        iterations?: number // Kernel model turns, summed over every reasoning pass (a pass with no kernel counts 1)
        stepsCount: number // Reasoning steps recorded; thought, action and observation each count, so this exceeds iterations on tool runs
        confidence?: 'high' | 'medium' | 'low' // From final-answer tool
        // Honest-partial markers (present when the harness authored the shipped output)
        harnessAuthoredOutput?: boolean // true only when a non-empty output was assembled by the harness, not written by the model (for example a budget-stopped plan joining its completed steps). Absent on failed and abstained runs: their output is ""
        verificationWarning?: string    // the result-boundary verifier's note, when it flagged something
        verificationNote?: string       // withVerification({ onReject: "annotate" }): why the answer still failed verification; `output` is shipped unchanged
    }

    // Enriched fields (present when reasoning is enabled)
    format?: 'text' | 'json' | 'markdown' | 'csv' | 'html' // Output format declared by agent
    terminatedBy?:
        | 'final_answer_tool' // Exited via the final-answer tool call
        | 'final_answer'      // Exited via inline FINAL ANSWER: text
        | 'max_iterations'    // Hit the iteration/llmCalls ceiling
        | 'guard_stop'        // A harness guard (loop, stall, low progress) stopped a failed run before the cap
        | 'end_turn'          // LLM stopped generating (no tool call, no final answer)
        | 'llm_error'         // LLM request or stream failed (provider error, network, etc.)
        | 'abstained'         // Agent honestly declined — could not ground an answer (see abstention below)
    llmCalls?: number // Number of LLM calls made during the kernel loop (available when reasoning is enabled)

    // Honest-partial markers (on `metadata`, not top level)
    // See AgentResultMetadata in packages/runtime/src/builder/types.ts.

    // Abstention (present iff terminatedBy === 'abstained')
    abstention?: {
        reason: string    // Why the agent declined rather than fabricating
        missing: string[] // What was needed, e.g. "tool:web-search", a clarification
    }

    // Durable HITL (present when a run paused for human approval — see Durable HITL guide)
    status?: 'completed' | 'awaiting-approval' | 'awaiting-interaction' | 'failed' // defaults to 'completed' when absent
    pendingApproval?: {
        runId: string    // pass to approveRun(runId) / denyRun(runId, reason)
        gateId: string
        toolName: string // the gated tool call awaiting a decision
        args: unknown
    }
    // Agentic-UI interaction rail (present only when status === 'awaiting-interaction')
    pendingInteraction?: {
        runId: string
        interactionId: string
        kind: string
        prompt: string
        schema: unknown
    }

    // Debrief (present when .withMemory() + .withReasoning() are enabled)
    debrief?: AgentDebrief

    // Trust receipt — graded evidence about HOW the answer was produced (see The Process Model).
    // `receipt.deliverables[]` names each declared deliverable as produced or missing when the run's
    // compiled contract declared at least one concrete output (absent for pure Q&A runs).
    receipt?: TrustReceipt
}
```

`receipt.deliverables` is `{ spec: string; produced: boolean }[]` — a partial
multi-file run lists exactly which outputs never landed (`produced: false`)
instead of claiming success. The full receipt shape, verdicts, and optional
Ed25519 signing are documented in [The Process Model](/features/process-model/).

### How to tell what happened: the decision procedure

`AgentResult` carries overlapping outcome fields, and reading them in the wrong
order leads to the wrong conclusion. Branch in this order. Every step cites the
source it was verified against (`packages/runtime/src/reactive-agent.ts`,
`packages/runtime/src/builder/types.ts`, `packages/runtime/src/builder/helpers.ts`,
`packages/core/src/types/result.ts`, `packages/core/src/types/receipt.ts`).

0. **Did `run()` reject at all?** `agent.run()` *returns a result* for nearly
   every failure mode. It throws only for run-boundary events:
   - **Interruption** — `agent.terminate()`, or a kill-switch aborting the run
     fiber (`.withKillSwitch()`), rejects with a kill-switch error
     (`reactive-agent.ts` — the `runSignal?.aborted` branch of the `execute().catch`).
   - **The bare-builder asymmetry** — when reasoning was **not** enabled (no
     `.withReasoning()`, no declarative `reasoning` config — what the code calls
     a *bare builder*), a provider fault (`terminatedBy: "llm_error"`) or an
     iteration-cap or guard stop (`terminatedBy: "max_iterations"` /
     `"guard_stop"`) **re-throws an
     `ExecutionError` instead of returning a result**
     (`reactive-agent.ts` — `BARE_BUILDER_THROWS_ON`). The *same two faults on a
     builder with reasoning enabled* come back as a graceful result
     (`success: false`, `status: "failed"`) — that is the kernel's tested
     contract (`reactive-agent.ts` — the B1 comment above the throw). Every
     *other* `success: false` outcome — abstention, fabrication-guard rejection,
     empty output with no verified deliverable — returns a result on **both**
     builder kinds and never throws (`reactive-agent.ts` — the deliberate
     "NOT extended to every success:false reason" note).
   - **Any other engine rejection** is unwrapped, fed to `.withErrorHandler()`
     if registered, and re-thrown as a run-boundary error
     (`reactive-agent.ts` — the tail of the `execute().catch`).
   - **The rejection type** is `AgentRunError` (exported from
     `reactive-agents`), a one-line message such as a provider 401. Left
     uncaught it prints as that one line; the full error, with its remediation
     hint, is on `err.cause`. `RA_DEBUG_ERRORS=1` rejects with the full error
     and stack instead.

   Unifying the bare-builder throw contract with the result-returning contract
   is **deferred to a future breaking release**. Until then this asymmetry is
   the real behavior: wrap `run()` in `try/catch` whenever the builder might be
   bare.

1. **`result.status`** — lifecycle first. `"awaiting-approval"` → the run
   paused at an approval gate; `pendingApproval` carries the `runId` for
   `approveRun()` / `denyRun()` (or pass `onApproval` to `run()` and the
   pause→decide→resume loop is driven for you — `reactive-agent.ts`).
   `"awaiting-interaction"` → `pendingInteraction` + `respondToInteraction()`.
   `"failed"` → graceful failure; go to step 2. `"completed"` or absent →
   normal path.
   **Shortcut:** `result.outcome` (`"success"` | `"partial"` | `"failed"` |
   `"abstained"`) folds steps 2–5 into one readout. `"abstained"` is an
   honest decline, not a failure. Failed and abstained runs ship `output: ""`
   with the cause on `result.error`; the harness never writes the answer.
2. **`result.success`** — whether the run terminated with an accepted outcome.
   `false` is *not* an exception: read `result.error` (message) and
   `result.terminatedBy` (cause) off the result itself.
3. **`result.terminatedBy`** — how the loop ended: `final_answer_tool` |
   `final_answer` | `max_iterations` | `guard_stop` | `end_turn` | `llm_error` | `abstained`
   (`packages/core/src/types/result.ts` — the `TerminatedBy` literal).
4. **`result.goalAchieved`** — the semantic readout, distinct from `success`:
   `true` = a final answer was delivered; `false` = exhausted / errored /
   abstained; `null` = ambiguous (`end_turn` — the model stopped its turn
   without signaling completion; treat as "maybe") (`builder/types.ts`).
   Declared deliverables then override the heuristic deterministically: any
   declared deliverable missing → `false`; all produced → a `null` upgrades to
   `true`; an explicit `false` is never upgraded (`builder/helpers.ts`).
5. **`result.abstention`** — present iff `terminatedBy === "abstained"`: the
   agent honestly declined, with `reason` and the `missing` list (`builder/types.ts`).
6. **`result.receipt?.verdict`** — an evidence *grade* for HOW the answer was
   produced: `"tool-grounded"` | `"partially-grounded"` | `"ungrounded"` |
   `"abstained"` | `"failed"` (`packages/core/src/types/receipt.ts`). It grades
   the run's evidence trail, **not** the factual correctness of `output` — not
   a truth certificate (`builder/types.ts`).
7. **`result.metadata.harnessAuthoredOutput` / `result.metadata.verificationWarning`**
   — honest-partial markers, on `metadata` (not top level): `true` only when a
   non-empty shipped output was assembled by the harness rather than written
   by the model (never on a failed run's empty output), plus the
   result-boundary verifier's note when it flagged unmet requirements
   (`builder/types.ts` — `AgentResultMetadata`).

```typescript
// Ordered interpretation — mirrors the numbered steps above.
try {
    const result = await agent.run("Summarize the current price of BTC")

    if (result.status === "awaiting-approval" && result.pendingApproval) {
        // paused, not finished — approveRun(runId) / denyRun(runId, reason)
    } else if (result.status === "awaiting-interaction" && result.pendingInteraction) {
        // paused on the interaction rail — respondToInteraction(...)
    } else if (!result.success) {
        console.log(result.terminatedBy, result.error) // why it failed
    } else {
        console.log(result.output)
        console.log(result.goalAchieved)               // true / false / null
        console.log(result.receipt?.verdict)           // evidence grade
        console.log(result.metadata.harnessAuthoredOutput) // honest-partial marker (usually absent)
    }
} catch {
    // Only: terminate()/kill-switch interruption, or a BARE builder (no
    // .withReasoning()) hitting llm_error / max_iterations / guard_stop.
}
```

Quick recipe: **status → success → terminatedBy → goalAchieved → receipt.verdict.**
Everything else is annotation.

### Abstention (`terminatedBy: "abstained"`)

When grounding an answer is structurally impossible — a declared required tool is
absent from the registered tool set, or synthesis was repeatedly rejected as
ungrounded — the harness **forces an honest `abstained` terminal** instead of
grinding to `max_iterations` or letting fabrication through. A genuine
deliverable is never overridden. When this happens, `result.terminatedBy` is
`"abstained"` and `result.abstention` carries the reason plus what was missing:

```typescript
const result = await agent.run('Summarize the current HN front page')
if (result.terminatedBy === 'abstained') {
    console.log(result.abstention?.reason)  // "required tool unavailable; could not ground an answer"
    console.log(result.abstention?.missing) // ["tool:web-search"]
}
```

`goalAchieved` is `false` for abstained runs (honest non-achievement). This
run-level surface is distinct from the per-field structured-output `abstained`
map (`.withOutputSchema({ abstainBelow })`) — the two are unrelated and may coexist.

### Failed runs ship an empty `output` and the cause on `error`

A run that stops after effort (the iteration or tool budget is exhausted, or its
terminal answer is rejected) without producing a verified answer ships
`output: ""`. The harness never writes an answer for a failed run. `success` is
`false`, and the cause is on `result.error`, followed by a deterministic
`What was attempted: ...` line when the kernel recorded it (no extra LLM call):

```typescript
const result = await agent.run('Fetch the live ZZZ-token price and summarize it')
if (!result.success) {
    console.log(result.output) // ""
    console.log(result.error)
    // "<cause> What was attempted: 3 tool call(s) attempted (web-search), 0 succeeded."
}
```

Show `result.error`, not `result.output`, for a failed run. The exceptions keep
the model's own text: a partial run returns the model's draft as `output` with
the outstanding items on `error`, and a model's own give-up text still ships as
`output`. An exhausted run reports `terminatedBy` as its real reason
(`max_iterations`, `end_turn`, …) and `outcome: "failed"`, not `"abstained"`.
`error` is the real cause for provider faults too (`terminatedBy: "llm_error"`),
never the model's last sentence.

### Give-up answers become abstentions, not success

When the model ends by declining (an apology, or an incapability statement such
as "the available tools do not support this action") and the run grounded
nothing (no successful non-meta tool call), the harness reports an honest
`abstained` rather than `success: true`. The model's own explanation is kept as
`result.output`, and `result.abstention.reason` carries it. This closes the case
where a stuck run ended via loop detection / exhaustion and shipped its give-up
text as a success. A run that DID gather evidence (any successful data tool) is
never downgraded, so a terse answer backed by real work still succeeds.

```typescript
const result = await agent.run('Send a Slack message to #general')
if (result.terminatedBy === 'abstained') {
    console.log(result.output) // "The available tools do not include a function for Slack."
    console.log(result.success) // false
}
```

### `AgentDebrief`

A structured post-run synthesis produced automatically when memory is enabled:

```typescript
interface AgentDebrief {
    outcome: 'success' | 'partial' | 'failed'
    summary: string // 2-3 sentence narrative
    keyFindings: string[]
    errorsEncountered: string[]
    lessonsLearned: string[] // Auto-fed to ExperienceStore
    confidence: 'high' | 'medium' | 'low'
    caveats?: string
    toolsUsed: { name: string; calls: number; successRate: number }[]
    metrics: {
        tokens: number
        duration: number
        iterations: number
        cost: number
    }
    markdown: string // Pre-rendered Markdown version
}
```

Access it from any run result:

```typescript
const result = await agent.run('Fetch the latest commits and summarize')

// result.debrief — instant deterministic fallback (never blocks run()).
if (result.debrief) {
    console.log(result.debrief.summary)
    console.log(result.debrief.markdown)
}

// result.debriefRich() — awaits the LLM-synthesized rich debrief, which the
// engine forks off the critical path (v0.12.0+). Returns undefined when no
// debrief was scheduled (e.g. .withoutMemory()).
const rich = await result.debriefRich?.()
console.log(rich?.markdown)
```
