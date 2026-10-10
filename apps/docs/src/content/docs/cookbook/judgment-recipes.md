---
title: Judgment Recipes
description: >-
  Worked recipes for the judgment layer (@reactive-agents/judgment) — confidence-gated
  escalation, speculative fan-out, re-ranking, and citation checking with agent.judge().
sidebar:
  order: 13
---

Six worked recipes for `agent.judge()`. Each assumes `.withJudgment()` is already on the
builder — see [Judgment Layer](/features/judgment-layer/) for setup, backends, and the
`includeContext` option these recipes don't otherwise cover.

## Confidence-gated escalation

Don't just read the answer — read how sure the model is of it. A Choice or Score answer's
`confidence` reflects distribution concentration, not correctness, but it's still the right
signal for "should a human look at this instead of auto-acting":

```typescript
const userMessage = "I was charged twice for my subscription — refund one payment";

function routeTo(category: string): void {
    // auto-route the confident majority
}

function routeToHumanTriage(answer: unknown): void {
    // low-confidence or ambiguous — don't guess
}

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
const taskDescription = "Summarize today's support tickets by category";
const toolsAvailable = ["web-search", "file-read", "file-write"];

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
(search results, retrieved passages, generated alternatives) rather than a small fixed enum.

Use `agent.judgeRank()` — it batches every candidate's Score question into as few `ask()`
calls as possible (one call when the whole set fits under `chunkCap`, chunked calls
otherwise), instead of firing one round trip per candidate:

```typescript
const candidates = [
    { id: "a", text: "Reset your password from the account settings page." },
    { id: "b", text: "Contact support and they will reset it for you." },
];

const ranked = await agent.judgeRank(
    candidates.map((c) => ({ id: c.id, state: { query, candidate: c.text } })),
    {
        instructions: 'How relevant is `candidate` to `query`?',
        criteria: ['irrelevant', 'tangential', 'partially relevant', 'directly relevant'],
    },
)

const best = candidates.find((c) => c.id === ranked[0]?.id)
```

`ranked` is sorted best-first. It **may come back shorter than `candidates`** — a candidate the
backend answers with something other than a Score answer is silently dropped rather than
surfaced as a partial-failure marker, so diff `ranked.map(r => r.id)` against your candidate
list if you need to detect drops.

For a large candidate set, tune `opts.chunkCap` (default `30` candidates per `ask()` call)
against your own candidate count — a lower cap means more calls but a smaller prompt per call;
a higher cap means fewer calls at the cost of one larger request. See
[Judgment Layer → `judgeRank()`](/features/judgment-layer/#re-ranking-candidates-judgerank) for
the full option reference.

## Citation / grounding check

Catch an unsupported claim before it reaches the user — a `Noul` asking whether the evidence
actually backs the claim, not whether the claim merely mentions the same topic:

```typescript
const generatedAnswer = "The refund was issued on Monday.";
const sourceText = "Refund issued Monday; confirmation #1234.";

async function regenerateWithEvidence(evidence: string): Promise<void> {
    // re-prompt with the evidence attached, or surface a disclaimer
}

async function publishIfGrounded(): Promise<void> {
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
}
```

This is the same pattern the framework's own internal grounding-fabrication shadow site uses
(see [Judgment Layer → Internal harness sites](/features/judgment-layer/#internal-harness-sites-opt-in-per-site))
— shadow-only there, active here, because you own the decision of what "ungrounded" should do
in your application.

## Local & private judgment

Run judgments on a local Ollama server when the judged content can't leave the
machine: support transcripts, medical notes, anything under a data-residency
constraint. No API key, no outbound network beyond the server itself, and the
same calibrated distributions the hosted `jev` backend returns.

Prerequisite: `ollama pull nimble` once per machine.

```typescript
const agent = await ReactiveAgents.create()
    .withProvider('anthropic')
    .withJudgment({ backend: 'ollama', ollama: { keepAlive: '10m' } })
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
cold-loads the model (the default timeout is 30 seconds); `keepAlive` keeps it
warm between calls. A missing model fails with a `JudgmentBadResponse` naming
the model and the `ollama pull` command to run.

## Screenshot classification

Ask questions about UI state by passing a screenshot alongside the text. The
`images` channel takes base64-encoded PNG/JPEG/WebP strings (no URLs) and
requires a vision decision model such as Cloudflare's `clef` or `clef-flash`,
pulled locally through Ollama.

Prerequisite: `ollama pull clef` (27B) or `ollama pull clef-flash` (9B).

```typescript
const base64Png = "<base64-encoded PNG screenshot>";

const agent = await ReactiveAgents.create()
    .withProvider('anthropic')
    .withJudgment({ backend: 'ollama', model: 'clef-flash' })
    .build()

const { passes } = await agent.judge({
    state: { task: 'Check the checkout page for layout breakage' },
    questions: {
        passes: { type: 'noul', instructions: 'Is the page visually broken?' },
    },
    images: [base64Png],
})
```

Images are scored together with `state`, in the order you pass them, and the
request body is capped at 32 MiB with images. Sending images to a text-only
model (or to the `jev`/`llm` backends) fails loudly with `JudgmentUnsupported`
rather than being dropped.
