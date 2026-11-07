---
type: implementation-plan
status: active
created: 2026-11-07
updated: 2026-11-07
tags: [implementation-plan, streaming, tokens, cortex, ui-core, runtime, observability]
spec: "[[2026-11-06-skills-and-extension-model]]"
---

# Live token usage + realtime context wheel (Cortex chat)

**Goal:** every streaming chat turn shows live input/output tokens while the model is
working, keeps a per-LLM-call strip for inspection, and moves the context wheel between
provider readings. The final split survives a reload. The existing right-hand Turn
inspector grows into ONE session-aware inspector with a first-class **Context** tab
(OpenCode-style: session, provider/model, context limit, usage, total/input/output/cache
tokens, message counts, cost, timestamps, raw messages), so usage details are not split
across a tiny popover and three unrelated tabs. No number is fabricated: a
provider-reported split wins; an estimate is visibly marked `~` and corrected as soon as a
provider number arrives.

**Why now:** the framework already publishes `LLMRequestCompleted` with `tokensIn` /
`tokensOut` on every mediated LLM call (`packages/reasoning/src/kernel/utils/diagnostics.ts`)
and already carries the final split on `StreamCompleted.metadata.inputTokens` /
`outputTokens`. Cortex declares `ChatTurn.liveTokens` / `liveCost` and renders them, but no
code ever sets them: the live counter is dead. The context wheel only moves on
`ContextPressure`, once per completed call. This plan connects existing truth to the UI
instead of adding a second measurement path.

**Non-goals:**
- No provider-specific tokenizer. Estimates use the documented `ceil(chars / 4)`
  approximation shared with the test provider and marked `~`.
