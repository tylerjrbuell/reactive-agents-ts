---
title: ROOT CAUSE — the tool-relevance classifier prunes the task tool (harness detriment)
date: 2026-06-04
type: harness-report
severity: P0
related:
  - "[[2026-06-04-raw-vs-harness-toolcall]]"
  - "[[2026-06-04-calibration-adapter-toolcalling]]"
tags: [harness-report, root-cause, tool-calling, classifier, calibration, P0]
---

# ROOT CAUSE — the tool-relevance classifier prunes the task tool

The harness detriment that reduces a natively-perfect model (qwen3: 10/10 raw) to
**0/15** in the harness is now root-caused with a proven evidence chain. **The
harness hides the task tool from the model.**

## The mechanism

`classifyTools` (`runtime/src/engine/phases/agent-loop/setup/classifier.ts`) runs
`classifyToolRelevance` — **an LLM round-trip on the SAME model** — to decide which
tools are "relevant", then `filterToolsByRelevance` **prunes the rest**. It is
**default-on** whenever reasoning is enabled and no static tool list / opt-out is
set (`classifier.ts:91-108`), gated only by the `classifierReliability` calibration
field (`low`/`skip` → fall through to literal-mention; otherwise → run the LLM
classifier and prune by its output).

qwen3 is **uncalibrated** → `classifierReliability` is undefined → **not gated
out** → qwen3's *own* classifier call judges `github_list_commits` **irrelevant**
for "Fetch the 15 most recent commits…" (a classifier failure — it is obviously
relevant) → the tool is **pruned** → qwen3 is left with only meta-tools → it
drifts to `find`. qwen2.5's classifier judges correctly → tool kept → 15/15. **The
pruning is model-specific because the classifier runs on the model itself.**

## Proven evidence chain

1. **Captured payloads (byte-exact harness→Ollama requests, qwen3 BENCH):**
   - PROBE turn (task names the tool): tools = `[github_list_commits, brief, pulse,
     recall, find, discover-tools]` ✓
   - **BENCH turn 0** (task describes the goal): tools = `[brief, pulse, recall,
     find, discover-tools]` — **`github_list_commits` ABSENT.**
2. **Raw replay of the exact BENCH payload:**
   - as-is (tool pruned): **0/8**, `find×8` — reproduces the harness failure exactly.
   - + `github_list_commits` added back: **8/8** `github_list_commits`.
   → The model was never the problem; the missing tool is the entire cause.
3. **Code trace:** `classifier.ts` default-on + `classifierReliability` gate;
   `filterToolsByRelevance` (`reasoning/.../attend/tool-formatting.ts:119`) does the
   prune.

## Why this is THE divergence point (partial-success → fully-capable)

The classifier is a system meant to **help** (focus the model, cut token bloat on
large MCP tool sets). For models whose classifier judgment is reliable it does
help. For models whose judgment is unreliable it is **actively detrimental**: it
**removes the one tool the model needs**, guaranteeing failure regardless of how
capable the model is at the actual call. This is the clearest instance of the
user's thesis — "some systems greatly improve performance while others are
conversely detrimental."

It also pruned a tool that was on the caller's **explicit `allowedTools` whitelist**
— a relevance heuristic overrode an explicit user declaration.

(Same class as the prior "MCP relevantTools drop" fix, 2026-05-30 — relevance
pruning hiding needed tools — but here it strands the *primary* task tool.)

## Fix space (for decision — NOT yet implemented)

1. **Safety floor (recommended):** classification must never prune below a
   non-empty actionable set. If the retained set excludes all caller-provided
   (`allowedTools`) / task tools, **keep all** rather than strand the model.
   Relevance should *prioritize/order*, not *remove* the explicit set.
2. **Never prune the explicit set:** apply relevance pruning ONLY to large
   auto-discovered sets (MCP), never to a small explicit `allowedTools`/required
   list. (In this case allowedTools=[github_list_commits] should have been
   inviolable.)
3. **Calibration gate:** set `classifierReliability` so unreliable-classifier
   models skip the LLM classifier (literal-mention fallback). Honest but depends on
   calibration coverage — and the offline probe is untrustworthy
   ([[2026-06-04-calibration-adapter-toolcalling]] spike), so the safety floor (#1)
   is the robust primary fix; the calibration gate is a refinement.

## Confirmation in progress

`NO_CLASSIFIER=1` (classifier disabled) vs default, qwen3 BENCH N=10 — expect
classifier-OFF to lift qwen3 from ~0 toward raw-ceiling. (run `bme8v1gf7`.)

## Note

The over-specified PROBE task separately suppresses qwen3 even with the tool
present (PROBE 4-5/15) — a distinct, smaller effect (over-prescription); the
classifier-prune is the dominant BENCH failure.
