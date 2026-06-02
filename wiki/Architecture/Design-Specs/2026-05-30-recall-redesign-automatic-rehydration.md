---
title: Recall Redesign — Remove the model-facing recall tool; automatic re-hydration
date: 2026-05-30
status: draft-for-review
motivation: "recall() is a confirmed top failure mode (Phase-3 ablation + spot-test traces)"
relates:
  - "[[2026-05-30-canonical-agentic-convergence-plan]]"
  - "[[phase3-ablation-2026-05-30]]"
---

# Recall Redesign — recall as a system behavior, not a model tool

## Problem (evidence-grounded)
`recall` is a model-facing indirection over data the harness compressed/stashed.
Forcing a model — especially a weak local one — to reason about an opaque
key-value store produces two failure modes observed this session:

1. **Blind recall on inline data** — model calls `recall("hn_posts")` against data
   already in context → `{found:false}` → echoes empty / loops. (Phase-3 ablation:
   gpt-4o-mini baseline 5/15 recall smells, pass^k only 2/5.)
2. **recall-as-file-write** — cogito called `recall(key:"./commits.md", content:<md>)`
   to "save the file," conflating memory-store with a filesystem deliverable. The
   spot-test deliverable was never written. recall isn't even a write tool — its mere
   presence + "save"-like framing lured the model.

**Root cause:** recall exists only because small local windows force the harness to
compress big tool results, which then needs a retrieval path. It is a band-aid on a
band-aid. The probe's own North Star already says recall should be *automatic +
contextual, not "agent must call recall()."*

The Phase-3 recall-gate (hide `recall` unless a >4000 result overflowed) is a
**partial** mitigation — it removes the lure on inline data but leaves the opaque
tool (and both failure modes) on the overflow path, and the MCP-overflow path is
unproven.

## Design — three moves

### 1. Remove `recall` from the model-facing tool schema (not just gate it)
Models should never reason about a key-value memory. Delete the meta-tool from the
advertised set entirely (control-first: a flag to restore it during rollout).

### 2. Automatic re-hydration by the curator (the replacement)
When a tool result is compressed/truncated, keep the full payload **system-side**,
keyed to its observation step (`state.steps`). On subsequent turns the curator
re-expands the relevant truncated content into recency **automatically**, driven by:
- the model's current focus (its latest thought/action references that step/topic), and
- available window budget (re-expand only what fits; evict oldest first).

The model simply *sees* the data when its reasoning needs it — no retrieval action.
This realizes the stated North Star and matches how Claude Code works (large outputs
are window-managed, not poked by key).

### 3. Re-fetch from source for live re-query
If the model needs to genuinely re-query (not just re-see stashed data), it re-calls
the **original tool** (clear semantics, already in schema) — not an opaque recall.

### Net
- Removes BOTH failure modes at the root (no key reasoning, no write-confusion).
- Keeps the small-window benefit (compression/obs-digest stays — Phase-3 proved
  `extractObservationFacts` is token-protective, KEEP).
- Control-first: a flag falls back to the recall-tool during rollout.

## What must be ablated before removing the tool (the proof bar)
Automatic re-hydration needs a **relevance signal** (which stashed payload to
re-expand, when). Naive "always re-expand" defeats compression. Cross-tier ablation
(fixture-pinned, `pass^k` + tokens + post-conditions), arms:
- A: current recall-tool (gated, Phase-3 default).
- B: recall-tool removed + curator auto-re-hydration.

Pass bar (project lift rule): B ≥ A on overflow-task correctness (T3 >4000 + a real
MCP large-result task) AND ≤ tokens. Specifically must show: the model gets the
overflow data it needs WITHOUT calling recall, and tokens don't balloon from
over-eager re-expansion. If B can't match A's overflow hit-rate, keep recall gated
(Phase-3 state) and iterate the relevance signal.

## Scope / sequencing
- Bigger than a flag flip — it removes a core mechanism + builds re-hydration in the
  curator. Deserves its own spike with the same rigor as Phase 1 (RED tests +
  cross-tier live gate + advisor), NOT a rushed inline change.
- Land Phase-3's proven recall-gate flip first (immediate honest win, control-first);
  this redesign supersedes it once B clears the bar.

## Broader lens (apply the same test to the rest of the meta-tool surface)
recall is the worst offender, but the same "does it serve us, redesign if not"
question applies to the other meta-tools (`find`, `pulse`, `brief`) and the
compression pipeline. Recommend a meta-tool surface audit: each meta-tool must earn
its place against the simpler "stable, direct, minimal surface + get out of the
model's way" baseline (the Claude-Code contrast that explains RA's per-task token tax).
