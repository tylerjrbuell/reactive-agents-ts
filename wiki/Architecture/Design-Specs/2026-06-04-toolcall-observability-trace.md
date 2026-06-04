---
title: Tool-Call Observability — Per-Iteration Decision Record in the Trace System
date: 2026-06-04
status: proposed (approved direction; spec for review)
owner: observability / trace
related:
  - "[[2026-06-04-classifier-prunes-task-tool-rootcause]]"
  - "[[2026-06-04-calibration-adapter-toolcalling]]"
tags: [design-spec, observability, trace, rax-diagnose, tool-calling, feedback-loop]
---

# Tool-Call Observability — Per-Iteration Decision Record

> Goal (user, 2026-06-04): a tight, powerful feedback loop to understand and
> improve the harness — built into the full trace system, surfaced by
> `rax-diagnose`, showing all info needed to diagnose model-output issues.

## 1. The diagnostic gap (why this exists)

Root-causing the qwen3 harness degradation
([[2026-06-04-classifier-prunes-task-tool-rootcause]]) required **hand-instrumenting
`local.ts`** (`RA_DUMP_OLLAMA`) to see the one signal that cracked it — *the exact
tool array offered to the model*. Nothing in the trace surfaced it. The diagnosis
took an hour; with the record below it is a one-line `rax-diagnose` read.

**What the trace system has today** (`packages/trace/src/events.ts`): `run-started`,
`iteration-enter/exit`, `tool-call-start/end` (fires when a tool *executes*),
`decision-evaluated`, `intervention-*`, `entropy-scored`, etc. Recorded per-run via
`TraceRecorderService.emit()`; replayed/filtered by `rax-diagnose replay <runId>
--only=<kinds>`.

**What's missing** — the layer *before* execution, i.e. why the right tool was
never called:
1. **Tools offered** to the model this turn (the native array) — and the
   **registered→offered diff** (what the curator/classifier pruned). ← THE signal.
2. **Model raw output**: native `tool_calls` (names+args) vs content vs thinking,
   stopReason, observed dialect.
3. **Iteration outcome**: extracted calls + classification
   (success / drift / no-emission / text-answer).

`logModelIO` (`reasoning-stream-logger.ts`) renders system+thread+response-*content*
only — not the tools array, not native tool_calls, not the prune diff — and it's
verbose debug stdout, not queryable.

## ⚠️ SCOPE CORRECTION (2026-06-04, post code-audit) — the data is ALREADY captured, just mis-keyed

Code audit found the §2 "three new events" largely **duplicate existing capture**.
`LLMExchangeEvent` (`trace/events.ts`) ALREADY carries the signals I claimed missing:
`toolSchemaNames` (= tools **offered**), `response.toolCalls` (native calls emitted),
`systemPrompt`, `temperature`, `stopReason`, tokens/cost. It's emitted on
`complete`/`stream`/`completeStructured` via `observable-llm.ts` and replayed by
`rax-diagnose --only=llm-exchange`.

**Why I couldn't use it (the true blind spot):** `observable-llm.ts:45-46,109-110`
emits with `taskId: PLACEHOLDER_TASK_ID ("llm-direct")` + `iteration: 0`. The trace
layer keys `runId = raw.taskId` (`trace/layer.ts`), so every LLM exchange lands in a
**global `llm-direct.jsonl`, not the run's ULID** — `rax-diagnose replay <realRunId>`
never shows them. The data exists; it's **detached from the run**.

**Corrected (minimal) scope — re-key + provenance + view, NOT new capture:**
- **G-a (keystone): thread the real `taskId`/`iteration` into LLMExchange.** Replace
  the placeholders so the already-captured `toolSchemaNames`/`toolCalls` become
  per-run/iteration joinable. observable-llm is a generic provider wrapper → needs a
  run-context FiberRef (or request metadata) carrying taskId/iter from the kernel.
- **G-b: tool-prune provenance + floor invariant** (genuinely new). LLMExchange has
  `offered` (toolSchemaNames) but not `registered`, `prunedBy`, or the
  `requiredFloor` violation. Add these (extend LLMExchange or a sibling
  `tools-pruned` event at the curator/classifier seam).
- **G-c: `rax-diagnose decision` view** — the per-iteration table joining (now-keyed)
  llm-exchange + prune provenance + outcome, with the `⚠FLOOR` flag.

The original §2/§3 below describe the *target table* correctly; treat the event
schemas as "fields to ensure present on LLMExchange + a small prune event," not three
brand-new events. **Do not duplicate `toolSchemaNames`/`toolCalls` — they exist.**

## 2. Design — three new trace events (extend, don't reinvent)

Add to the `TraceEvent` union + emit at existing seams. All carry
`TraceEventBase` (runId, iteration, ts) so they join by iteration in replay.