- No new SSE transport. `TokenUsage` rides the existing `runStream()` / chat SSE stream.
- No fabricated percentage when the context window is unknown. Until a real
  `ContextPressure` arrives, the ring stays blank (today's behavior).
- No token math on the direct no-tools path while it streams: that path is buffered by
  design. It gets the final provider split only.

---

## Design decisions (binding for this plan)

### 1. One new public stream event: `TokenUsage`

Add a full-density `AgentStreamEvent` variant, projected from the existing bus event
`LLMRequestCompleted` exactly the way `ContextPressure` is projected. Do **not** publish a
new bus event and do **not** measure tokens in the runtime projection.

```ts
// packages/runtime/src/stream-types.ts (full-density section)
| {
    /** One completed LLM call's provider usage. Only emitted when density is "full". */
    readonly _tag: "TokenUsage";
    /** Provider request id; stable per call, used by the UI to dedupe. */
    readonly callId: string;
    /** Prompt tokens, only when the provider reported them. */
    readonly tokensIn?: number;
    /** Completion tokens, only when the provider reported them. */
    readonly tokensOut?: number;
    /** Raw provider total (`tokensIn + tokensOut` as published). Never an estimate. */
    readonly tokensTotal: number;
    /** True iff either split half is absent; the UI may estimate the split and must mark it. */
    readonly estimated: boolean;
    readonly estimatedCost: number;
    /** Tokens served from the provider's prompt cache, when reported. */
    readonly cacheReadTokensIn?: number;
    /** Tokens that wrote new provider cache entries, when reported. */
    readonly cacheCreationTokensIn?: number;
    readonly model: string;
    readonly provider: string;
    readonly durationMs: number;
    readonly iteration?: number;
  }
```

The core bus event `LLMRequestCompleted` gains two optional fields:

```ts
readonly iteration?: number;
readonly cacheCreationTokensIn?: number;
```

`emitLLMExchange` already receives `iteration` and both cache figures, so it stamps the
publish site. Old publishers stay valid (optional), old traces stay readable.

### 2. One honesty rule for splits

Put the rule in `@reactive-agents/ui-core` and reuse it everywhere:

```ts
// packages/ui-core/src/state/token-usage.ts
export interface TokenSplit {
  readonly in: number;
  readonly out: number;
  readonly estimated: boolean;
}
export function splitTokens(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  totalTokens: number,
): TokenSplit
```

Rules:
1. Both halves reported → return them, `estimated: false`.
2. One half reported → derive the other from `totalTokens`, `estimated: true`.
3. Neither reported → deterministic 70% / 30% split of `totalTokens`, `estimated: true`.
4. `totalTokens <= 0` → `{ in: 0, out: 0, estimated: true }`.

All zeros are clamped non-negative. The same function backs the live counter, the popover,
and the persisted trace display, so three surfaces cannot disagree.

### 3. One live output estimator

```ts
// packages/ui-core/src/state/token-usage.ts
/** Deterministic streaming estimate: ~4 chars per token, rounded up. */
export function charsToTokens(chars: number): number {
  return chars <= 0 ? 0 : Math.ceil(chars / 4);
}
```

### 4. Turn usage is per-call evidence, not a second total

`TurnTraceState` gains:

```ts
export interface CallUsage {
  readonly callId: string;
  readonly iteration?: number;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly tokensTotal: number;
  readonly estimated: boolean;
  readonly costUsd: number;
  /** Provider-reported cache read/write tokens, absent when the provider reported none. */
  readonly cacheReadTokensIn?: number;
  readonly cacheCreationTokensIn?: number;
  readonly model: string;
  readonly provider: string;
  readonly durationMs: number;
}
export interface TurnUsage {
  readonly calls: readonly CallUsage[];
  /** Sum of REPORTED input halves (estimated calls contribute 0 here). */
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly tokensTotal: number;
  /** True when any call lacks a provider split. */
  readonly estimated: boolean;
  readonly costUsd: number;
  /** Sums of provider-reported cache figures across the turn's calls. */
  readonly cacheReadTokensIn: number;
  readonly cacheCreationTokensIn: number;
}
```

The fold appends one call per `TokenUsage`, deduped by `callId`, and recomputes the sums
with a pure `summarizeUsage(calls)` helper. `finishTurnTrace` persists
`usage?: TurnUsage` so a reloaded turn keeps the strip. The turn's persisted
`tokensUsed`/`tokensIn`/`tokensOut` remain the authoritative final figures; `trace.usage`
is the evidence trail and must not overwrite them.

### 5. Context wheel: measured first, estimated only on top of a known window

- `ContextPressure` stays authoritative. It sets the window and the measured prompt size,
  `estimated: false`.
- `TokenUsage` updates the prompt size to the reported `tokensIn` (when present). If a
  window is already known, set `used = tokensIn + (tokensOut ?? 0)` and `estimated: true`
  because the next prompt will differ slightly. If no window is known, do nothing.
- During `TextDelta`s, keep a `basePromptTokens` from the latest `ContextPressure` /
  `TokenUsage` and set `used = basePromptTokens + charsToTokens(current live text length)`,
  `estimated: true`. This is what makes the wheel move while the model types.
- Never compute `utilizationPct` from an invented window. No window → no ring.
- Persist only measured `ContextPressure` readings (`StoredContext` stays unchanged).

`ChatContext` gains `estimated?: boolean` (additive). `StoredContext` does **not**.

### 6. Final split survives reload

Cortex `cortex_chat_turns` gains nullable `tokens_in` / `tokens_out` columns. They store
only provider-reported or run-metadata values, never an estimate. The UI applies
`splitTokens` at render time, so an old row with no split still shows an honest `~` split
instead of blanks.

Direct (no-tools) path: `ChatReply` gains optional `inputTokens` / `outputTokens`, sourced
from the provider response in `makeChatComplete`. That path emits no live `TokenUsage`;
Cortex yields the buffered text and the final split.

### 7. One consolidated inspector (OpenCode-style Context tab)

`ChatTraceDrawer.svelte` becomes the single place for usage detail. Keep the filename to
avoid a wide import churn, but change its visible identity and tabs:

- Title: **Inspector** (not "Turn inspector").
- Tabs, in order: **Context**, **Steps**, **Run trace**. Context is the default.
- The current "Overview" content is folded into Context (run status, steps, tool calls,
  tool time, model/provider stay there), so no information is lost and there is no fourth
  tab to maintain.

Context tab layout (two-column grid on wide drawers, one column under ~380px):

| Left | Right |
| --- | --- |
| Session name | Messages (total) |
| Provider | User messages |
| Model | Assistant messages |
| Context limit (`windowTokens`, or `–`) | Total tokens |
| Usage % (+ bar, `~` when estimated) | Input tokens |
| Output tokens | Cache tokens (read/write) |
| Thinking (`~` estimate from thought chars, only when thoughts exist) | Total cost |
| Session created | Last activity |

Below the grid: **Raw messages**, one expandable row per turn (`role · #id · timestamp ·
tokens`), with a content preview and an "Inspect turn" action that selects that turn and
switches to Steps. The existing "Export session" action stays reachable from the tab
header (reuse `ChatExportMenu`).

Data sources, no new server endpoint:
- Session name / created / last activity: `$chatStore` session row.
- Provider / model: `session.agentConfig`, falling back to the inspected turn.
- Context limit / usage: `latestContext(turns)` (already persisted).
- Total / input / output tokens and cost: server `totals` (input/output only when
  `splitComplete`; otherwise `splitTokens` marks the display `~`).
- Cache tokens: sum `turn.usage.calls[].cacheReadTokensIn` / `cacheCreationTokensIn`
  across loaded turns; mark `~` when some assistant turns have no per-call usage.
- Thinking estimate: sum persisted `reasoningSteps[].thought` lengths and run
  `charsToTokens`; label `~` and omit the row at zero.
- Messages: `turns` length and role counts.
- Live turn: if a turn is streaming, its `liveTokens`/live split override the persisted
  totals for the duration (same rule `sessionCostSummary` already uses).

The compact `ChatContextMeter` popover stays for a one-glance read, but gains an
**Open context panel** footer action that opens the inspector on the Context tab. The
per-turn `Trace` menu opens the inspector on Steps (not the old overview).



- All new event/fields are optional and additive. Old consumers ignore them.
- `StreamCompleted.metadata` already carries `inputTokens` / `outputTokens`; no shape change.
- `ContextPressure` shape unchanged; `ChatContext` only gains an optional flag.
- `StoredContext` and its exact `toEqual` assertions in
  `apps/cortex/server/tests/chat-context-persist.test.ts` stay untouched.
- `TurnTrace` gains only an optional `usage`; existing persisted traces remain valid.
- DB migration uses the existing `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` pattern.
- Scoping checks assume `SubAgentActivity` wrapping works unchanged: a child's `TokenUsage`
  folds into that child's trace, never the parent turn's totals.

---

## Task list

Execute in order. One concern per commit. No `Co-Authored-By` trailers.

### Task 0 — Baseline

- `bun run repo status` (expect `branch dev | 0 dirty`).
- `bun run repo test packages/runtime/tests/context-pressure-stream.test.ts packages/ui-core/tests/turn-trace.test.ts apps/cortex/server/tests/chat-context-persist.test.ts apps/cortex/ui/src/lib/stores/chat-stream.subagents.test.ts`
- If anything is already red, stop and report; do not carry a pre-existing failure into this work.

### Task 1 — Core event carries `iteration` + cache write

Files:
- `packages/core/src/types/events/core-events.ts`

Change: add `readonly iteration?: number;` and
`readonly cacheCreationTokensIn?: number;` to the `LLMRequestCompleted` variant with JSDoc
lines: the reasoning iteration that issued the call, and provider cache-write tokens,
both absent on older publishers.

Test:
- No new test file. Covered by Task 2's assertions in
  `packages/reasoning/tests/kernel/llm-request-completed.test.ts`.

Commit: `core(events): carry iteration and cache write on LLMRequestCompleted`

### Task 2 — Reasoning stamps `iteration` (red → green)

Files:
- `packages/reasoning/src/kernel/utils/diagnostics.ts`
- `packages/reasoning/src/kernel/utils/llm-request-completed.test.ts`

Red: in `llm-request-completed.test.ts`, add to the "carries billed tokens..." test:
`expect(completed?.iteration).toBe(3)` and
`expect(completed?.cacheCreationTokensIn).toBe(1_000)` (the test response must add
`cacheCreationTokensIn: 1_000`).

Green: add `iteration: args.iteration,` and
`...(typeof args.response.cacheCreationTokensIn === "number" ? { cacheCreationTokensIn: args.response.cacheCreationTokensIn } : {})`
to the `_tag: "LLMRequestCompleted"` publish.

Run:
`bun run repo test packages/reasoning/src/kernel/utils/llm-request-completed.test.ts`

Commit: `reasoning(diagnostics): stamp iteration and cache write on LLMRequestCompleted`

### Task 3 — Runtime `TokenUsage` stream event + projection

Files:
- `packages/runtime/src/stream-types.ts`
- `packages/runtime/src/engine/token-usage-stream.ts` (new)
- `packages/runtime/src/engine/execute-stream.ts`
- `packages/runtime/tests/token-usage-stream.test.ts` (new)

Red: new test mirrors `context-pressure-stream.test.ts`:

```ts
import { toTokenUsageStreamEvent } from "../src/engine/token-usage-stream.js";

const bus = {
  _tag: "LLMRequestCompleted",
  taskId: "t1",
  requestId: "req-1",
  model: "m",
  provider: "anthropic",
  durationMs: 120,
  tokensUsed: 1500,
  tokensIn: 1000,
  tokensOut: 500,
  cacheReadTokensIn: 900,
  cacheCreationTokensIn: 0,
  estimatedCost: 0.01,
  iteration: 2,
};
```

Assertions:
- matching task id → `{_tag:"TokenUsage", callId:"req-1", tokensIn:1000, tokensOut:500, tokensTotal:1500, estimated:false, cacheReadTokensIn:900, ...}`
- missing `cacheCreationTokensIn` → field absent (never fabricated as 0)
- missing `tokensIn` → `estimated: true`, `tokensIn` absent, total still 1500
- missing `tokensOut` same
- other task id / non-numeric `tokensUsed` / non-string `requestId` → `undefined`
- source gate: `yield* subscribe("LLMRequestCompleted", "TokenUsage"` sits inside an
  `if (eb && density === "full") {` block (copy the `lastIndexOf` assertion style).

Green: `toTokenUsageStreamEvent(busEvent, taskId)` returns the stream variant or
`undefined`. `estimated = !(number(tokensIn) && number(tokensOut))`. Cache fields are
copied only when numeric.

Wire in `execute-stream.ts` immediately after the `ContextPressure` subscription, inside
the same full-density block:

```ts
yield* subscribe("LLMRequestCompleted", "TokenUsage", (event) =>
  toTokenUsageStreamEvent(event, String(event.taskId ?? "")),
);
```

Run:
`bun run repo test packages/runtime/tests/token-usage-stream.test.ts packages/runtime/tests/context-pressure-stream.test.ts`

Commit: `runtime(stream): project provider token usage as TokenUsage`

### Task 4 — ui-core wire event, split helper, turn fold, persistence

Files:
- `packages/ui-core/src/protocol/events.ts`
- `packages/ui-core/src/state/token-usage.ts` (new)
- `packages/ui-core/src/state/turn-trace.ts`
- `packages/ui-core/src/index.ts` (export the new helpers/types if not already wildcard)
- `packages/ui-core/tests/token-usage.test.ts` (new)
- `packages/ui-core/tests/turn-trace.test.ts`

Red 1 — `token-usage.test.ts`:
- both halves → unchanged, `estimated: false`
- only input → output = total - input, `estimated: true`
- only output → input = total - output, `estimated: true`
- neither → 70/30, `estimated: true`
- total 0 → zeros, `estimated: true`
- `charsToTokens(0) === 0`, `charsToTokens(1) === 1`, `charsToTokens(5) === 2`

Red 2 — `turn-trace.test.ts`:
- folding two `TokenUsage` events yields `usage.calls.length === 2`, summed
  `tokensIn`/`tokensOut`/`tokensTotal`, `estimated === false`
- mixed call lacking a split marks `usage.estimated === true` but does not invent
  per-call halves
- duplicate `callId` does not duplicate the call
- cache figures sum across calls; a call without cache fields adds 0 and never invents a
  write figure
- `finishTurnTrace` keeps `usage` even when there are no thoughts/tools, and returns it
  unchanged on a fresh fold with no usage
- a `SubAgentActivity` carrying `TokenUsage` folds into the child trace, not the parent
  usage (use the existing sub-agent fixture style)

Green:
- `TokenUsage` interface in `protocol/events.ts` (exact mirror of the runtime variant) and
  add it to the `UiStreamEvent` union. Additive tag; no `PROTOCOL_VERSION` bump.
- `token-usage.ts` with `TokenSplit`, `splitTokens`, `charsToTokens`, `CallUsage`,
  `TurnUsage`, `summarizeUsage`.
- `turn-trace.ts`: `TurnTraceState.usage?: TurnUsage`; fold case `"TokenUsage"`;
  `TurnTrace.usage?: TurnUsage`; `finishTurnTrace` includes it and no longer returns
  `undefined` when the only content is usage calls.

Run:
`bun run repo test packages/ui-core/tests/token-usage.test.ts packages/ui-core/tests/turn-trace.test.ts`

Commit: `ui-core(stream): fold and persist per-call TokenUsage`

### Task 5 — Final split on the direct chat path

Files:
- `packages/runtime/src/chat.ts`
- `packages/runtime/src/chat/engine.ts`
- `packages/runtime/src/chat/tool-reply.ts`
- `packages/runtime/src/agent/chat-capabilities.ts`
- `packages/runtime/tests/chat-direct-token-split.test.ts` (new)

Red: unit-test `makeChatComplete`'s mapping is hard to isolate (it runs a real Effect
runtime), so test `ChatEngine.turn()` with a stub `complete` capability instead:

