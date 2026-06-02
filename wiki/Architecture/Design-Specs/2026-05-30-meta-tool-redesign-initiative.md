---
title: Meta-Tool Redesign Initiative — context-engineering-first tool design
date: 2026-05-30
status: rfc
motivation: "Meta-tools are a top failure source on weak models; the surface is large and partly anti-canon"
research:
  - "[[2026-05-30-harness-engineering-canon]]"
  - "[[2026-05-30-recall-redesign-automatic-rehydration]]"
sources:
  - "Anthropic — Effective Context Engineering for AI Agents (2025-09)"
  - "Anthropic — Writing tools for agents / token-efficient tools (2025)"
  - "Manus — Context Engineering Lessons (2025-07)"
  - "12-Factor Agents (humanlayer)"
---

# Meta-Tool Redesign Initiative

**Thesis (user-directed):** stronger, easier-to-use, logically-smart tool design
prevents whole failure classes and maximizes agent understanding + efficiency.
Context engineering is **first-class** in tool design — a tool's schema, naming,
result shape, and *presence* are context that the model must reason over. The
Claude-Code contrast (stable, direct, minimal surface) explains much of RA's
per-task token tax and the meta-tool confusion failures.

## Why now (evidence)
- `recall` is a confirmed TOP failure mode: blind-recall (invented keys on inline
  data → `{found:false}` → loop) and recall-as-file-write (cogito stored a
  deliverable into memory instead of writing it). Phase-3 ablation: gating recall
  off gave gpt-4o-mini pass^k 2/5→5/5.
- The meta-tool surface is large: `recall, find, pulse, brief, context-status,
  scratchpad, discover-tools, completion-gaps, get-skill-section, activate-skill,
  final-answer, task-complete` — many are candidates for overlap or removal.

## Design principles (research-derived rubric)
Every meta-tool must pass this rubric; failing items get redesigned or removed.

1. **Minimal set, no overlap (the "which tool?" test).** "If a human engineer
   can't say which tool to use, the agent can't either." Overlapping meta-tools
   (e.g. recall vs find vs scratchpad; pulse vs context-status) are a confusion tax.
   *(Anthropic)*
2. **Mask, don't remove.** Dynamically adding/removing tools invalidates the
   KV-cache (defs sit near the prefix) and leaves stale refs that confuse the model.
   Keep the tool set **stable**; constrain availability via a state machine / prompt
   masking, not by mutating the schema. *(Manus)* — **⚠️ directly implicates the
   Phase-3 recall-gate (dynamic removal) AND lazy-disclosure (Phase 4): the
   canon-correct form is a STABLE set, with recall either always-absent (removed) or
   always-present-but-masked.**
3. **No model-invented identifiers.** Retrieval keyed on a string the model makes up
   is the root of blind-recall. Identifiers must be **system-provided and
   deterministic** (paths, URLs, queries, step refs) — or absent (re-fetch from
   source). *(Anthropic JIT retrieval + Manus reversible compression.)*
4. **Reversible compression with visible pointers.** When the harness drops/truncates
   a payload, leave a deterministic pointer in-context ("…+N more — ref step#K") so
   nothing is irreversibly lost and the system can re-expand it. *(Manus.)*
5. **Recency for goal/critical state; clear stale bulk.** Drop bulky tool_result
   bodies deep in history (keep the tool_use record); place goal/remaining-state in
   the recency span. *(Anthropic tool-result clearing + recitation.)*
6. **Token-bounded, self-describing results.** Cap result size, paginate/filter/
   truncate with sane defaults; describe when NOT to use the tool, limits, latency.
   *(Anthropic token-efficient tools.)*
7. **Direct over meta.** Prefer the model re-calling a real source tool (clear
   semantics) over a meta-indirection it must reason about. *(Claude-Code baseline.)*

