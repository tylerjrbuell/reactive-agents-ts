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
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withJudgment() // backend auto-selects: "jev" if TYPESAFE_API_KEY is set, else "llm"
  .build();

const { risky } = await agent.judge({
  state: { action: "delete all files in /tmp" },
  questions: {
    risky: { type: "noul", instructions: "Is this action destructive?" },
  },
});

if (risky.kind === "noul" && risky.probability > 0.7) {
  // escalate, ask for confirmation, etc.
}
```

Calling `agent.judge()` without `.withJudgment()` throws immediately — an unconfigured judgment call is a caller mistake, not a silent no-op.

### Backends

| Backend | Requires | Calibration |
| --- | --- | --- |
| `jev` | A TypeSafe API key (`TYPESAFE_API_KEY` env var, or `.withJudgment({ apiKey })`) | Real calibrated probabilities from TypeSafe's System One model |
| `llm` | Nothing beyond your existing provider | Self-reported estimate from your LLM — `calibrated: false` on every answer, so gate on that flag if calibration matters to your logic |

Backend selection is automatic (`jev` when a key resolves, `llm` otherwise) unless you set `.withJudgment({ backend: "jev" | "llm" })` explicitly.

## The three primitives

| Primitive | Shape | Use when |
| --- | --- | --- |
| **Noul** | One probability, no separate confidence | Judging whether a single condition holds ("is this toxic?") |
| **Choice** | One value from a named set, plus a probability distribution and confidence | Selecting between mutually exclusive options |
| **Score** | A position on an ordered rubric (may fall between levels), plus confidence | Rating a graded dimension ("how complete is this response, 0–2?") |

Ask several independent questions over the same state in **one batched request** — they run in parallel and can't see each other's answers, which is both faster and (for the `jev` backend) cheaper than one call per question.

## Internal harness sites (opt-in, per-site)

Beyond the public `agent.judge()` primitive, several internal decision points can optionally route through the same judgment layer instead of (or alongside) their existing regex/heuristic logic. Every site below is either:

- **shadow-only** — the judgment answer is computed and compared against the existing decision for later analysis, but never changes what the agent actually does, or
- **additive** — the judgment answer can only add a signal on top of what already passes, never remove one (unless an explicit stricter opt-in says otherwise).

| Site | Package | Mode | Enable via |
| --- | --- | --- | --- |
| Strategy selection | `reasoning` | shadow | `.withJudgment()` alone — fires automatically once wired |
| Complexity routing | `cost` | shadow | `.withJudgment()` alone |
| Task comprehension | `reasoning` (kernel) | shadow | `.withJudgment()` alone |
| Guardrails battery | `guardrails` | additive (default) / opt-in `jev-primary` | `.withGuardrails({ enableJudgmentBattery: true })` |
| Autonomy/approval confidence | `interaction` | shadow only (no invert path yet — highest blast radius) | `.withJudgment()` alone |
| Tool-call healing | `tools` | additive escalation | not yet wired into the kernel's tool-execution path — library-level export only |

Every site degrades cleanly to its existing behavior when `JudgmentService` is absent, when the backend errors or times out, or when an answer doesn't clear its confidence floor. An agent that never calls `.withJudgment()` behaves byte-for-byte as it did before this feature existed.

### Guardrails judgment battery

The most immediately useful opt-in site. Runs a batched judgment (prompt-injection, PII exposure, toxicity, jailbreak-roleplay, plus an overall severity score) parallel to the existing regex detectors:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withJudgment()
  .withGuardrails({
    enableJudgmentBattery: true,
    judgmentStrictness: "additive", // default: only adds/escalates, never unblocks a regex hit
    // judgmentStrictness: "jev-primary" — explicit opt-in: the battery's verdict
    // is authoritative per violation type and CAN unblock a regex false-positive.
    screenOutputs: true, // observability-only battery pass over replies too
  })
  .build();
```

With the default `"additive"` strictness, enabling the battery can never cause an input that passes today to start being blocked — it can only catch things the regex table misses (a paraphrased injection attempt, for example) or escalate a regex hit's severity when the battery agrees.

## Observability

Every judgment call emits `JudgmentEvaluated` (success) or `JudgmentFailed` (error) on the `EventBus`, tagged with a `site` name and the backend that answered. Shadow sites additionally emit `JudgmentShadow` events carrying the judgment's answer, the existing decision, and an agreement verdict — the data an ablation study needs to decide whether a shadow site is ready to graduate from "observed" to "decides."

## Design notes

- **Backend-agnostic by design.** Nothing in this layer, or in any of its consumers, hardcodes a vendor name onto a field or an internal variable — `JudgmentBackend` is the only interface a provider implements, so a future open-source System One model is a drop-in with zero consumer change.
- **Calibration ≠ truth.** A judgment answer's `confidence` reflects the backend's own distribution concentration, not whether the answer is *correct* for your domain. Validate performance against your own data before trusting a threshold in production.
- **Shadow sites are not yet inverted.** Strategy selection, complexity routing, task comprehension, and autonomy confidence all currently run in shadow mode only — they compute and compare, but the existing heuristic/LLM path still decides. Inverting a shadow site into an active decision is a separate, evidence-gated follow-up per site (see the implementation plan for each site's exit gate).
