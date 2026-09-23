---
title: Judgment Layer
stability: experimental
description: >-
    Calibrated typed judgments (Choice/Score/Noul) via @reactive-agents/judgment
    — a provider-abstracted primitive for programmable common sense.
sidebar:
    order: 25
---

The judgment layer gives your agent a typed, calibrated primitive for the kind of question that isn't a fact lookup or a classical computation, but also shouldn't be a free-form LLM completion: "is this risky?", "which of these five options fits best?", "how complete is this answer, on a 0-2 scale?" Instead of parsing a probability out of generated text, a judgment call returns a typed answer with real probabilities attached.

## Runtime tier: `.withJudgment()`

Enable it once on the builder, then call `agent.judge()` directly from your own code, outside any run:

```typescript
import { ReactiveAgents } from 'reactive-agents'

const agent = await ReactiveAgents.create()
    .withProvider('anthropic')
    .withJudgment() // backend auto-selects: "jev" if TYPESAFE_API_KEY is set, else "llm"
    .build()

const { risky } = await agent.judge({
    state: { action: 'delete all files in /tmp' },
    questions: {
        risky: { type: 'noul', instructions: 'Is this action destructive?' },
    },
})

if (risky.kind === 'noul' && risky.probability > 0.7) {
    // escalate, ask for confirmation, etc.
}
```

Calling `agent.judge()` without `.withJudgment()` throws immediately — an unconfigured judgment call is a caller mistake, not a silent no-op.

`agent.judge()`'s input type is exported as `JudgeInput<Q>` (from `reactive-agents` / `@reactive-agents/runtime`) if you want to name the shape of the argument object yourself — a discriminated union on `includeContext` so `state` is only optional when `includeContext: true` supplies it automatically:

```typescript
import type { JudgeInput } from 'reactive-agents'
import type { QuestionSpecs } from '@reactive-agents/judgment'

function buildJudgeCall<Q extends QuestionSpecs>(questions: Q): JudgeInput<Q> {
    return { state: { checked: true }, questions }
}
```

### Backends

| Backend | Requires                                                                        | Calibration                                                                                                                           |
| ------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `jev`   | A TypeSafe API key (`TYPESAFE_API_KEY` env var, or `.withJudgment({ apiKey })`) | Real calibrated probabilities from TypeSafe's System One model                                                                        |
| `llm`   | Nothing beyond your existing provider                                           | Self-reported estimate from your LLM — `calibrated: false` on every answer, so gate on that flag if calibration matters to your logic |

Backend selection is automatic (`jev` when a key resolves, `llm` otherwise) unless you set `.withJudgment({ backend: "jev" | "llm" })` explicitly.

### Auto-context: `includeContext`

By default, `judge()` only sees the `state` you pass it. `includeContext` folds the agent's own
recent context in automatically — useful for judgments like "did this response actually answer
the question" that need the surrounding turn, not just a hand-picked field. It has two forms:

-   **`includeContext: true`** — every layer, with its defaults: recent chat history (40-turn
    window), recent tool observations, and the full reasoning-step trace (thoughts, actions,
    observations — not just tool results) from the agent's last `run()`.
-   **`includeContext: { ... }`** — an object naming only the layers you want. A layer absent from
    the object stays **off** — the object form is exclusive opt-in, not additive defaults:

```typescript
export interface JudgeContextConfig {
    readonly messages?: boolean | { readonly window?: number }
    readonly toolResults?: boolean
    readonly reasoningSteps?: boolean | { readonly window?: number; readonly types?: readonly StepType[] }
}
```

```typescript
// Before: manually re-thread the last tool result yourself
const { grounded } = await agent.judge({
    state: { claim: answer, evidence: lastToolResult },
    questions: { grounded: { type: 'noul', instructions: 'Is the claim supported by the evidence?' } },
})

// After: let judge() pull the whole recent context automatically
const { grounded } = await agent.judge({
    questions: { grounded: { type: 'noul', instructions: 'Is the claim supported by the evidence?' } },
    includeContext: true, // messages + toolResults + reasoningSteps, each with its default window
})

// Or opt into just the reasoning trace — thoughts/actions included, not only tool observations
const { grounded } = await agent.judge({
    questions: { grounded: { type: 'noul', instructions: 'Did the agent ground its answer with a valid tool call?' } },
    includeContext: { reasoningSteps: true },
})

// Tune the window and step types on any layer that takes one — a small
// window keeps the prompt cheap; a narrower type list drops noise (e.g.
// "action" without matching "observation" pairs) when only one kind of
// step matters to the question
const { onTrack } = await agent.judge({
    questions: { onTrack: { type: 'noul', instructions: 'Is the agent making progress toward the task?' } },
    includeContext: {
        messages: { window: 10 },
        reasoningSteps: { window: 8, types: ['thought', 'observation'] },
    },
})
```

