# Context-Window Pollution Findings — 2026-04-22

Companion to `improvement-report-20260422-memory-1.md`. Captures hypotheses about what bloats the model's context, marked by evidence tier so next pass doesn't treat speculation as fact.

---

## Evidence tiers used

- **CONFIRMED** — verified by probe output, trace JSONL event, or single-call code path inspection that can't be ambiguous.
- **STRONG HYPOTHESIS** — code path identified, plausible impact, but token cost not yet measured on a real request.
- **SPECULATIVE** — code smell only. Needs a falsifying measurement before acting.

Don't ship fixes from STRONG HYPOTHESIS or SPECULATIVE items without first adding a decomposition probe that shows the bytes.

---

## P1 — Message window compaction never fires for default `.withReasoning()` users

**Evidence tier:** STRONG HYPOTHESIS

**Where:** `packages/reasoning/src/context/message-window.ts:56-59`

```ts
const budget = Math.floor(maxTokens * 0.75)
if (estimatedTokens <= budget) return mutable
```

`maxTokens` comes from `contextProfile.maxTokens`. If no `contextProfile` is passed (the default for `.withReasoning()` without an explicit profile), the caller at `context-utils.ts:139-140` falls back to `Number.MAX_SAFE_INTEGER`. Budget becomes infinite → compaction condition is never true → the sliding window is dead code for the default path.

**Why only STRONG HYPOTHESIS:** I haven't verified what `contextProfile` is actually resolved to on the `.withReasoning()` code path. `context-profile.ts` may supply a per-tier default (32k/100k/etc.) that kicks in before reaching this site. One logged `estimatedTokens`/`budget` pair from a running probe settles it in 2 minutes.

**If confirmed:** local-tier default should be ~16k, mid ~32k, large ~100k, frontier ~200k, so compaction fires at ~75% of those.

---

## P2 — Tool schemas likely duplicated when native FC is active

**Evidence tier:** STRONG HYPOTHESIS

**Where:**
- `packages/reasoning/src/context/context-engine.ts:61-62` — `buildToolReference` inserts a full `Available Tools:` block into the system prompt on every iteration.
- `packages/reasoning/src/strategies/kernel/phases/think.ts:212+` — `filteredToolSchemas` is passed to the provider's native FC `tools` parameter.

Both paths fire. On native FC, the provider's `tools` parameter is the authoritative schema — the system prompt's `Available Tools:` block is redundant.

**Why only STRONG HYPOTHESIS:** some providers may dedupe or cache across the two representations. Anthropic's prompt cache might make the system-prompt block free after the first call. Ollama likely doesn't cache. One request body dump settles it.

**If confirmed:** when `useNativeFC === true`, omit the `Available Tools:` block (or degrade to `names-only`). Estimate: 200-500 tokens saved per iteration on a 10-tool agent.

---

## P3 — `buildPriorWorkSection` iterates ALL observation steps with no cap

**Evidence tier:** STRONG HYPOTHESIS

**Where:** `packages/reasoning/src/context/context-manager.ts:339-349`

```ts
for (const step of state.steps) {
  if (step.type !== "observation") continue;
  const fact = step.metadata?.extractedFact as string | undefined;
  if (fact) facts.push(`- ${fact}`);
}
```

No recency window. No deduplication. On a 15-observation run, 15 extracted-fact lines render every iteration.