## Meta-tool audit (rubric applied)
Recall is worked fully below; the rest are hypotheses to confirm by reading each
tool against the rubric (the next deliverable). Verdicts: KEEP / REDESIGN / REMOVE / MERGE.

| Tool | Hypothesis | Rubric tension |
|---|---|---|
| `recall` | **REDESIGN→REMOVE** (worked below) | #2 dynamic-gate, #3 invented keys, #7 meta-indirection |
| `find` | AUDIT — likely overlaps recall/scratchpad | #1 overlap, #3 |
| `scratchpad` | AUDIT — externalized note store; vs file-system memory | #1 overlap with recall/find, #7 |
| `discover-tools` | AUDIT — may be **obviated** by a stable tool set | #2 (only needed if tools are hidden) |
| `context-status` vs `pulse` | AUDIT — likely **MERGE** (both report context/health) | #1 overlap |
| `pulse` | KEEP (meta-cognition; Phase-2 self-check vehicle) — but scope vs context-status | #1 |
| `completion-gaps` | AUDIT — overlaps the new **PostCondition spine** (Phase 1) | #1 overlap with verify/post-conditions |
| `brief` | AUDIT | #6 |
| `final-answer` / `task-complete` | KEEP (terminal); confirm not overlapping | #1 |

## Spike 1 — recall (first, highest-leverage)
Full design: [[2026-05-30-recall-redesign-automatic-rehydration]]. Research-refined:
- **Remove model-facing `recall` entirely** → stable tool set (recall always absent),
  satisfying #2 (no dynamic mutation) better than the Phase-3 gate, and #1/#7 (one
  fewer overlapping meta-tool).
- Replace with **system-driven reversible compression + auto-re-hydration** (#3/#4):
  curator leaves a deterministic visible pointer on truncation and re-expands by
  recency/focus — the model never invents a key.
- **Re-fetch from source** for live re-query (#7): re-call the original tool.
- **Ablation arm A (Phase-3 gated recall) vs B (removed + auto-rehydrate):** B must
  match A's overflow hit-rate (T3 >4000 + a real MCP large-result) at ≤ tokens, on a
  fixture, cross-tier (incl. a genuine sub-7B local model — NOT cogito:3b, it runs
  away; use llama3.2/qwen3.5). Same rigor as Phase 1 (RED tests + live gate + advisor).

## Sequencing (REORDERED — curation is the root)
**Root-cause update:** recall is a *symptom* of over-aggressive context curation — RA
crushes the **current** tool result to 600–4000 chars before the model synthesizes
from it, then offers `recall` to fetch back what it discarded. Fix the curation and
recall is largely unnecessary. Full design: [[2026-05-30-context-curation-architecture]].

1. **Spike 1 = CONTEXT CURATION (the root).** Age-aware, window-scaled curation: keep
   the current/recent tool result FULL, compress only aged results to reversible
   pointers, auto-re-hydrate by focus. First change = stop crushing the current result
   + scale budget to window (fixes sonnet's 600-char truncation loop). See the curation spec.
2. **Recall removal + auto-rehydration** — folds in as the downstream consequence of #1
   (the curator owns the reversible store; no model-facing recall, no invented keys).
   Supersedes the Phase-3 gate.
3. **Meta-tool audit (later, if needed):** `find`/`scratchpad`/`discover-tools`/
   `context-status`/`completion-gaps`/`brief` vs the rubric. Likely: merge pulse+context-
   status; remove completion-gaps in favor of the PostCondition spine; discover-tools
   obviated by a stable set.
4. **Cross-cutting "mask, don't remove"** (Phase-4 tool-stability) and **Phase-2
   recitation** ride this architecture (stable resident tool set + recency-span goal state).

## Connection to the convergence plan
This initiative subsumes Phase-4 (tool-set stability) and supersedes the Phase-3
recall-gate. It is the "remove overcomplication / get out of the model's way"
direction the live evidence pointed to — now grounded in the harness-engineering canon.
