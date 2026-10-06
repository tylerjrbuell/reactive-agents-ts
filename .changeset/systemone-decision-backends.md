---
"@reactive-agents/judgment": minor
"@reactive-agents/runtime": minor
"@reactive-agents/reasoning": minor
"reactive-agents": minor
---

Judgments can now run completely local and private. `.withJudgment({ backend: "ollama" })`
points the Choice/Score/Noul primitive at Ollama's System One decision API
(`ollama pull nimble`, or Cloudflare's `clef` / `clef-flash` for vision), with
calibrated distributions, no API key, and no outbound network.

```ts
const agent = await ReactiveAgents.create()
    .withProvider('anthropic')
    .withJudgment({ backend: 'ollama' })
    .build()
```

The Ollama backend is one descriptor in a shared System One protocol engine
(`makeSystemOneHttpBackend`), so a second System One provider (hosted or
local) is a descriptor file plus tests, not a new backend module. A provider
outside the System One family still plugs in through the existing
`JudgmentBackend` interface.

Capability negotiation: backends now declare `JudgmentCapabilities`
(`maxQuestions`, `supportedKinds`, `distributions`, `calibrated`, `images`,
`modelCatalog`) and consumers adapt automatically: `judgeRank()` and the
comprehension chunker clamp to the backend's real ceiling instead of a
hardcoded constant. Read them with `capabilitiesOf(service)`; a service that
predates the field gets the safe defaults.

`agent.judge()` accepts an optional `images: string[]` channel (base64 only,
vision model required, 32 MiB ceiling) for screenshot- and UI-state-style
questions:

```ts
const { passes } = await agent.judge({
    state: { task: 'Check the checkout page for layout breakage' },
    questions: { passes: { type: 'noul', instructions: 'Is the page visually broken?' } },
    images: [base64Png],
})
```

`.withJudgment({ backend: 'ollama', ollama: { keepAlive: '10m' } })` keeps the
decision model warm between calls. The `jev` and `llm` backends are unchanged.