- `complete` returns `{ message: "hi", tokens: 1500, inputTokens: 1000, outputTokens: 500, cost: 0 }`
- `engine.turn("hello")` returns `ChatReply.inputTokens === 1000` and `.outputTokens === 500`
- a stub returning only `tokens` leaves both absent (no fabricated split)

Also add one assertion in an existing tool-path test (or a small new test) that
`assembleToolReply` copies `result.metadata.inputTokens` / `outputTokens` when present.

Green:
- `ChatReply`: `inputTokens?: number`, `outputTokens?: number` with JSDoc.
- `ChatEngineCapabilities.complete` return type: add the optional halves.
- `makeChatComplete`: map `response.usage?.inputTokens` / `outputTokens`.
- `assembleToolReply`: copy `result.metadata.inputTokens` / `outputTokens`.
- `ChatEngine.turn` already returns the capability reply verbatim; no extra wiring.

Run:
`bun run repo test packages/runtime/tests/chat-direct-token-split.test.ts packages/runtime/tests/chat-engine-stream-record.test.ts`

Commit: `runtime(chat): expose provider input/output split on ChatReply`

### Task 6 — Cortex server: columns, persistence, totals

Files:
- `apps/cortex/server/db/schema.ts`
- `apps/cortex/server/db/chat-queries.ts`
- `apps/cortex/server/services/chat-session-service.ts`
- `apps/cortex/server/tests/chat-token-split.test.ts` (new)

