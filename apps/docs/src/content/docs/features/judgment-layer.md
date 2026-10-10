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

| Backend  | Requires                                                                        | Calibration                                                                                                                            |
| -------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `jev`    | A TypeSafe API key (`TYPESAFE_API_KEY` env var, or `.withJudgment({ apiKey })`) | Real calibrated probabilities from TypeSafe's System One model                                                                         |
| `llm`    | Nothing beyond your existing provider                                           | Self-reported estimate from your LLM ( `calibrated: false` on every answer, so gate on that flag if calibration matters to your logic ) |
| `ollama` | A local Ollama server with the decision model pulled                            | Real calibrated probabilities from Ollama's System One decision model, served locally with no API key                                  |

Backend selection is automatic (`jev` when a key resolves, `llm` otherwise) unless you set `.withJudgment({ backend: "jev" | "llm" | "ollama" })` explicitly.

### Local & private judgment (Ollama)

The `ollama` backend points the judgment primitive at a local Ollama server's
System One decision API. No API key, no outbound network beyond the server
itself, and the same calibrated distributions the `jev` backend returns.

Prerequisite: pull the decision model once per machine.

```bash
ollama pull nimble
```

```typescript
const agent = await ReactiveAgents.create()
    .withProvider('anthropic')
    .withJudgment({ backend: 'ollama' })
    .build()

const { risky } = await agent.judge({
    state: { action: 'delete all files in /tmp' },
    questions: {
        risky: { type: 'noul', instructions: 'Is this action destructive?' },
    },
})
```

The endpoint resolves from `baseUrl`, then `OLLAMA_ENDPOINT`, `OLLAMA_HOST`,
`OLLAMA_BASE`, and finally `http://localhost:11434`. The first call after idle
can take tens of seconds while the model cold-loads; the backend's default
timeout is 30 seconds. Keep the model warm between calls with the builder's
`keepAlive` option (for example `'10m'`, or `0` to unload after each request):

```typescript
const agent = await ReactiveAgents.create()
    .withProvider('anthropic')
    .withJudgment({ backend: 'ollama', ollama: { keepAlive: '10m' } })
    .build()
```

A missing model surfaces as a `JudgmentBadResponse` whose message names the
model and the `ollama pull` command to run. Passing `images` to a text-only
model (or to the `jev`/`llm` backends) fails loudly with `JudgmentUnsupported`
rather than being dropped.

#### Decision models

The default model is `nimble`. Two Cloudflare models are System One-compatible
and vision-capable, and `tev` is another text option:

```typescript
const visionAgent = await ReactiveAgents.create()
    .withProvider('anthropic')
    .withJudgment({ backend: 'ollama', model: 'clef' }) // 27B vision model
    .build()

const flashAgent = await ReactiveAgents.create()
    .withProvider('anthropic')
    .withJudgment({ backend: 'ollama', model: 'clef-flash' }) // 9B vision model
    .build()

const textAgent = await ReactiveAgents.create()
    .withProvider('anthropic')
    .withJudgment({ backend: 'ollama', model: 'tev' }) // text
    .build()
```

Vision models unlock the optional `images` channel on `agent.judge()`: an
ordered array of base64-encoded PNG/JPEG/WebP strings, passed through verbatim
(no URL or data-URL resolution) and scored together with `state`. The request
body is capped at 32 MiB with images (64 KiB without). A vision model is
required; sending images to a text-only model is a server-side error.

```typescript
const base64Png = "<base64-encoded PNG screenshot>";

const { passes } = await agent.judge({
    state: { task: 'Check the checkout page for layout breakage' },
    questions: {
        passes: { type: 'noul', instructions: 'Is the page visually broken?' },
    },
    images: [base64Png],
})
```

#### Backend capabilities

Every backend declares a `JudgmentCapabilities` object describing what it can
do, and consumers adapt automatically:

| Field               | Meaning                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `maxQuestions`      | Max questions per `ask()` call (omitted means unbounded)                                         |
| `supportedKinds`    | Question kinds the backend answers (`noul` / `choice` / `score`)                                  |
| `distributions`     | True when answers carry a real per-candidate distribution                                        |
| `calibrated`        | True when `confidence` is distribution-derived (false means model self-report)                    |
| `images`            | True when the backend accepts the optional `images` channel                                       |
| `modelCatalog`      | True when `listModels()` resolves a real catalog                                                 |