### `tools-offered` (THE killer event) — emit at the curator/provider seam
```ts
interface ToolsOfferedEvent extends TraceEventBase {
  kind: "tools-offered"
  registered: readonly string[]      // everything available (incl. allowed/required)
  offered: readonly string[]          // what actually went in the request tools array
  pruned: readonly string[]           // registered − offered
  prunedBy: "classifier" | "curator" | "recall-gate" | "forbidden" | "none"
  requiredFloor: readonly string[]    // allowed/required that MUST be present (invariant check)
}
```
A non-empty `pruned ∩ requiredFloor` is a **constructively visible bug** (the qwen3
case: `github_list_commits` pruned while on the allowedTools floor).

### `model-output` — emit in think.ts after the LLM response
```ts
interface ModelOutputEvent extends TraceEventBase {
  kind: "model-output"
  nativeToolCalls: readonly { name: string; argsPreview: string }[]
  contentPreview: string             // first N chars, rationale/markup stripped
  thinkingPreview?: string           // <think> content preview (reasoning models)
  stopReason: string
  dialectObserved?: string           // lastDialectObserved
  params: { temperature?: number; numCtx?: number; numPredict?: number; think?: boolean }
}
```

### `iteration-outcome` — emit at act/think terminus
```ts
interface IterationOutcomeEvent extends TraceEventBase {
  kind: "iteration-outcome"
  extractedCalls: readonly string[]
  outcome: "tool-success" | "drift" | "no-emission" | "text-answer" | "final-answer"
  note?: string                      // e.g. "task tool pruned by classifier"
}
```

## 3. `rax-diagnose` view

A `rax-diagnose decision <runId>` (or `replay --view=decision`) that joins the three
events by iteration into a table:

```
iter | tools registered→offered (pruned)            | model emitted        | outcome
  0   | 6 → 5  [PRUNED: github_list_commits ⚠FLOOR]  | tool_call: find      | drift (task tool pruned)
  1   | 5 → 5                                        | tool_call: find      | drift
```

Builds on the existing replay/`--only` infra; `--only=tools-offered,model-output`
works immediately, and the `decision` view is the formatted join. `⚠FLOOR` flags a
required/allowed tool that was pruned (the invariant violation).

## 4. Emit seams (mapped to code)

| event | seam | owner |
|---|---|---|
| `tools-offered` | curator/classifier prune site (`setup/tool-schemas.ts`, `classifier.ts`) + provider boundary cross-check | runtime-warden + provider-warden |
| `model-output` | `think.ts` after stream consumption (has accumulatedToolCalls, content, thinking, dialect) | kernel-warden |
| `iteration-outcome` | `think.ts` / `act.ts` terminus (the existing outcome branches) | kernel-warden |
| `decision` view | `packages/diagnose` (rax-diagnose) | diagnose / harness-warden |
| event type defs | `packages/trace/src/events.ts` + recorder coverage | trace |

## 5. Why this is the enabling investment (sequence FIRST)

- **It validates the tool-relevancy redesign** ([[2026-06-04-calibration-adapter-toolcalling]]):
  re-run the bench → `rax-diagnose decision` → confirm "github now offered, model
  calls it." The instrument proves the fix.
- It pays off on **every** future model-output issue across all capabilities, not
  just tools (the `model-output` + `iteration-outcome` events are general).
- The `requiredFloor` invariant in `tools-offered` makes the *class* of bug
  (pruning a required tool) **loud and self-detecting** going forward.

## 6. Staged plan (gated)

1. **S0 — event types.** Add the 3 events to `trace/events.ts` + recorder + replay
   `--only` recognition. Unit test: emit → replay roundtrip. *Gate:* roundtrip green.
2. **S1 — `tools-offered` + floor invariant.** Emit at the prune seam with
   registered/offered/pruned/prunedBy/requiredFloor. *Gate:* re-run qwen3 BENCH →
   `rax-diagnose` shows `[PRUNED: github_list_commits ⚠FLOOR]` **without any code
   instrumentation** (the hand-instrumentation this replaces).
3. **S2 — `model-output`.** Emit native calls/content/thinking/dialect/params in
   think.ts. *Gate:* replay shows qwen3 emitted `find` (or thinking-only) per turn.
4. **S3 — `iteration-outcome`.** Emit outcome classification. *Gate:* table renders.
5. **S4 — `rax-diagnose decision` view.** The formatted per-iteration join + `⚠FLOOR`
   flag. *Gate:* one-command diagnosis of the qwen3 case reproduces this session's
   finding in seconds.

Cross-cutting: no PII (tool names + previews only; same privacy posture as existing
trace). Default-on at the existing trace verbosity (these are structured events, not
token-heavy); previews bounded.

## 7. Open question

- **Granularity vs volume.** Three events/iteration × many iterations — acceptable
  in the per-run JSONL (already records iteration-enter/exit, tool-call-start/end).
  Confirm default-on, or gate `model-output` previews behind a verbosity flag while
  `tools-offered` + `iteration-outcome` (cheap, high-value) stay always-on.
