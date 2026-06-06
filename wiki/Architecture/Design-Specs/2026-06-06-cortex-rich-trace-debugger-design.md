# Cortex Rich-Trace Debugger — Design Spec (2026-06-06)

Status: APPROVED (brainstorming). Branch target: main (Cortex Track B).

## Problem

Cortex's `TracePanel` is effectively a *run panel*: one row per kernel loop (iteration
frame) built from 6 events (`ReasoningStepCompleted`, `ReasoningIterationProgress`,
`LLMRequestCompleted`, `ToolCallCompleted`, `FinalAnswerProduced`, `EntropyScored`).
The framework emits a far richer event stream — `LLMExchangeEmitted` (system prompt,
full thread, native toolCalls, cache read/creation tokens, stopReason, requestKind),
`StrategySwitched`, `VerifierVerdictEmitted`, `GuardFiredEmitted`, `ReactiveDecision`,
`InterventionDispatched/Suppressed`, `KernelStateSnapshotEmitted`, `CuratorDecisionEmitted`,
`ContextSynthesized` — all of which already reach Cortex (runner forwards EVERY event,
persisted in `cortex_events`, buffered client-side) but are unhandled by the UI. The
offline `@reactive-agents/trace` package normalizes these into a 22-kind `TraceEvent`
taxonomy consumed by `rax-diagnose` (analyze/cohort/replay) — but never by Cortex.

Cortex is a debugging tool; it should surface this richness.

## Decisions (locked via brainstorming)

1. **Live-rich first.** Phase 1 = real-time rich timeline. Offline `analyzeRun()` analysis = phase 2 (separate spec).
2. **Event-timeline row model.** Discrete events as rows, grouped under iteration/phase headers — not iteration-only frames.
3. **Reuse the `packages/trace` `TraceEvent` model** (shared with rax-diagnose), not a Cortex-private dialect.
4. **All events + filter chips.** Full fidelity; default mutes aux/internal noise; one click reveals all.
5. **Approach A** (normalize in Cortex ingest, server-side, in-process).
6. **No lost functionality.** The timeline AUGMENTS the existing frame detail; nothing today is removed.

## Key constraint: two event vocabularies must merge

`toTraceEvent` (packages/trace/layer.ts) maps the rich events but **NOT** `ReasoningStepCompleted`
/ `ReasoningIterationProgress` / `ContextSynthesized` (the package uses `iteration-boundary`
+ `kernel-state-snapshot` instead). The current frame view's reasoning content (thought,
rawResponse, conversation thread, observation) lives ONLY in RSC/RIP. Therefore a pure
TraceEvent timeline would LOSE that content. The unified timeline must merge BOTH streams:
existing RSC/RIP-derived reasoning rows + normalized rich TraceEvent rows, ordered by seq/ts,
grouped by the RIP iteration axis (which vitals + replay already share).

Verified live emission (emit-site counts): LLMExchangeEmitted 2, ToolCallCompleted 6,
StrategySwitched 2, VerifierVerdictEmitted 2, GuardFiredEmitted 2, ReactiveDecision 2,
InterventionDispatched 3, KernelStateSnapshotEmitted 2, CuratorDecisionEmitted 2.
`DecisionRecordEmitted` = 0 emit sites → excluded.

## Architecture (Approach A, additive)

```
agent EventBus
  └─ runner-service.agent.subscribe(rawEvent)          [UNCHANGED: forwards every event]
       └─ ingest.handleEvent(agentId, runId, {event})
            ├─ existing 7-tag vitals reducer            [UNCHANGED]
            ├─ persist raw event → cortex_events        [UNCHANGED]
            └─ NEW: trace-normalize → toTraceEvent(raw, seq)
                 └─ if non-null: persist TraceEvent row (type=kind) + broadcast
client run-store.events[]  (already buffers ALL raw events)
  └─ NEW timeline-store: merge RSC/RIP reasoning rows + TraceEvent rows
       → seq/ts-ordered, iteration-grouped, filterable
  └─ TracePanel: renders grouped timeline + filter chips   [existing frame fields preserved]
  └─ replay store: UNCHANGED (RIP loop axis); timeline filters to scrubbed slice
```

- **Export** `toTraceEvent(raw: AgentEvent, seq: number): TraceEvent | null` from `packages/trace`
  (currently private in layer.ts, uses a module-global `nextSeq()`). Refactor: accept an injected
  `seq` so Cortex supplies its own monotonic `cortex_events.seq`; `TraceBridgeLayer` keeps its
  internal counter by passing `nextSeq()`.