`judgeRank()` and the comprehension chunker clamp their batch sizes to
`maxQuestions` instead of a hardcoded constant, so a backend with a tighter
ceiling degrades into correct chunking rather than a hard error. Read the
resolved capabilities of a `JudgmentService` with `capabilitiesOf(service)`
(exported from `@reactive-agents/judgment` and re-exported from
`reactive-agents`); a service that predates the field gets safe defaults.

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
import type { StepType } from '@reactive-agents/reasoning'

export interface JudgeContextConfig {
    readonly messages?: boolean | { readonly window?: number }
    readonly toolResults?: boolean
    readonly reasoningSteps?: boolean | { readonly window?: number; readonly types?: readonly StepType[] }
}
```

```typescript
const answer = "Use `slice.binary_search()` from the standard library.";
const lastToolResult = "stdlib docs for `slice.binary_search()`.";

// Before: manually re-thread the last tool result yourself
const { grounded } = await agent.judge({
    state: { claim: answer, evidence: lastToolResult },
    questions: { grounded: { type: 'noul', instructions: 'Is the claim supported by the evidence?' } },
})
```

```typescript
// After: let judge() pull the whole recent context automatically
const { grounded } = await agent.judge({
    questions: { grounded: { type: 'noul', instructions: 'Is the claim supported by the evidence?' } },
    includeContext: true, // messages + toolResults + reasoningSteps, each with its default window
})
```

```typescript
// Or opt into just the reasoning trace — thoughts/actions included, not only tool observations
const { grounded } = await agent.judge({
    questions: { grounded: { type: 'noul', instructions: 'Did the agent ground its answer with a valid tool call?' } },
    includeContext: { reasoningSteps: true },
})
```

```typescript
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
import { JudgmentService, makeJevBackend, makeJudgmentServiceLive } from "@reactive-agents/judgment";
// `layer` is your own `JudgmentService` layer, however you constructed it
// (e.g. `makeJudgmentServiceLive(makeJevBackend())`).
const layer = makeJudgmentServiceLive(makeJevBackend());

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
const drafts = [
    "Restart the server and try again.",
    "Check the server logs for the connection error, then restart.",
];

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

## The three question types

The judgment layer supports three typed question primitives. Each has a specific spec shape, answer shape, and use case. All three can be batched in a single `agent.judge()` call.

### Noul — Yes/No with Probability

**Use when:** You need a calibrated probability for a single binary condition. "Is this risky?", "Does this violate policy?", "Should this be escalated?"

**Spec shape:**

```typescript
import type { JudgmentEntry } from '@reactive-agents/judgment'

interface NoulSpec {
  readonly type: "noul";
  readonly instructions?: JudgmentEntry;        // Question text
  readonly criteria?: {
    readonly true?: JudgmentEntry;              // What "true" means (optional)
    readonly false?: JudgmentEntry;             // What "false" means (optional)
  };
}
```

- `instructions` — The question to answer. Can be a string, object, array, or `null`.
- `criteria.true` / `criteria.false` — Optional descriptions that disambiguate the two outcomes for the model. Omit if the question is self-explanatory.

**Answer shape:**

```typescript
interface NoulAnswer {
  readonly kind: "noul";
  readonly probability: number;  // P(true) in [0, 1]
}
```

- No separate `confidence` field — the probability *is* the measure.
- `probability > 0.5` means "likely true"; `probability < 0.5` means "likely false".
- Calibrated backends (`jev`, `ollama`) return a true probability. The `llm` backend returns a self-reported estimate with `calibrated: false` on Choice/Score answers (Noul has no calibrated flag).

**Example:**