`window` caps how many turns/steps are folded in (most-recent-first); `reasoningSteps.types` restricts
which `StepType`s (`thought` | `action` | `observation` | `plan` | `reflection` | `critique`) are
included — omit it and every type present is folded in. Manually-passed `state` fields always win on
collision — `includeContext` only fills gaps, it never overwrites a field you set explicitly.

### Listing available models

Query the backend's available model list via `agent.listJudgmentModels()`:

```typescript
const models = await agent.listJudgmentModels();
models.forEach(m => {
    console.log(`${m.name}: ${m.description} (released ${m.releaseDate})`);
});
```

This returns an array of `JudgmentModel` objects (name, description, releaseDate). Calling `agent.listJudgmentModels()` without `.withJudgment()` throws immediately — the same contract as `agent.judge()`. The name is deliberately scoped — this lists the *judgment backend's* models (TypeSafe/Jev), not the LLM provider models `.withModel()` selects from.

**Backends:**
- **`jev`** backend: returns the live model catalog from TypeSafe's API
- **`llm`** backend: rejects with a `JudgmentUnsupported` failure (no catalog endpoint available) —
  **not** a bare `JudgmentUnsupported` instance you can `instanceof`-check. `agent.listJudgmentModels()`'s
  Promise is backed by `ManagedRuntime.runPromise()`, which rejects with a `FiberFailure` wrapper
  around the tagged error, so `error instanceof JudgmentUnsupported` is `false` on the real
  rejection. Match on the rejection's `message` instead — it names the missing catalog
  (`Backend "llm" has no model catalog`).

If you're holding a `JudgmentService` directly (not via the agent facade) and run the Effect
yourself, the same `FiberFailure`-wrapping applies — `Effect.runPromise()` (not just
`ManagedRuntime.runPromise()`) rejects with a `FiberFailure` around any tagged failure, so
`instanceof JudgmentUnsupported` is still `false` on the rejection. Use `Effect.runPromiseExit()`
(or catch the failure inside the Effect with `Effect.catchTag`/`Effect.catchAll` before running it)
if you need the real, un-wrapped `JudgmentUnsupported` instance:

```typescript
import { Effect } from "effect";
import { JudgmentService } from "@reactive-agents/judgment";
// `layer` is your own `JudgmentService` layer, however you constructed it
// (e.g. `makeJudgmentServiceLive(makeJevBackend({ apiKey }))`).

const models = await Effect.runPromise(
    Effect.gen(function* () {
        const service = yield* JudgmentService;
        return yield* service.listModels();
    }).pipe(Effect.provide(layer))
);
```

### Re-ranking candidates: `judgeRank()`

Hand-rolling a re-rank loop (`Promise.all(candidates.map(c => agent.judge(...)))`) fires one
round trip **per candidate**. `agent.judgeRank()` batches every candidate's Score question into
as few `ask()` calls as possible instead:

```typescript
const ranked = await agent.judgeRank(
    drafts.map((text, i) => ({ id: String(i), state: { text } })),
    {
        instructions: "How well does this draft answer the user's question?",
        criteria: ['poor', 'weak', 'adequate', 'strong', 'excellent'],
    },
)

const best = drafts[Number(ranked[0].id)]
```

`agent.judgeRank(candidates, question, opts?)`:

-   **`candidates`** — `{ id: string; state: JudgmentEntry }[]`. `id` is your own identifier, returned unchanged.
-   **`question`** — one shared `{ instructions, criteria }` Score question every candidate is judged against.
-   **`opts.chunkCap`** — max candidates per `ask()` call (default `30`). Candidate sets larger than `chunkCap`
    are split into multiple `ask()` calls, in candidate order, never re-shuffled.
-   **`opts.model`** — override the backend model for this call.
-   **Returns** `Promise<ReadonlyArray<{ id: string; score: number; confidence: number }>>`, sorted
    best-first (highest `score` first; ties keep original relative order).

**The returned array may be shorter than `candidates`.** A candidate whose answer doesn't come back
as a Score answer (backend misbehavior — a non-conforming custom `JudgmentBackend`) is silently
dropped rather than surfaced as a partial-failure marker, so every other candidate in the batch can
still be ranked. If you need to detect drops, diff the returned `id`s against your own candidate
list. Like `judge()` and `listJudgmentModels()`, calling `judgeRank()` without `.withJudgment()` throws
immediately.