Schema migration (after the `context_json` block):

```ts
if (!chatTurnCols.includes("tokens_in")) {
  db.exec("ALTER TABLE cortex_chat_turns ADD COLUMN tokens_in INTEGER");
}
if (!chatTurnCols.includes("tokens_out")) {
  db.exec("ALTER TABLE cortex_chat_turns ADD COLUMN tokens_out INTEGER");
}
```

`chat-queries.ts`:
- `ChatTurnRow`: `tokensIn?: number`, `tokensOut?: number`.
- `appendChatTurn` input: optional halves; INSERT includes both columns; `null` when
  absent.
- `getChatTurns` SELECT includes both; row mapping returns them only when numbers.
- `copyChatTurns` SELECT/INSERT includes both.
- Compaction: both summary UPDATEs set `tokens_in = NULL, tokens_out = NULL` (the collapsed
  row keeps `tokens_used`/`cost_usd`; a split cannot be attributed to the summary).
- `ChatSessionTotals` becomes
  `{ tokens: number; tokensIn: number; tokensOut: number; splitComplete: boolean; costUsd: number; costKnown: boolean }`.
  `getChatSessionTotals`: sum `tokens_in`/`tokens_out` with `COALESCE(SUM(tokens_in), 0)`;
  `splitComplete` = no assistant row with `tokens_used > 0` and either split column NULL:

```sql
SELECT COALESCE(SUM(tokens_used),0) AS tokens,
       COALESCE(SUM(tokens_in),0) AS tokens_in,
       COALESCE(SUM(tokens_out),0) AS tokens_out,
       COALESCE(SUM(CASE WHEN role = 'assistant' AND tokens_used > 0
                         AND (tokens_in IS NULL OR tokens_out IS NULL) THEN 1 ELSE 0 END),0) AS incomplete_splits,
       COALESCE(SUM(cost_usd),0) AS cost,
       COALESCE(MIN(cost_known),1) AS known
FROM cortex_chat_turns WHERE session_id = ?
```

`splitComplete = incomplete_splits === 0`. Note: a session with zero assistant turns is
"complete" with 0/0; the UI hides the rows when `tokens === 0`.

`chat-session-service.ts`:
- `persistTurn` gains a trailing optional `split?: { inputTokens?: number; outputTokens?: number }`
  and forwards to `appendChatTurn`.
- Direct path (`chat()` and `chatStream()`'s no-tools branch): pass
  `{ inputTokens: chatReply.inputTokens, outputTokens: chatReply.outputTokens }`.
- Streaming path: capture `event.metadata?.inputTokens` / `outputTokens` on
  `StreamCompleted`; pass them to `persistTurn`.
- Never derive a split server-side; only persist reported numbers.

Red (`chat-token-split.test.ts`), reuse the fake `runStream` harness from
`chat-context-persist.test.ts`:
1. `openDatabase(":memory:")` on an old-shaped table still migrates (call
   `openDatabase` twice; second open must not throw).
2. `appendChatTurn` + `getChatTurns` round-trip `tokensIn`/`tokensOut`; absent stays absent.
3. `getChatSessionTotals` sums halves, `splitComplete: true` when every assistant turn has
   both, `false` when one lacks a half.
4. Streaming turn whose `StreamCompleted.metadata` has `{ tokensUsed: 1500, inputTokens: 1000, outputTokens: 500 }`
   persists both on the assistant row.
5. Direct no-tools turn with a `ChatReply` split persists both.
6. A streaming turn with `TokenUsage` events persists `trace.usage.calls` with the per-call
   evidence (the recorder fold already does this once Task 4 lands).
7. Existing `chat-context-persist.test.ts` still passes unchanged.

Run:
`bun run repo test apps/cortex/server/tests/chat-token-split.test.ts apps/cortex/server/tests/chat-context-persist.test.ts apps/cortex/server/tests/chat-turn-trace.test.ts apps/cortex/server/tests/chat-queries.test.ts`

Commit: `cortex(chat): persist provider token split per turn`

### Task 7 — Cortex UI data model + live reducer

Files:
- `apps/cortex/ui/src/lib/stores/chat-store.ts`
- `apps/cortex/ui/src/lib/stores/chat-stream.ts`
- `apps/cortex/ui/src/lib/stores/chat-cost.ts`
- `apps/cortex/ui/src/lib/chat-context.ts`
- `apps/cortex/ui/src/lib/stores/chat-stream.tokens.test.ts` (new)

Red (`chat-stream.tokens.test.ts`, reuse the fake-SSE `run()` harness):
- two `TokenUsage` events (1000/500 and 800/200) → `turn.usage?.calls.length === 2`,
  `liveTokens === 2500`
- a `TokenUsage` with only `tokensTotal` → call `estimated: true`; `liveTokens` still the
  reported total
- `TextDelta` "abcdefgh" with no prior call → `liveTokens === 2` (estimate, and the surface
  is allowed to show it because `turn.streaming` is true)
- `ContextPressure` `{tokensUsed:1000,tokensAvailable:3000,utilizationPct:25,level:"low"}`
  → `turn.context` is measured (`estimated` false/absent)
- `TokenUsage` after that with `tokensIn: 1200` → context `tokensUsed > 1200` when output
  is counted, `estimated: true`, window still 4000
- `TextDelta` after a measured context → context grows by `charsToTokens`, `estimated: true`,
  window unchanged
- `StreamCompleted.metadata` `{tokensUsed:1500,inputTokens:1000,outputTokens:500}` →
  `tokensUsed:1500`, `tokensIn:1000`, `tokensOut:500`, `liveTokens` cleared
- no `ContextPressure` ever → `turn.context` stays undefined (no invented percentage)

Green:
- `ChatTurn`: `tokensIn?`, `tokensOut?`, `usage?: TurnUsage` (import type from ui-core).
- `ChatContext`: `estimated?: boolean`.
- `PersistedTrace`: `usage?: TurnUsage`; `hydrateTurn` restores `usage`.
- `chat-stream.ts`:
  - keep `basePromptTokens` and `windowTokens` in reducer state
  - `TokenUsage` → `trace = foldTurnTrace(...)`, set `liveTokens` to the folded
    `trace.usage.tokensTotal`, update `liveCost` when `estimatedCost > 0`, update the
    estimated context as described
  - `TextDelta` → after folding, update `liveTokens` and estimated context from
    `charsToTokens(live text length)`; never overwrite the provider total with an estimate
    once `TokenUsage` exists for the current call (use `max(providerTotal, estimate)` only
    while streaming, and the provider total on completion)
  - `ContextPressure` → measured context, reset `basePromptTokens`
  - `StreamCompleted` → set final `tokensUsed` and split from metadata
- `sessionCostSummary` unchanged (it already adds `liveTokens` for streaming turns).
- `chat-context.ts` unchanged unless typing requires re-export.

Run:
`bun run repo test apps/cortex/ui/src/lib/stores/chat-stream.tokens.test.ts apps/cortex/ui/src/lib/stores/chat-stream.subagents.test.ts apps/cortex/ui/src/lib/stores/chat-cost.test.ts apps/cortex/ui/src/lib/chat-context.test.ts`

Commit: `cortex(ui): fold live TokenUsage into the streaming turn`

### Task 8 — Token strip + split-aware context meter quick peek

Files:
- `apps/cortex/ui/src/lib/chat-token-usage.ts` (new pure helpers)
- `apps/cortex/ui/src/lib/chat-token-usage.test.ts` (new)
- `apps/cortex/ui/src/lib/components/ChatTokenUsage.svelte` (new)
- `apps/cortex/ui/src/lib/components/ChatContextMeter.svelte`
- `apps/cortex/ui/src/lib/components/ChatPanel.svelte`

Red (`chat-token-usage.test.ts`) — pure geometry, no Svelte mount:
- `tokenBars(calls)` with calls `[1000/500, 400/100]` returns two bars, widths
  proportional to `total / maxTotal`, segments split by `in/out`
- calls beyond `MAX_BARS = 24` collapse into a trailing `overflow` count; the visible
  bars are the LAST 24 (recent activity wins)
- a call with `tokensTotal: 0` produces a zero-width bar, not `NaN`
- `tokenRangeLabel(usage)` returns `"1.2k in · 340 out"` style strings and prefixes `~`
  when `estimated`

Green:
- `ChatTokenUsage.svelte` props:
  `{ usage?: TurnUsage; tokensUsed: number; tokensIn?: number; tokensOut?: number; streaming: boolean }`
  - Inline line: `~1.2k in · 340 out` (or `~` on the whole pair when estimated), plus a
    subtle `n calls` label.
  - Strip: one stacked bar per call, input segment in cyan, output in violet (existing
    `--ra-cyan` and primary tokens), `title` with call index + measured/estimated marker.
  - When `streaming` and no call has completed, show `~<live> tok` pulse.
  - No D3. No chart library.
- `ChatContextMeter.svelte`:
  - `ChatContext` row shows `~` before the used number when `context.estimated`.
  - Popover rows add:
    - `Session input` / `Session output` from new totals, only when
      `totals.tokens > 0`; `~` prefix when `!splitComplete`.
    - `Last reply in` / `Last reply out` from `splitTokens(last.tokensIn, last.tokensOut, last.tokens)`.
  - Widen `last` prop type with `tokensIn?`, `tokensOut?`.
  - Add `onOpenPanel?: () => void`; a footer button "Open context panel" calls it.
  - The ring itself already animates `stroke-dashoffset`; keep it.
- `ChatPanel.svelte`:
  - Replace the `turn.streaming && liveTokens` and `turn.tokensUsed` spans with
    `<ChatTokenUsage ... />` (keep `steps`, `cancelled`, `runFailed` chips).
  - Pass `tokensIn` / `tokensOut` / `usage` from the turn.
  - `lastReply` derived includes `tokensIn`/`tokensOut`.
  - `ChatContextMeter` receives `sessionTokensIn`, `sessionTokensOut`,
    `splitComplete` from `$chatStore.activeTotals` (with a safe default before load) and
    opens the inspector on Context via `onOpenPanel`.

Run:
`bun run repo test apps/cortex/ui/src/lib/chat-token-usage.test.ts apps/cortex/ui/src/lib/stores/chat-stream.tokens.test.ts`
`cd apps/cortex/ui && bun run build`

Commit: `cortex(ui): live token strip and split-aware context meter`

### Task 9 — Consolidated inspector with an OpenCode-style Context tab

Files:
- `apps/cortex/ui/src/lib/chat-session-context.ts` (new pure model builder)
- `apps/cortex/ui/src/lib/chat-session-context.test.ts` (new)
- `apps/cortex/ui/src/lib/components/ChatTraceDrawer.svelte`
- `apps/cortex/ui/src/lib/components/ChatPanel.svelte`

Red (`chat-session-context.test.ts`) — pure function, no Svelte mount. Build
`buildSessionContext({ session, totals, turns, latestContext })` and assert:
- counts: total/user/assistant messages, including a streaming assistant turn
- tokens: total from `totals.tokens`; input/output reported when `splitComplete`, else
  `splitTokens` marks them `~`
- context limit and usage % from `latestContext`; `~` when `estimated`, `–` when absent
- cache read/write sums from `turn.usage.calls`; a turn without usage sets
  `cachePartial: true` (display `~`) but never invents a number
- thinking estimate sums `reasoningSteps[].thought` lengths with `charsToTokens`; zero
  when no thoughts
- cost uses `formatCost(totals.costUsd, totals.costKnown)`
- created / last activity are the session timestamps; missing session yields `–`
- a streaming turn's `liveTokens` overrides the persisted total for that display only

Green:
- `ChatTraceDrawer.svelte`:
  - `type Tab = "context" | "steps" | "trace"`; `TABS = Context, Steps, Run trace`;
    default `context`.
  - Rename the header to **Inspector**; keep the close/resize behavior.
  - New props: `session?: ChatSession`, `totals?: ChatTotals`, `turns: readonly ChatTurn[]`,
    `initialTab?: Tab`, `onSelectTurn?: (id: number) => void`.
  - Context tab: render the model from `buildSessionContext` as the two-column grid from
    Design §7, plus the Context window bar (`~` when estimated) and a **Raw messages**
    section. Each row is a `<details>` with role, id, timestamp, tokens, a content preview
    (first ~400 chars) and an "Inspect turn" button calling `onSelectTurn(turn.id)`.
  - Steps and Run trace tabs use the selected turn (existing `turn` prop). Add a compact
    turn selector (`<select>`) above those two tabs listing assistant turns as
    `#id · time · tokens`, so the new raw-message selection is not the only way in.
  - Delete the old `overview` tab and its `rows` derivation; its Run/Usage/Model content
    is now part of Context. Keep the existing run-trace fetch effect (`tab === "trace"`).
  - Import `splitTokens` / `charsToTokens` from `@reactive-agents/ui-core`; do not
    re-implement them.
- `ChatPanel.svelte`:
  - Add `inspectorInitialTab = $state<"context" | "steps" | "trace">("context")`.
  - `ChatContextMeter.onOpenPanel` sets it to `"context"` and opens the drawer.
  - The per-turn `Trace` menu sets it to `"steps"` (not overview) before opening.
  - Pass `session`, `totals`, `turns`, `initialTab`, and `onSelectTurn` (sets
    `traceTurnId`, switches to Steps) to the drawer.
  - Keep the drawer mounted only while open so `initialTab` is read on each open.

Run:
`bun run repo test apps/cortex/ui/src/lib/chat-session-context.test.ts apps/cortex/ui/src/lib/chat-token-usage.test.ts`
`cd apps/cortex/ui && bun run build`

Commit: `cortex(ui): consolidate usage into an inspector Context tab`

### Task 10 — docs + changeset

Files:
- `apps/docs/src/content/docs/features/streaming.md`
- `apps/docs/src/content/docs/reference/builder-api.md`
- `apps/docs/src/content/docs/features/cortex.mdx`
- `.changeset/<name>.md`

Changes:
- `streaming.md`: add `TokenUsage` to the union sketch and the full-density table; add a
  short "Live token usage" section stating the honesty rule (`~` = estimate, provider wins,
  no fabricated window).
- `builder-api.md`: add the `TokenUsage` row to the stream-event table.
- `cortex.mdx`: the context meter reads `ContextPressure` for the measured ring and
  `TokenUsage` for live in/out; estimates are marked `~`. Describe the Inspector Context
  tab as the place for session/turn usage, cache tokens and raw messages.
- Changeset: minor for `@reactive-agents/runtime` and `@reactive-agents/ui-core`
  (new additive event/tag); note Cortex behavior in the body.

Commit: `docs(streaming): document TokenUsage and live split rules`

### Task 11 — Verification sweep

Run in this order, stop on the first failure:

1. `bun run repo test packages/runtime/tests/token-usage-stream.test.ts packages/runtime/tests/context-pressure-stream.test.ts packages/runtime/tests/chat-direct-token-split.test.ts`
2. `bun run repo test packages/ui-core/tests/token-usage.test.ts packages/ui-core/tests/turn-trace.test.ts`
3. `bun run repo test apps/cortex/server/tests/chat-token-split.test.ts apps/cortex/server/tests/chat-context-persist.test.ts apps/cortex/server/tests/chat-turn-trace.test.ts apps/cortex/server/tests/chat-queries.test.ts`
4. `bun run repo test apps/cortex/ui/src/lib/chat-token-usage.test.ts apps/cortex/ui/src/lib/chat-session-context.test.ts apps/cortex/ui/src/lib/stores/chat-stream.tokens.test.ts apps/cortex/ui/src/lib/stores/chat-stream.subagents.test.ts apps/cortex/ui/src/lib/chat-context.test.ts`
5. `bun run repo verify packages/runtime`
6. `bun run repo verify packages/ui-core`
7. `bun run repo verify packages/reasoning`
8. `bun run repo verify packages/core`
9. `bun run repo verify apps/cortex` (if registered; otherwise server tests + UI build)
10. `cd apps/cortex/ui && bun run build`
11. `bun run repo check --all`

Manual smoke (after `bun run build:packages && cd apps/cortex && bun start`):
- tool-enabled chat turn: input/output counters appear while streaming, per-call bars
  appear as calls complete, ring moves between provider readings, final split matches
  `StreamCompleted.metadata`
- no-tools chat turn: text appears at once, final split appears, no live bars
- reload: final split and per-call strip survive; measured ring survives
- old session with no split columns: renders `~` split, no crash
- sub-agent turn: child usage stays inside the child block; parent totals unchanged
- Inspector: opens on Context by default; the grid matches the session row and totals;
  raw messages expand and "Inspect turn" jumps to Steps for that turn; the turn selector
  works for both Steps and Run trace; context-meter "Open context panel" lands on Context
- a session where one turn lacks a split: session input/output show `~`, never a hard
  number derived from the total

---

## Rollback

Each task is independently revertible in order. The DB columns are additive; leaving them
in place after a code revert is safe (old queries ignore them). The new stream tag is
additive; old UI ignores it and falls back to `tokensUsed`.

---

## Open questions / future work

- Anthropic cache reads: `LLMRequestCompleted.cacheReadTokensIn` is available but not shown
  in the strip. A follow-up can add a third segment (`cached`) without changing the tag.
- The direct path could stream with `LLMService.stream` later; when it does, it should emit
  the same `TokenUsage` shape so the UI needs no second branch.
- Session split completeness compares per-turn nullability; a future migration can backfill
  historical splits from traces (`llm-exchange` response already has `tokensIn`/`tokensOut`).