- **Persistence**: rich TraceEvents land in the existing `cortex_events` table
  (`agent_id, run_id, session_id, seq, ts, type, payload`). `type` = TraceEvent.kind. No schema change.
- **Bootstrap/replay**: `/api/runs/:id/events` already replays persisted rows → full timeline rehydrates.

## Components (small, single-purpose)

| Unit | Path | Responsibility |
|------|------|----------------|
| `toTraceEvent` (exported) | `packages/trace/src/layer.ts` + `index.ts` | pure raw→TraceEvent mapper with injected seq |
| `trace-normalize` | `apps/cortex/server/services/` | at ingest, map rich events → TraceEvent, persist + broadcast; skip when null |
| `timeline-store` | `apps/cortex/ui/src/lib/stores/` | merge RSC/RIP reasoning rows + TraceEvent rows → ordered, grouped, filtered rows |
| `TimelineRow.svelte` | `apps/cortex/ui/src/lib/components/` | per-kind row renderer (exchange / tool / switch / verdict / guard / decision / reasoning) |
| `TracePanel.svelte` | (existing) | host grouped timeline + filter chips; keep expand/collapse, copy, replay-slice |

## Timeline row taxonomy + filter chips

Row kinds (merged):
- **Reasoning** (from RSC): thought, rawResponse, conversation thread, action, observation, entropy.
- **LLM call** (from `llm-exchange`): system prompt, message thread, native toolCalls, tokensIn/out,
  cache read/creation %, stopReason, requestKind, provider/model.
- **Tool** (from `tool-call` started/completed): name, args, result/error, durationMs.
- **Control** (`strategy-switched`, `verifier-verdict`, `guard-fired`, `reactive-decision`,
  `intervention-dispatched/suppressed`, `curator-decision`): badge + reason.
- **Aux/internal**: llm-exchange calls flagged aux (intent classifier, structured-output plan-gen,
  tool-relevance — identified by `requestKind`/systemPrompt signature or `taskId === "llm-direct"`),
  kernel-state snapshots.

Filter chips: `Reasoning` · `LLM calls` · `Tools` · `Control` · `Aux/internal`. Default ON = all
except `Aux/internal`. Chips show live counts. Each chip toggles a row category.

Grouping: section header per iteration (RIP boundary) with phase sub-label (plan/execute/reflect)
when the strategy provides one; rows without an iteration sort into the nearest preceding boundary.

## No-loss guarantees (explicit)

- Every current `CortexTraceFrame` field still renders (thought/rawResponse/messages/action/
  observation/toolName/toolArgs/entropy/tokensUsed/durationMs/model/provider/cost).
- Expand/collapse, copy-to-clipboard, expand-all/collapse-all preserved.
- Replay scrub unchanged (RIP axis); timeline filters to the scrubbed iteration slice.
- Bootstrap rehydration unchanged.
- Vitals reducer + existing persistence untouched (regression-tested).

## Error handling

- `toTraceEvent` returns `null` for unmapped tags → skipped silently (existing pattern).
- Normalization failures swallow via `emitErrorSwallowed` (existing site pattern) — never break the run.
- Malformed/oversized payloads truncated by the package's existing truncation (LLMExchange already truncates).
- Client merge tolerant of missing fields (optional-chaining), matching `safeMessages` style.

## Testing

- `packages/trace`: unit — `toTraceEvent(raw, seq)` per mapped kind returns expected shape + seq;
  unmapped tag → null. `TraceBridgeLayer` regression (still records via injected `nextSeq`).
- `apps/cortex/server`: `trace-normalize` persists + broadcasts rich events; vitals reducer + raw
  persistence unchanged (regression). Bun test, real DB shape.
- `apps/cortex/ui`: `timeline-store` — fixture event stream → expected ordered/grouped/filtered rows;
  assert no existing frame field dropped; filter toggles include/exclude correctly; replay slice filters.

## Phasing

- **Phase 1 (this spec):** live unified rich timeline + filter chips + persistence + replay-slice.
- **Phase 2 (separate spec, noted):** Approach B — attach `TraceBridgeLayer` + recorder to Cortex
  runs → JSONL → `analyzeRun()` post-run analysis tab (honesty/intervention/cost/failure-modes).

## Out of scope

- Phase-2 offline analysis (above).
- Changes to the `@reactive-agents/trace` analysis surface (analyze/cohort) beyond exporting `toTraceEvent`.
- Bug 3 / unrelated Cortex panels.
