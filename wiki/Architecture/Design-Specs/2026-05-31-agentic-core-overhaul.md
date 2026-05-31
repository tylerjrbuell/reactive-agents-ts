---
title: Agentic Core Overhaul — ideal-architecture prototype (proof-gated)
date: 2026-05-31
status: prototype-spec
branch: overhaul/agentic-core-2026-05-31
scope: "Agent loop + context systems, in-place re-architecture. Keep providers/MCP/memory/public API + phase structure. Replace the model-facing context indirection wholesale; add structural honesty. Clean-room license where highly confident a better solution exists — gated on proving benefit vs the current kernel."
research:
  - "[[2026-05-30-context-curation-architecture]]"
  - "[[2026-05-30-recall-redesign-automatic-rehydration]]"
  - "[[2026-05-30-meta-tool-redesign-initiative]]"
  - "[[2026-05-31-context-truncation-wire-debrief]]"
sources:
  - "Anthropic — Effective Context Engineering (tool-result clearing, JIT, smallest-high-signal set, context rot)"
  - "Manus — Context Engineering Lessons (reversible compression w/ pointers, recitation, KV-cache stability, recency)"
  - "12-Factor Agents — own your context window; stateless reducer over an event log"
---

# Agentic Core Overhaul

## The one inversion
Today the harness makes the model reason around it (recall tool, `[STORED:]` markers,
compression the model must undo). The ideal makes the harness **serve the model and get out
of the way**. The harness has exactly two jobs: (1) present an honest, easy-to-reason-about
state; (2) faithfully execute decisions and **verify** them. Everything else is the model's
job or deterministic plumbing the model never sees.

## Eight principles (each tied to a wire-measured failure)
1. **Context = a deterministic projection of an event log, system-owned.** Model-visible
   window is a pure fn `(log, focus, modelWindow) → messages`. Aged data → system-summarized,
   system-rehydrated. No model-facing recall, no `[STORED:]` markers. *(kills recall-as-content
   / marker-copy + age-blind 4000-cap.)*
2. **Never hand the model a pointer it must act on — resolve references in the system.** A
   deliverable that consumes a prior result gets the real data injected by stable id; the model
   orchestrates *by reference*, the system *materializes*. *(kills "wrote the marker into the
   file" + transcription truncation.)*
3. **Honesty is structural, not prose.** Success = content-aware post-conditions over real
   artifacts (expected items present, no leaked markers); never trust "I successfully did X."
   Capability is a floor the harness makes HONEST, not competent. *(kills the dishonest-success
   that `RA_POST_CONDITIONS=1` misses today.)*
4. **The wire is always observable.** First-class, always-on capture of exactly what the model
   received (final assembled messages) + exactly what the provider returned (`done_reason`,
   prompt/eval tokens). *(I had to build a proxy this session; the harness must expose its own
   wire.)*
5. **One source of capability truth; every budget derives from it.** `(window, output budget,
   tool dialect, tier)` resolved once. num_ctx sizing, curation budget, output budget = the same
   number by construction. *(kills the 8192/32768/15360/maxContextTokens drift.)*
6. **Minimal reducer; every optional mechanism OFF until it earns its place by ablation.**
   observe→decide→act core; ToT/reflexion/healing/strategy-switch default-OFF, re-enter only with
   a cross-tier lift receipt (≥3pp / ≤15% tokens). No scaffold without a caller. *(kills sprawl,
   dead flags, metric-gaming.)*
7. **Deterministic core, LLM only for judgment + synthesis.** Context assembly, done-detection,
   budget sizing, reference resolution, loop-detection — pure. No LLM re-verify (M3 REWORK).
   *(kills bookkeeping token-burn.)*
8. **Tools: stable, minimal, masked.** Mask-don't-remove (KV-cache stable), smallest high-signal
   set, no discover-tools indirection. *(kills tool-set churn + relevantTools-drop blindness.)*

## What we KEEP (RA got these right)
Two-record model (messages vs steps) — right bones, bugs were in the seam. Native FC across 6
providers + MCP. PostCondition terminal single-owner seam (needs content-awareness, #3). The
ablation discipline + wardens.

## Prototype scope (highest leverage, end-to-end provable)
Behind a builder flag `withOverhaulContext()` / env `RA_OVERHAUL=1`, A/B-able against the current
kernel per-run. Phase structure preserved; we swap the **context layer** + add the **honesty
layer** + **always-on wire telemetry**. Three components:

- **A. ContextManager** (#1/#2/#5/#7): pure `assembleWindow(eventLog, focus, capability) → messages`.
  Owns recency placement, tier-scaled full-result budget, system-summary of aged results, and
  reference resolution. **Removes the model-facing `recall` tool and all `[STORED:]` markers from
  the model stream.** The reversible store stays system-side, read by the manager.
- **B. Content-aware verification** (#3): post-conditions inspect artifact CONTENT — expected
  item count, no `[STORED:`/marker leakage — and gate success honestly.
- **C. Wire telemetry** (#4): always-on capture of assembled messages + provider response
  metadata, written to a run trace. Makes the A/B provable without an external proxy.

### KEY DESIGN RISK to validate first (the reference protocol, #2)
How does the model express "write the fetched commits to the file" WITHOUT transcribing, and
without a model-facing pointer it can mishandle? Candidate: tool results carry stable ids; the
model emits file-write with content that **references** the prior result id; the tool layer
**resolves+materializes** the full data from the store before execution. The model orchestrates
("write the list_commits result as bullets"), the system fills the bytes. This is the novel/risky
piece — prototype it first and prove it on the 20-commit overflow.

## Proof-gate (merge criteria — control-first)
Run OLD kernel vs NEW (overhaul) on the SAME fixtures, cross-tier (cogito:14b, qwen3:14b,
qwen3.5, gpt-4o-mini, sonnet-4-6). Merge ONLY if NEW:
- **20-commit overflow:** writes all 20 faithful (no marker) on the tiers OLD failed — OR honest
  `success:false` if it cannot (NEVER a prose lie).
- **10-commit baseline:** no regression (still all 10).
- **dishonest-success:** reports `success:false` when artifact content is wrong (OLD reports true).
- **tokens:** ≤ OLD, or within the project ≤15% rule.
- **no cross-tier regression** on the HN T3-strict fixture (pass^k flat or up).
If NEW does not beat OLD on the failure class at acceptable cost → do NOT merge; keep main.

## Sequencing
1. Build C (wire telemetry) first — it's the measurement substrate (Phase-0 discipline).
2. Build A (ContextManager) incl. the reference protocol; prove on 20-commit overflow.
3. Build B (content-aware honesty); prove it catches the dishonest-success.
4. Cross-tier proof-gate; debrief with the lift table. Merge or discard on evidence.
