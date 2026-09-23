---
title: Judgment Cookbook
description: >-
    Worked recipes for the judgment layer (@reactive-agents/judgment) — confidence-gated
    escalation, speculative fan-out, re-ranking, and citation checking with agent.judge().
sidebar:
    order: 28
---

Four worked recipes for `agent.judge()`. Each assumes `.withJudgment()` is already on the
builder — see [Judgment Layer](/features/judgment-layer/) for setup, backends, and the
`includeContext` option these recipes don't otherwise cover.

## Confidence-gated escalation

Don't just read the answer — read how sure the model is of it. A Choice or Score answer's
`confidence` reflects distribution concentration, not correctness, but it's still the right
signal for "should a human look at this instead of auto-acting":

```typescript
const { category } = await agent.judge({
    state: { message: userMessage },
    questions: {
        category: {
            type: 'choice',
            instructions: 'Which support category does this message belong to?',
            criteria: {
                billing: 'Payment, invoice, or refund questions',
                technical: 'Bugs, errors, or how-to questions',
                account: 'Login, access, or account-settings questions',
            },
        },
    },
})

if (category.kind === 'choice' && category.confidence >= 0.8) {
    routeTo(category.value) // auto-route the confident majority
} else {
    routeToHumanTriage(category) // low-confidence or ambiguous — don't guess
}
```

A Noul has no separate `confidence` field — its `probability` already IS the calibrated
signal (a value near 0.5 means genuinely uncertain, not "medium intensity"). Don't look for
`confidence` on a Noul answer; there isn't one.

## Speculative fan-out

Ask everything you might need in **one batched call**, including questions whose answer you
may end up ignoring — extra questions over the same `state` are cheap relative to a second
round trip, and every question runs in parallel against the same context:

```typescript
const answers = await agent.judge({
    state: { task: taskDescription, toolsAvailable },
    questions: {
        complexity: {
            type: 'score',
            instructions: 'How complex is this task?',
            criteria: ['trivial', 'moderate', 'complex'],
        },
        requiresTools: { type: 'noul', instructions: 'Does this task require calling a tool?' },
        // Speculative — only consumed when requiresTools comes back true.
        // Asking it now avoids a second request if it's needed.
        requiresCodeExecution: { type: 'noul', instructions: 'Does this task require executing code?' },
    },
})

const needsTools = answers.requiresTools.kind === 'noul' && answers.requiresTools.probability > 0.5
if (needsTools) {
    const needsCode =
        answers.requiresCodeExecution.kind === 'noul' && answers.requiresCodeExecution.probability > 0.5
    // ...branch using an answer you already have, no second call
}
```

Code decides what's relevant; the model never sees your branching logic, only the questions.

## Re-ranking candidates

`Score` each candidate against the same rubric, then let code pick the winner — better fit
than asking a single open-ended "which is best" `Choice` when the candidate set is dynamic
(search results, retrieved passages, generated alternatives) rather than a small fixed enum:

```typescript
const scored = await Promise.all(
    candidates.map(async (candidate) => {
        const { relevance } = await agent.judge({
            state: { query, candidate: candidate.text },
            questions: {
                relevance: {
                    type: 'score',
                    instructions: 'How relevant is `candidate` to `query`?',
                    criteria: ['irrelevant', 'tangential', 'partially relevant', 'directly relevant'],
                },
            },
        })
        return { candidate, score: relevance.kind === 'score' ? relevance.value : -1 }
    }),
)

const best = scored.sort((a, b) => b.score - a.score)[0]
```

For a large candidate set, batch several candidates as named fields in one `state` object and
ask one `relevance-<id>` question per candidate instead of one call per candidate — same
speculative-fan-out tradeoff as above, worth measuring against your own candidate count.

## Citation / grounding check

Catch an unsupported claim before it reaches the user — a `Noul` asking whether the evidence
actually backs the claim, not whether the claim merely mentions the same topic:

```typescript
const { grounded } = await agent.judge({
    state: { claim: generatedAnswer, evidence: sourceText },
    questions: {
        grounded: {
            type: 'noul',
            instructions:
                'Is `claim` fully supported by `evidence` — nothing invented, embellished, or unsupported?',
        },
    },
})

if (grounded.kind === 'noul' && grounded.probability < 0.5) {
    return regenerateWithEvidence(sourceText) // or surface a low-confidence disclaimer
}
```

This is the same pattern the framework's own internal grounding-fabrication shadow site uses
(see [Judgment Layer → Internal harness sites](/features/judgment-layer/#internal-harness-sites-opt-in-per-site))
— shadow-only there, active here, because you own the decision of what "ungrounded" should do
in your application.