```typescript
async function requestHumanApproval(): Promise<void> {
    // page a human reviewer
}

const { risky, pii, needsReview } = await agent.judge({
  state: { action: "rm -rf /tmp/*", user: "ci-bot" },
  questions: {
    risky: {
      type: "noul",
      instructions: "Is this action destructive or irreversible?",
      criteria: {
        true: "Deletes data, modifies system state, or cannot be undone",
        false: "Read-only, reversible, or confined to a sandbox",
      },
    },
    pii: {
      type: "noul",
      instructions: "Does the input contain personally identifiable information?",
    },
    needsReview: {
      type: "noul",
      instructions: "Should a human approve this before execution?",
    },
  },
});

if (risky.probability > 0.8 || pii.probability > 0.5) {
  await requestHumanApproval();
}
```

---

### Choice — Select from Named Options

**Use when:** You need to pick exactly one option from a mutually exclusive set. "Which category?", "What intent?", "Which tool should handle this?"

**Spec shape:**

```typescript
import type { JudgmentEntry } from '@reactive-agents/judgment'

interface ChoiceSpec {
  readonly type: "choice";
  readonly instructions?: JudgmentEntry;        // Question text
  readonly criteria: Record<string, JudgmentEntry>;  // optionLabel -> description
}
```

- `criteria` — An object mapping each option label to its description. TypeSafe caps this at 255 options; practical limits are lower (see `maxQuestions` in backend capabilities).
- Labels are arbitrary strings — use descriptive names the model will understand.
- Descriptions can be strings, objects, arrays, or `null`. `null` leaves a label undescribed.

**Answer shape:**

```typescript
interface ChoiceAnswer {
  readonly kind: "choice";
  readonly value: string;                       // Selected option label
  readonly probabilities: Record<string, number>; // Per-option probabilities (sum ≈ 1)
  readonly confidence: number;                  // Distribution concentration [0, 1]
  readonly calibrated: boolean;                 // True for jev/ollama, false for llm
}
```

- `value` — The selected option label (one of the keys from `criteria`).
- `probabilities` — Full distribution over all options. Useful for detecting ambiguity (flat distribution = uncertain).
- `confidence` — How concentrated the distribution is. 1.0 = all mass on one option. Lower = more spread.
- `calibrated` — Gate on this if you need real probabilities vs. self-reported estimates.

**Example:**

```typescript
const { category, urgency, language } = await agent.judge({
  state: { message: "My production database is down and I can't connect!" },
  questions: {
    category: {
      type: "choice",
      instructions: "What type of issue is this?",
      criteria: {
        bug: "A defect or regression in existing functionality",
        feature: "Request for new functionality",
        question: "How-to or clarification question",
        incident: "Production outage or degradation",
      },
    },
    urgency: {
      type: "choice",
      instructions: "How urgently does this need a response?",
      criteria: {
        critical: "Active outage, data loss, or security breach",
        high: "Blocking work, major feature broken",
        normal: "Standard priority, can wait for next sprint",
        low: "Nice-to-have, no deadline",
      },
    },
    language: {
      type: "choice",
      instructions: "What programming language is the user asking about?",
      criteria: {
        typescript: "TypeScript or JavaScript",
        python: "Python",
        rust: "Rust",
        go: "Go",
        other: "Any other language",
      },
    },
  },
});

console.log(category.value);        // "incident"
console.log(category.confidence);   // 0.94
console.log(urgency.probabilities); // { critical: 0.87, high: 0.11, normal: 0.02, low: 0.0 }
```

---

### Score — Rate on an Ordered Rubric

**Use when:** You need a graded assessment on a continuous scale. "How complete is this answer?", "Rate quality 0–5", "How confident are you?"

**Spec shape:**

```typescript
import type { JudgmentEntry } from '@reactive-agents/judgment'

interface ScoreSpec {
  readonly type: "score";
  readonly instructions?: JudgmentEntry;        // Question text
  readonly criteria: readonly JudgmentEntry[];  // Level descriptions, index = score
}
```

- `criteria` — A tuple/array of **at least 2, at most 10** level descriptions (TypeSafe limit). Index 0 = lowest score, last index = highest score.
- Each entry can be a string, object, array, or `null`.
- The model can return a score *between* integer levels (e.g., 2.3 on a 0–4 rubric).

**Answer shape:**