See the [judgment cookbook's re-ranking recipe](/cookbook/judgment-recipes/#re-ranking-candidates)
for the full worked example.

## The three primitives

| Primitive  | Shape                                                                      | Use when                                                          |
| ---------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Noul**   | One probability, no separate confidence                                    | Judging whether a single condition holds ("is this toxic?")       |
| **Choice** | One value from a named set, plus a probability distribution and confidence | Selecting between mutually exclusive options                      |
| **Score**  | A position on an ordered rubric (may fall between levels), plus confidence | Rating a graded dimension ("how complete is this response, 0–2?") |

Ask several independent questions over the same state in **one batched request** — they run in parallel and can't see each other's answers, which is both faster and (for the `jev` backend) cheaper than one call per question.

## Internal harness sites (opt-in, per-site)

Beyond the public `agent.judge()` primitive, several internal decision points can optionally route through the same judgment layer instead of (or alongside) their existing regex/heuristic logic. Every site below is either:

-   **shadow-only** — the judgment answer is computed and compared against the existing decision for later analysis, but never changes what the agent actually does, or
-   **additive** — the judgment answer can only add a signal on top of what already passes, never remove one (unless an explicit stricter opt-in says otherwise).

| Site                         | Package              | Mode                                                    | Enable via                                                                      |
| ---------------------------- | -------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Strategy selection           | `reasoning`          | shadow                                                  | `.withJudgment()` alone — fires automatically once wired                        |
| Complexity routing           | `cost`               | shadow                                                  | `.withJudgment()` alone                                                         |
| Task comprehension           | `reasoning` (kernel) | shadow                                                  | `.withJudgment()` alone                                                         |
| Guardrails battery           | `guardrails`         | additive (default) / opt-in `jev-primary`               | `.withGuardrails({ enableJudgmentBattery: true })`                              |
| Autonomy/approval confidence | `interaction`        | shadow only (no invert path yet — highest blast radius) | `.withJudgment()` alone                                                         |
| Tool-call healing            | `tools`              | additive escalation                                     | not yet wired into the kernel's tool-execution path — library-level export only |
| Completion/termination check | `reasoning` (kernel) | shadow                                                  | `.withJudgment()` alone — fires on every terminal verification pass             |
| Grounding/fabrication check  | `reasoning` (kernel) | shadow (1 of 6 deliverable-assembly call sites wired)   | `.withJudgment()` alone                                                         |

Every site degrades cleanly to its existing behavior when `JudgmentService` is absent, when the backend errors or times out, or when an answer doesn't clear its confidence floor. An agent that never calls `.withJudgment()` behaves byte-for-byte as it did before this feature existed.

### Guardrails judgment battery

The most immediately useful opt-in site. Runs a batched judgment (prompt-injection, PII exposure, toxicity, jailbreak-roleplay, plus an overall severity score) parallel to the existing regex detectors:

```typescript
const agent = await ReactiveAgents.create()
    .withProvider('anthropic')
    .withJudgment()
    .withGuardrails({
        enableJudgmentBattery: true,
        judgmentStrictness: 'additive', // default: only adds/escalates, never unblocks a regex hit
        // judgmentStrictness: "jev-primary" — explicit opt-in: the battery's verdict
        // is authoritative per violation type and CAN unblock a regex false-positive.
        screenOutputs: true, // observability-only battery pass over replies too
    })
    .build()
```

With the default `"additive"` strictness, enabling the battery can never cause an input that passes today to start being blocked — it can only catch things the regex table misses (a paraphrased injection attempt, for example) or escalate a regex hit's severity when the battery agrees.

## Observability

Every judgment call emits `JudgmentEvaluated` (success) or `JudgmentFailed` (error) on the `EventBus`, tagged with a `site` name and the backend that answered. Shadow sites additionally emit `JudgmentShadow` events carrying the judgment's answer, the existing decision, an agreement verdict, and the answer's own `confidence` (`null` for Noul questions, which have no separate confidence value) — enough to bucket "high-confidence disagreement" (a real gap worth investigating) from "low-confidence disagreement" (noise) directly from event data, without re-running a fresh measurement each time.

## Design notes

-   **Backend-agnostic by design.** Nothing in this layer, or in any of its consumers, hardcodes a vendor name onto a field or an internal variable — `JudgmentBackend` is the only interface a provider implements, so a future open-source System One model is a drop-in with zero consumer change.
-   **Calibration ≠ truth.** A judgment answer's `confidence` reflects the backend's own distribution concentration, not whether the answer is _correct_ for your domain. Validate performance against your own data before trusting a threshold in production.
-   **Shadow sites are not yet inverted.** Strategy selection, complexity routing, task comprehension, and autonomy confidence all currently run in shadow mode only — they compute and compare, but the existing heuristic/LLM path still decides. Inverting a shadow site into an active decision is a separate, evidence-gated follow-up per site.