**Why only STRONG HYPOTHESIS:** `extractedFact` may already be short (think.ts's extractor produces single-sentence summaries). If each is ~100 chars, 15 × 100 × 15 iter ≈ 22k chars total across a run — meaningful but not catastrophic.

**Fix direction:** cap to last N=5 for local tier, N=8 for mid, N=unlimited for frontier. Dedupe by content hash.

---

## P4 — `[STORED: key | tool]` header stripped from compressed observations

**Evidence tier:** CONFIRMED (same finding as W7 in main report)

**Where:** `packages/reasoning/src/strategies/kernel/utils/tool-execution.ts:607`

```ts
.replace(/^\[STORED: [^\]]+\]\n?/m, `[${toolCall.name} result — compressed preview]\n`)
```

The key IS re-appended at line 618 (`— full text is stored. Use recall("${storedKey}") to retrieve.`), but:
- The `act.ts:939` completion nudge still references the stripped header by name.
- qwen3:14b did not call `recall` once in memory-recall-invocation probe despite explicit task instruction.

This is pollution by contradiction: the framework tells the model to look at a header that doesn't exist.

**Fix direction (see IC-6 in main report):** don't strip the header. Keep it as the first line.

---

## P5 — Static context rebuilt every iteration

**Evidence tier:** STRONG HYPOTHESIS (low impact)

**Where:** `context-engine.ts:buildStaticContext` — environment, tools, task, rules — rebuilt every turn.

Tokens themselves are identical across iterations. On providers with prompt caching (Anthropic, OpenAI w/ cached prefixes, Claude API ≥2024-08), this is free. On Ollama, every token is re-paid.

**Fix direction:** mark static context as a cache prefix if the provider supports it; otherwise accept as tax.

---

## P6 — Adapter `toolGuidance` patch added on every iteration

**Evidence tier:** SPECULATIVE

**Where:** `context-manager.ts:229-237`

Adapter can return long guidance text. Appended to static context every iteration. Haven't measured actual patch length per provider.

---

## P7 — `taskFraming` may replace the seed user message on iter 0

**Evidence tier:** SPECULATIVE (behavior understood, cost unmeasured)

**Where:** `context-utils.ts:151-158`

If the adapter returns a framed task, the first user message is replaced with the framed version. That framing now lives in `state.messages` forever — every iteration replays it. If the framing adds 500 chars, that's 500 × N iter worth of re-sends.

---

## P8 — `buildProgressSection` tool list grows monotonically

**Evidence tier:** CONFIRMED (but low impact)

**Where:** `context-manager.ts:320-323` — `state.toolsUsed` is a `Set`, never shrinks. On a 5-distinct-tools run, `Tools called: web-search, http-get, recall, checkpoint, find` appears every iteration.

Small (~50 bytes) but cumulative.

---

## P9 — Failed tool observations persist verbatim in state.messages

**Evidence tier:** STRONG HYPOTHESIS

Failed tool calls leave `[Tool error: X]` content in both `state.steps` and the `tool_result` message appended to `state.messages`. Never summarized, never elided. The model re-reads every past failure on every iteration.

From the probe runs: memory-recall-invocation had 5 iterations and 1 recall error. If the recall error text is ~80 bytes, 5 replays cost 400 bytes — small, but the **pattern** repeats across every run with a tool failure.

**Fix direction:** after N iterations, summarize failed tool observations in prior-work as `- failed: recall(_tool_result_1)` instead of leaving the full error text in messages.

---

## Priority ranking — what I'd measure FIRST before fixing

1. **One request-body dump from iter 0 vs iter 3 of scratch.ts.** Count schema-related tokens. Settles P2.
2. **Console.log of `estimatedTokens` and `budget` inside `applyMessageWindowWithCompact` during any probe.** Settles P1.
3. **Count `extractedFact` lines in the rendered prior-work section for memory-multi-observation-synthesis (7-step run).** Settles P3 impact.

Do not ship P1-P9 fixes before those three measurements exist as artifacts in `harness-reports/`.

---

## What's already in the main report

- W7 (recall invocation failure) covers P4.
- W9 (4-layer memory not wired to tool observations) is architectural context for why the pollution matters — even if we compress better, the semantic store is still empty.
- IC-7 (auto-inject task-relevant scratchpad entries) is the *correct long-term fix* because it removes the need to preserve full observations in the message thread at all: the system prompt carries the curated slice, the message thread can drop stale tool_result content entirely.

Ship IC-6 + IC-7 + IC-8 first (main report). Revisit these pollution fixes after — by then the message thread may be less bloated and the priority list will shrink.