```typescript
interface ScoreAnswer {
  readonly kind: "score";
  readonly value: number;                       // Expected score (may be fractional)
  readonly probabilities: Record<string, number>; // Distribution over integer levels
  readonly confidence: number;                  // Distribution concentration [0, 1]
  readonly calibrated: boolean;                 // True for jev/ollama, false for llm
}
```

- `value` — The expected score (float). Not clamped to integer levels.
- `probabilities` — Distribution over the integer levels (keys are stringified indices: "0", "1", "2"...).
- `confidence` — Concentration of the distribution. Higher = more certain.
- `calibrated` — Same meaning as Choice.

**Example:**

```typescript
const { completeness, accuracy, tone } = await agent.judge({
  state: {
    question: "How do I implement a binary search in Rust?",
    answer: "Use `slice.binary_search()` from the standard library...",
  },
  questions: {
    completeness: {
      type: "score",
      instructions: "How completely does this answer address the question?",
      criteria: [
        "Does not answer the question at all",
        "Addresses part of the question, major gaps remain",
        "Addresses most of the question, minor gaps",
        "Fully answers the question with appropriate detail",
        "Exceeds expectations with examples, edge cases, and context",
      ],
    },
    accuracy: {
      type: "score",
      instructions: "How technically accurate is the answer?",
      criteria: [
        "Fundamentally incorrect or dangerous advice",
        "Mostly incorrect with some correct elements",
        "Mostly correct with minor inaccuracies",
        "Technically correct",
        "Exemplary — includes nuance, caveats, and best practices",
      ],
    },
    tone: {
      type: "score",
      instructions: "How appropriate is the tone for a technical answer?",
      criteria: [
        "Rude, dismissive, or unhelpful",
        "Neutral but terse",
        "Helpful and professional",
        "Exceptionally clear, encouraging, and well-structured",
      ],
    },
  },
});

console.log(completeness.value); // 3.7 (between "fully answers" and "exceeds")
console.log(accuracy.value);     // 4.0
console.log(tone.value);         // 2.8
```

---

### Batching multiple question types

All three types can be mixed in a single call. Questions run in parallel and cannot see each other's answers — this is both faster and (for `jev`) cheaper than sequential calls.

```typescript
const result = await agent.judge({
  state: { prTitle: "Fix login timeout", prBody: "...", files: ["auth.ts", "session.ts"] },
  questions: {
    // Noul: binary gate
    isSecurityRelated: { type: "noul", instructions: "Does this PR touch authentication or authorization?" },
    // Choice: categorize
    changeType: {
      type: "choice",
      instructions: "What kind of change is this?",
      criteria: { bugfix: "Fixes a defect", feature: "Adds functionality", refactor: "Improves structure", docs: "Documentation only" },
    },
    // Score: quality gate
    testCoverage: {
      type: "score",
      instructions: "How well tested is this change?",
      criteria: ["No tests", "Minimal coverage", "Adequate coverage", "Comprehensive with edge cases"],
    },
    // Another Noul
    breaksApi: { type: "noul", instructions: "Does this change the public API contract?" },
  },
});

// result.isSecurityRelated.probability
// result.changeType.value
// result.testCoverage.value
// result.breaksApi.probability
```

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

-   **Backend-agnostic by design.** Nothing in this layer, or in any of its consumers, hardcodes a vendor name onto a field or an internal variable. Adding a provider follows one of two tiers: a System One-compatible provider (same wire protocol as Jev and Ollama) is a descriptor file plus tests, needing only endpoint, auth, model, and limit declarations; a provider outside the System One family is a `JudgmentBackend` module with its own wire translation and error mapping. Either way the engine, the service, and every consumer are untouched.
-   **Calibration ≠ truth.** A judgment answer's `confidence` reflects the backend's own distribution concentration, not whether the answer is _correct_ for your domain. Validate performance against your own data before trusting a threshold in production.
-   **Shadow sites are not yet inverted.** Strategy selection, complexity routing, task comprehension, and autonomy confidence all currently run in shadow mode only — they compute and compare, but the existing heuristic/LLM path still decides. Inverting a shadow site into an active decision is a separate, evidence-gated follow-up per site.
