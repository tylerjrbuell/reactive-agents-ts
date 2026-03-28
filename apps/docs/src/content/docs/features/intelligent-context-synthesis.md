---
title: Intelligent Context Synthesis
description: Optional kernel pass that rewrites the reasoning transcript between iterations — templates or LLM — with per-strategy overrides.
sidebar:
  order: 14
---

**Intelligent Context Synthesis (ICS)** runs after each thinking step (iteration ≥ 1) when the shared ReAct-style kernel is active. It produces a compact message list for the next LLM call instead of replaying the full raw transcript.

## Modes

| Mode | Behavior |
|------|----------|
| `auto` | Heuristic: e.g. fast templates on capable tiers; may skip deep synthesis on small local models without a dedicated synthesis model |
| `fast` | Deterministic template synthesis (no extra LLM) |
| `deep` | LLM-driven synthesis via `ContextSynthesizerService` |
| `custom` | Supply `synthesisStrategy` on `.withReasoning()` |
| `off` | Disable synthesis; kernel uses the standard message window |

## Builder API

Top-level fields apply to every strategy unless overridden:

```typescript
.withReasoning({
  synthesis: "auto",
  synthesisModel: "claude-3-5-haiku-20241022",
  synthesisProvider: "anthropic",
  synthesisTemperature: 0,
})
```

Per-strategy overrides apply only when that strategy is the **effective** execution strategy (after tier routing). Keys match the internal bundles: `reactive`, `planExecute`, `treeOfThought`, `reflexion`. The **adaptive** meta-strategy does not have its own bundle — only the global/top-level ICS fields apply until a concrete strategy runs (each inner run then uses its own resolved config).

```typescript
.withReasoning({
  synthesis: "fast",
  strategies: {
    reactive: { synthesis: "deep", synthesisModel: "gpt-4o-mini" },
    planExecute: { synthesis: "off" },
  },
})
```

Resolution order: **per-strategy ICS fields → top-level `.withReasoning()` synthesis fields → default `{ mode: "auto" }`**. Advanced layouts can call `resolveSynthesisConfigForStrategy()` from `@reactive-agents/runtime` when building custom configs.

## How Fast Synthesis Works

Fast-mode synthesis reconstructs a **multi-turn conversation** from the kernel transcript rather than flattening everything into a single user message. This is critical for native function-calling models (especially local models like Ollama) that rely on the proper `user` → `assistant` (with `tool_use` blocks) → `tool` (result) → `user` (nudge) message structure.

### Tier-Adaptive Windowing

The synthesizer applies a sliding window to keep only the most recent N turns as full multi-turn messages. Older turns are compacted into a single summary message (`[Prior work: called web-search → result preview | ...]`). The window size varies by model tier:

| Tier | Full Turns Kept | Arg Budget (chars) |
|------|----------------|--------------------|
| `local` | 2 | 100 |
| `mid` | 3 | 200 |
| `large` | 5 | 400 |
| `frontier` | 8 | 600 |

Tool-call arguments (e.g. large `file-write` content) are truncated per tier budget so they don't bloat the synthesized context. The actual deliverables live in the tool results, not in the repeated argument replay.

### Task-Phase Classification

Each synthesis pass classifies the current task phase based on tool usage and iteration progress:

| Phase | Meaning | Steering |
|-------|---------|----------|
| `gather` | Required tools not yet called | Nudges the model to call missing tools |
| `produce` | Data gathered, output not yet created | Directs the model to produce the deliverable |
| `synthesize` | All required tools satisfied | Encourages a final summary |
| `verify` | Output exists, confirmation step | Asks the model to confirm/summarize results |

## Observability

When synthesis runs, the framework publishes a **`ContextSynthesized`** event on the EventBus (payload includes a snapshot of signals such as tier, iteration, and last errors). Subscribe with `agent.subscribe("ContextSynthesized", …)` when `.withEvents()` is enabled.

## See also

- [Reasoning guide](/guides/reasoning/) — strategy overview
- [Builder API — ReasoningOptions](/reference/builder-api/#reasoningoptions)
- Design spec: `docs/superpowers/specs/2026-03-28-intelligent-context-synthesis-design.md`
