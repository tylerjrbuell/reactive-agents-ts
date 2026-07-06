---
"reactive-agents": minor
"@reactive-agents/llm-provider": minor
"@reactive-agents/ui-core": minor
"@reactive-agents/react": minor
"@reactive-agents/svelte": minor
"@reactive-agents/vue": minor
---

### Groq and xAI providers

Two new first-class providers, both wired through a shared `makeOpenAICompatProvider` factory so they inherit the full OpenAI-compatible stack — streaming, native function calling, and structured output — without a bespoke adapter each.

```typescript
ReactiveAgents.create().withProvider("groq").withModel("llama-3.3-70b-versatile").build();
ReactiveAgents.create().withProvider("xai").withModel("grok-4").build();
```

- **Live-verified end to end** on both providers: plain completion plus native tool-call round-trips.
- Provider-aware native-function-call fallback; logprobs and embeddings are capability-gated (Groq/xAI expose neither).
- Structured output on Groq is model-dependent — `json_schema` strict works on `gpt-oss` and some models, others accept only `json_object`; the parse-retry loop covers the gap.
- Provider count is now **8** (Anthropic, OpenAI, Gemini, LiteLLM, Ollama, test, Groq, xAI).

### Agentic UI Kit — `@reactive-agents/ui-core`

New framework-agnostic headless package (`@reactive-agents/ui-core`) holding the shared controllers behind the UI bindings: a progressive UI-tree reconciler, a task-inbox fetch controller, and interaction + approval POST controllers. The React, Svelte, and Vue packages now delegate to these controllers instead of each re-implementing the wire protocol.

- **React** rewired onto `ui-core` with a core `useRun` hook and the full v1 family surface — Interact (`AgentPrompt`/`ChoiceCard`), Inbox (`useTaskInbox`/`TaskInbox`), Observe (`useRunCost`/`useRunSteps` + `CostMeter`/`StepTimeline`), Render (`AgentSurface` registry + UI-tree schema), plus a `useResumableRun` hook and an `AgentDevtools` overlay with `testing`/`styles` subpaths.
- **Svelte** and **Vue** rewired onto the same controllers (`createRun`, `createInteractions`, `createResumableRun`, run cost/steps), restoring `requestInit`/header pass-through on structured streams.

### Cortex `request_user_input` interaction rail

Cortex gains a durable request-for-input rail: runner methods plus a `.withInteraction(...)` surface, an interaction-watcher, and a real end-to-end pause → register → respond → resume flow. The Cortex UI renders a live Interact panel and streaming structured previews.

### Surfaced run errors instead of a generic message

Reasoning failures now propagate the real error string to `result.error` end to end. Previously the kernel captured the full message in `state.error` but `normalizeReasoningResult` dropped it during its whitelist rebuild, so callers only ever saw a generic `"Reasoning failed"`. An `error` field now rides `ReasoningResultSchema` / `ExecutionReasoningResult` through normalization; e.g. a bad model id now surfaces `"…404 The model … does not exist"` on `result.error`.
