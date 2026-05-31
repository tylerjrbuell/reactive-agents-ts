---
title: Context Curation Architecture — the optimal-stream root
date: 2026-05-30
status: "PARTIALLY SHIPPED — age-aware curation DEFAULT-ON (opt-out RA_CURATION_AGEAWARE=0); wire-verified 2026-05-31 (cogito:14b 2-3→10 commits, sole root cause = 4000-char truncation). Recall-removal + budget-vs-num_ctx coupling = open follow-ups."
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
> **Mechanism correction (Spike-1 build, kernel-warden):** the *produce-time*
> `compressToolResult` budgets in `context-profile.ts` (600–4000) shape the `steps[]`
> observation record, NOT primarily the model-visible message. The model-visible
> `tool_result` MESSAGE is rebuilt in `act/conversation-assembly.ts` (~106-128), which
> rehydrates each result from the scratchpad to full **up to a FLAT
> `TOOL_RESULT_INLINE_CAP = 4000` chars** — applied to **every** result regardless of
> age or the model's window size. So the real age-blind/window-blind knob is the **4000
> inline cap**, not the 600 produce-time budget. (The earlier "frontier sees 600 chars"
> framing was imprecise — it sees up to 4000; the root holds.)

RA caps **every** model-visible tool result at a flat **4000 chars**, recency-blind and
window-blind — including the **current** result the model must synthesize from *this
turn*, even on a 200k-window frontier model. The full payload is pulled out to a recall
key (`_tool_result_N`).

- A result over 4000 chars (e.g. 25 HN posts ≈ 5000 chars, 10 commits) is truncated in
  the model's message → the model synthesizes from a **truncated** view → low
  faithfulness, fabrication (the documented "summarized all 15, fabricated 7 titles"),
  and "the results were truncated, let me retrieve the full content" loops (sonnet T3).
  sonnet's 200k window is wasted on a 4000-char cap.
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

## Predictive bucketed num_ctx (DEPRIORITIZED — wire-disproven as a failure mode)
> **Wire verdict (2026-05-31, logging-proxy capture of the literal Ollama round-trip):**
> num_ctx is **NOT** a failure mode for the regression. The "only 2 commits" symptom was
> diagnosed end-to-end on the wire as a **single** cause: the flat 4000-char tool_result
> truncation in `act/conversation-assembly.ts` (curation OFF) — chat-after-`list_commits`
> received `tool_result len=4087, truncated=true` → model wrote 2-3 of 10. With age-aware
> curation ON the same call received 21646 chars → **10/10 commits**. Both runs: `num_ctx=15360`
> (operator-set "half for speed"), `prompt_eval ≈ 1s`, `done_reason=stop` — num_ctx was fast,
> the output budget (`num_predict=2000`, `eval≈360 < 2000`) was never hit. **The only changed
> variable was input truncation.** Predictive sizing remains a valid *speed/VRAM* optimization
> at large windows, but it is **not** a correctness fix — deprioritized below curation +
> recall-removal. (b1561303's 8192→32768 was chasing this non-cause; operator since set 15360.)

**Original context (retained for the speed-optimization track):** Ollama allocates the
**full num_ctx KV-cache up front** (slower inference + more VRAM) AND **reloads the model
when num_ctx changes** (so it can't vary per call). The optimum is to **predict the need and
size to it** (user insight, 2026-05-30).

**RA can predict — it assembles the prompt, so it knows the token count before the call**
(already counted for curation budgets). Design:
- `num_ctx = smallest BUCKET ≥ (assembled-prompt-tokens + maxOutputTokens + headroom)`, capped
  at `min(model_real_window, VRAM-fit-ceiling)`.
- **Buckets** (e.g. 8k/16k/32k/64k) avoid reload-thrash — a typical task stays in one bucket;
  only a big task bumps up. Do NOT size to the exact count (every call would reload).
- **Predict the peak at run start** from the known-up-front pieces: system prompt + tool-def
  tokens (≈40 MCP tools is *measurable*) + expected history growth (strategy × max-iterations).
  Set the bucket once; re-bucket only when a real prompt nears the ceiling.

**Unifies three threads:** (1) replaces the static 32768 ceiling with fit-to-need (fast small,
full-window big); (2) **fixes the maxContextTokens(131072)-vs-num_ctx(32768) mismatch the
provider-warden flagged** — curation must budget against the ACTUAL num_ctx, and with
predictive sizing the curation budget and num_ctx are the same number by construction; (3)
subsumes the VRAM-aware-cap recommendation (bucket ceiling = VRAM-fit). Provider-layer
(`local-probe.ts` cap + a num_ctx selector fed the assembled-prompt token count) + curation
(`attend/` budget reads the chosen num_ctx). Spike after the curation default-on path.

## Sequencing (reordered)
1. **Spike 1 = context curation (THIS, the root)** — age-aware, window-scaled, current-
   full; first change = stop crushing current + scale budget.
2. **Recall removal + auto-rehydration** — folds in as the downstream consequence once
   the curator owns reversible storage.
3. **Meta-tool audit (later, if needed)** — find/scratchpad/discover-tools/context-status/
   completion-gaps vs the rubric.
4. **Phase-4 tool-stability (mask-don't-remove)** and **Phase-2 recitation** ride this
   architecture (recency-span goal state + stable tool set).
