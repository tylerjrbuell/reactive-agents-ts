---
title: Raw Ollama vs Harness — Tool-Call Capability (the control we were missing)
date: 2026-06-04
type: harness-report
related:
  - "[[2026-06-04-calibration-adapter-toolcalling]]"
  - "[[2026-06-03-weak-model-toolcall-gap]]"
tags: [harness-report, tool-calling, raw-model, harness-degradation, root-cause]
---

# Raw Ollama vs Harness — Tool-Call Capability

All prior measurement ran *through* the harness. This report adds the missing
control: each model tested **raw** (direct Ollama `/api/chat`, native FC, minimal
prompt, same task) to establish the **intrinsic ceiling**, then compared to harness
behavior. It overturns the namespace conclusion.

## The table (decisive)

| model | raw flat | raw namespaced | harness BENCH | reading |
|---|---|---|---|---|
| cogito:14b | 10/10 | **0/10** | **15/15** | intrinsic namespaced freeze; **harness RESCUES it** (sanitize roundtrip) |
| qwen2.5:14b | 9/10 | 6/10 | 15/15 | harness helps |
| **qwen3:14b** | 10/10 | **10/10** | **0/15** | **harness DESTROYS a fully-capable model** |
| llama3.1:latest | 10/10 | 8/10 | 10/15 | mild harness drag |

(harness BENCH from spike `bhu9jhu52`, N=15, realistic fetch task; raw N=10.)

## Findings

1. **qwen3 is harness-induced degradation, not a model limit.** qwen3 calls the
   namespaced tool **10/10 raw** across *every* variation tested, yet **0/15** in
   the harness (6 no-emission, 9 drift). The harness is **losing/breaking** calls
   the model emits fine on its own.
2. **The namespace-keystone was a red herring.** The model that motivated it
   (qwen3) has **no** namespace problem raw. The model that *does* freeze raw on
   namespaced names (cogito) is **rescued** by the harness's sanitize roundtrip
   (`github/list_commits`→`github_list_commits`→de-sanitize). So namespace handling
   is already working where it's needed.
3. **The harness HELPS most models** (rescues cogito/qwen2.5 raw weaknesses) — and
   **uniquely harms qwen3** (a `<think>` reasoning model). The problem is specific.

## What's been RULED OUT for qwen3 (all 10/10 raw)

Six isolations, each qwen3 = 10/10 raw → none is the cause:
- namespaced tool name
- a persona system prompt
- the `## Decision Rationale (MANDATORY …)` mandate
- streaming (`stream:true`) vs non-streaming
- thinking on / off (`think` param)
- broader 4-tool surface incl. the `find` attractor (0 drift raw)

The harness streaming parser (`local.ts:613-669`) is also correct (accumulates
tool_calls from any chunk).

## Remaining candidate loci (for exact-replay localization)

Not yet isolated — to be pinned by **capturing the harness's literal Ollama request
for qwen3 and replaying it raw byte-for-byte**:
- the multi-iteration conversation thread / message-window assembly
- the pre-run classifier (separate LLM call; sets required/relevant tools)
- think.ts processing of qwen3's thinking + tool_calls together (resolver / rescue)
- full assembled system prompt (environment + available-tools TEXT listing, beyond
  the rationale block already tested)
- sampling params (profile temperature/top_p vs raw defaults)

## Implication for the calibration design

- The `namespaceTolerance` "keystone" from
  [[2026-06-04-calibration-adapter-toolcalling]] is **demoted** — namespace is
  handled. (cogito's raw freeze is already rescued; qwen3 has none.)
- The real lever for qwen3-class (reasoning models) is **removing whatever harness
  layer suppresses a model that is natively perfect** — a *harness-simplification*
  lever, not a calibration-extraction lever. Calibration's role becomes: detect
  "this model regresses under full scaffolding" → serve it a **leaner harness
  path** (fewer iterations / less context / lighter assembly).
- This is a bigger, better lever than per-dialect extraction: it lifts a
  fully-capable model from 0 → potentially 10/10.

## Method note

Raw probes: `/tmp/raw_probe.py`, `/tmp/raw_stream.py`, `/tmp/raw_multi.py`
(ephemeral). Reusable harness bench: `apps/examples/toolcall-gap-probe.ts`.
