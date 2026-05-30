---
title: Context Curation Architecture — the optimal-stream root
date: 2026-05-30
status: rfc
priority: "ROOT — Spike 1 of the meta-tool initiative; recall-removal is downstream of this"
research:
  - "[[2026-05-30-harness-engineering-canon]]"
  - "[[2026-05-30-meta-tool-redesign-initiative]]"
  - "[[2026-05-30-recall-redesign-automatic-rehydration]]"
sources:
  - "Anthropic — Effective Context Engineering for AI Agents (2025-09): tool-result clearing, compaction, JIT retrieval, smallest-high-signal set, context rot"
  - "Manus — Context Engineering Lessons (2025-07): reversible compression w/ pointers, recitation, KV-cache stability, recency"
  - "12-Factor Agents: own your context window, stateless reducer over an event log"
  - "Chroma — Context Rot; RULER (from agentic-context-engineering-findings)"
---

# Context Curation Architecture

## Thesis (the north star)
**Even small models are powerful when context is presented optimally** — an
easy-to-reason-about stream that maximizes each model's chance of producing the
**right response type** (a tool call, or a prose answer in a specific style, or a
concrete deliverable). The harness's job is to **get out of the way** and intervene
**only when intervention creates optimal value** — never to trip the model up. Follow
known-good algorithms; don't invent machinery the model must reason around.

## The current failure (root, evidence-backed)
RA compresses **every tool result the moment it is produced, before the model sees it
this turn** (`act/tool-execution.ts` → the `tool_result` message content is the
compressed preview; the full payload is pulled OUT to a recall key `_tool_result_N`).
Char budgets (`context-profile.ts`): default 4000/8, mid 1200/5, large 800, **frontier
600/3**.

- The model synthesizes from a **600–4000-char preview**, not the data → low
  faithfulness, fabrication (the documented "summarized all 15, fabricated 7 titles"),
  and "the results were truncated, let me retrieve the full content" loops (sonnet T3,
  600-char frontier budget).
- **`recall` exists only to fetch back what this compression discarded** → invented
  keys, recall-as-file-write. The recall failure mode is a *symptom*; this curation is
  the *disease*.
- The budget is **inverted vs window size** (frontier/sonnet 200k window → 600 chars;
  the biggest-window model gets the smallest result). It is recency-blind (the
  current synthesis-target is crushed as hard as ancient history) and window-blind.

Contrast (Claude Code): the **current** tool result stays **full** in the message
array; only **old, deep-history** results are compacted, to a deterministic
re-readable pointer — never an invented key. The canon says exactly this:
*"tool-result clearing — drop the bulky payload deep in HISTORY, keep the tool_use
record."* Clear **old**, not **current**. RA inverted it.

## The known-good curation algorithm (research-derived)
The message stream the model sees each turn, in order:

1. **System instructions** (stable prefix — KV-cache friendly; never reorder).
2. **Goal + remaining-state in the RECENCY span** (the PostCondition ledger from
   Phase 1/2) — recitation counters lost-in-the-middle. *(Manus, 12-factor.)*
3. **Current + recent tool results: FULL**, up to a recency budget **scaled to the
   model's actual context window** (sonnet 200k → keep ~everything; tiny local → tighter
   but the current synthesis-target stays intact). The model must always be able to
   synthesize from real data. *(Anthropic smallest-high-signal set, but applied by AGE
   not blanket.)*
4. **Aged tool results: progressively cleared** to a reversible, deterministic pointer
   (drop the body, keep the `tool_use` record + a `ref` the SYSTEM can re-expand). This
   is where compression belongs. *(Anthropic tool-result clearing; Manus reversible
   compression.)*
5. **Auto-re-hydration (obviates recall):** when an aged/pointer'd result becomes
   relevant again (the model's current focus references it), the curator re-expands it
   into recency automatically — **no model action, no invented key**. *(Anthropic JIT,
   but system-driven via deterministic refs.)*
6. **Compaction near the window limit:** high-fidelity summarize old turns and
   reinitiate from the summary. *(Anthropic.)*
7. **Re-fetch from source** for live re-query: re-call the original tool (clear
   semantics) rather than a meta-indirection. *(Claude-Code baseline.)*

**Net target state — the "easy-to-reason-about stream":** every turn the model sees
its goal + what's left (recency), the current data in full, and a clean compacted
history it never has to manually retrieve. The harness only compresses under real
context pressure (aged results, near limit), never the current synthesis-target.

## How this subsumes recall + the meta-tools
- **recall** → removed: nothing the model needs *now* is discarded; aged data
  auto-re-hydrates; live re-query re-calls source. (The recall-redesign spec becomes
  the downstream consequence of this curation policy.)
- **scratchpad / find** → re-evaluate: if the curator manages externalized context,
  model-facing stash/search meta-tools likely become overlap (rubric #1).
- **discover-tools** → obviated by a stable tool set (mask-don't-remove).
- The PostCondition ledger (Phase 1) is the recency-span goal state (step 2).

## Implementation surface
- `kernel/capabilities/attend/tool-formatting.ts` — `compressToolResult` (the
  immediate-crush site); change to **age-aware**: do NOT compress the current/recent
  result; compress only when a result has aged past the recency budget.
- `context/context-curator.ts` — message-window assembly; owns the age policy, the
  recency span (goal ledger + current result), reversible pointers, and auto-rehydration.
- `context/context-profile.ts` — replace fixed `toolResultMaxChars` (600–4000) with a
  **window-scaled recency budget** (fraction of the model's context window) + an
  age threshold; keep an aged-result floor.
- The full-payload store (today the scratchpad/recall key) stays as the system-side
  reversible store, but is read by the **curator** (auto-rehydrate), not a model tool.

## First concrete change (low-risk, high-value)
Before the full auto-rehydration build: **stop crushing the current result + scale the
budget to the window.** Just raising frontier from 600 → window-proportional and making
compression age-aware should fix sonnet's truncation loop and lift faithfulness — a
fast, measurable first step inside the spike.

## Ablation plan (same rigor as Phase 1)
- Arm A: current curation (immediate 600–4000-char crush + recall).
- Arm B: age-aware, window-scaled curation (current full, aged cleared + auto-rehydrate).
- Metrics, fixture-pinned, cross-tier (incl. a genuine sub-7B local — llama3.2/qwen3.5,
  NOT cogito:3b): **faithfulness** (the direct target), pass^k, tokens, recall-rate,
  "truncated/re-fetch" loop incidence. Bar: B ≥ A on faithfulness + pass^k at ≤ tokens,
  on overflow tasks (T3 >4000 + a real MCP large-result). RED tests + live gate + advisor.

## Sequencing (reordered)
1. **Spike 1 = context curation (THIS, the root)** — age-aware, window-scaled, current-
   full; first change = stop crushing current + scale budget.
2. **Recall removal + auto-rehydration** — folds in as the downstream consequence once
   the curator owns reversible storage.
3. **Meta-tool audit (later, if needed)** — find/scratchpad/discover-tools/context-status/
   completion-gaps vs the rubric.
4. **Phase-4 tool-stability (mask-don't-remove)** and **Phase-2 recitation** ride this
   architecture (recency-span goal state + stable tool set).
