---
title: Canonical Context Assembly — the ideal design (how it should have been built)
date: 2026-05-31
status: design-locked (mandate 2026-05-31 — best design over backward-compat; event-log + CAS + pure project() foundational; legacy maze deleted)
branch: overhaul/agentic-core-2026-05-31
scope: "The ideal, greenfield architecture for context assembly: ONE append-only event log as the single source of truth; everything the model sees is a pure, deterministic, total projection of (log, capability). No two-record split, no inlined blobs, no model-facing context machinery, no parallel builders. Migration is a subordinate appendix — it adapts us toward this target; it does not shape it."
relates:
  - "[[2026-05-31-agentic-core-overhaul]]"
  - "[[2026-05-30-context-curation-architecture]]"
  - "[[2026-05-31-context-truncation-wire-debrief]]"
sources:
  - "12-Factor Agents — own your context window; stateless reducer over an event log"
  - "Anthropic — Effective Context Engineering (tool-result clearing, compaction, JIT, smallest-high-signal set)"
  - "Manus — Context Engineering Lessons (KV-cache stable prefix, recency, reversible compression)"
---

# Canonical Context Assembly — the ideal design

> This document describes the architecture **as it should have been built from the
> beginning.** It is the north star. The migration appendix is how we approach it
> incrementally without a big-bang rewrite — but the design below is **not**
> compromised by migration concerns.

## Mandate & locked decisions (2026-05-31)
This is a genuine **overhaul** — unify the design to serve the framework as best as
possible and fix the pain points + failure modes **at the root**, so RA reaches its
full potential. Explicit user mandate:
- **Best design wins over backward-compat.** Some original decisions had reasons; that
  does not protect them. We do **not** trip over months of misaligned decisions to
  preserve them. Misaligned mechanisms are in-scope, judged by best-design + ablation,
  not grandfathered.
- **Root-cause fixes only** — pure, better architecture, not another compensating layer.
- **Locked IN (foundational, not optional):** (1) the single append-only **event log**
  replacing the `messages[]`/`steps[]` two-record split; (2) the content-addressed
  **`ResultStore`** replacing the model-facing `scratchpad`/`recall`; (3) `project` as
  the sole, pure, total assembler replacing all legacy builders.
- **The legacy maze is DELETED, not preserved.** `buildConversationMessages`,
  `buildCuratedMessages`, `ContextManager.build`, the injectable `defaultContextCurator`,
  `compressToolResult`'s model-facing output, `TOOL_RESULT_INLINE_CAP`, the `recall`
  tool, `[STORED:]` markers — all removed once their intent lives in `project`.
- **Incremental ≠ timid.** The strangler-fig steps exist only to *prove each move with
  evidence* (this session proved why: dead seams + false "lift" claims). Any transitional
  shim is a temporary proving scaffold that is itself removed — never a lingering compat layer.

## The one idea everything derives from
**The agent's entire state is a single append-only event log. Everything the model
sees is a pure, deterministic, *total* projection of `(log, capability)`. Nothing
else exists.** There is no separate "messages the model sees" record, no mutable
context object, no injectable curator, no parallel builders. Context assembly is one
referentially-transparent function. Given the same inputs it returns byte-identical
output, forever — which makes it trivially testable, replayable, cacheable, and
observable *by construction*.

This is 12-factor's "stateless reducer over an event log" + Anthropic's
tool-result-clearing + Manus's reversible-compression, taken to their clean
conclusion instead of bolted on.

## Pillars

### 1. One event log — not two records
Today there are two records (`messages[]` = what the LLM sees, `steps[]` = what
systems observe) and the seam between them is where every bug hid (flat truncation,
age-blindness, false markers, dead curation). **The ideal has ONE typed, append-only
log of facts** — `Goal`, `Thought`, `ToolCalled`, `ToolResult(ref)`, `Observation`,
`GoalStateChanged`, `Terminated` — and **two pure projections** of it: the
provider request (for the model) and the systems view (for telemetry/verify). One
source, many views. No seam to drift.

### 2. Results are content-addressed, never inlined into the log
A `ToolResult` event carries a **reference** (content-hash id) into a `ResultStore`
(content-addressed) plus cheap metadata (shape, item-count, bytes). The bulk **never
enters the log**. The log stays small and stable (KV-cache friendly); the data lives
in an addressable store the *projection* reads. This deletes the entire
"stash-the-full-body, show-the-model-a-`[STORED:]`-marker, let-it-`recall()`"
indirection at the root: there is no marker because there is no inlined blob to
mark, and no recall tool because the store is system-owned.

### 3. Assembly is a pure total function
```ts
// The ONLY way a provider request is ever produced. Deterministic + total.
function project(log: EventLog, capability: ResolvedCapability, store: ResultStore): Projection;

interface Projection {
  readonly request: ProviderRequest;   // { systemPrompt, messages, tools } — exactly what is sent
  readonly trace: AssemblyTrace;        // the record of every decision (see §6)
}
```
No mutation, no DI of rendering logic, no alternate paths. The `focus`/`GoalState`
is **derived from the log**, not passed in. The conversation the model sees is the
**output**, never an input. A test double swaps the *provider*, never the projector.

### 4. Capability resolved once; num_ctx is predicted from the assembled prompt
`ResolvedCapability { window, outputBudget, dialect, tier }` is computed once at the
boundary. **Every budget is a function of it** (recency, aged, compaction). And the
arrow is reversed vs today: `project` knows the assembled prompt size, so **num_ctx
is predicted from the request** (bucketed, fit-to-need), never a stale constant the
request must fit into. One number, derived, by construction — the 8192/32768/15360
drift is structurally impossible.

### 5. Projection of results: full | summary+ref | cleared — system-decided
Inside `project`, for each referenced result the system deterministically chooses:
- **present-full** when it fits the recency budget (the model may reason / transcribe);
- **summarize+ref** when it overflows → a clean system summary naming the
  `result_ref`, with a single instruction to act on it by reference
  (`write_result_to_file(result_ref, …)`) — **no marker, no preview, no recall hint**;
- **clear** for deep-history results → a reversible system pointer the system
  **auto-re-expands on focus** (JIT), never a model action.

The model's cognitive surface is exactly: the goal, the current facts, the tools.
**It never reasons about memory management.** This is the single stage that subsumes
everything today's `compressToolResult` / `TOOL_RESULT_INLINE_CAP` / curation /
recall do — and it is pure.

### 6. Observability is the return type, not a feature
Because `project` is pure, the **complete trace is its byproduct** — the exact
messages (per-message role/chars/tokens/projection-decision), the tools offered, the
capability, and what each stage decided. Paired post-hoc with the provider response
(`done_reason`, eval/prompt tokens, tool calls), "what the model received and what
it returned" is a **durable, replayable artifact**. No external proxy, no inferring
tool use from file format — both failures we hit this session become impossible.

### 7. No model-facing context machinery
No `recall`, no `[STORED:]`/preview markers, no `discover-tools`. The model
orchestrates by *referencing facts* (stable ids in the log); the system
*materializes*. Tools are a **stable, masked set** declared once (mask-don't-remove,
KV-cache stable) — a capability of the agent, not churned per turn.

### 8. Assembly is deterministic; the LLM is only for judgment
Zero LLM calls inside `project` (no LLM re-verify — the M3 REWORK lesson). The LLM is
invoked for exactly two things: *what to do next* and *synthesis*. Everything else —
projection, budgeting, done-detection, ref resolution — is pure code.

### 9. Strategies are reducers over the one log, not separate assemblers
ToT / reflexion / plan-execute are **policies for which events to append next**, all
reading the same `project(log, …)`. They do **not** each build their own messages
(which is exactly how `relevantTools` got dropped in three strategies). One context
path; many decision policies on top.

### 10. Honesty is a projection too
Post-conditions are **events/derivations in the log**; `GoalState` and `success` are
*projections* of the log (content-verified), never a model's prose claim. The same
`GoalState` the projector recites into recency is the one the verifier checks — model
and verifier share one truth by construction.

## Why this is the ideal (the properties fall out for free)
- **Determinism → free replay, snapshot, cache, and golden-trace tests.** Re-run any
  past turn exactly; diff two projections byte-for-byte.
- **One log → no two-record seam bugs.** The class of failure we spent this session
  on cannot exist.
- **CAS results → no recall/marker indirection.** The disease has no host.
- **Pure projection → observability by construction.** You can always answer "what
  did the model see" without instrumenting anything.
- **Capability-derived budgets → no drift.** One number, computed, never copied.
- **Single path → a seam is either in `project` or it does not exist.** No dead
  edits, no "wired into the wrong builder."

## What it replaces (the maze, deleted)
`buildConversationMessages`, `buildCuratedMessages`, `ContextManager.build`, the
injectable `defaultContextCurator`, `compressToolResult`'s model-facing output, the
flat `TOOL_RESULT_INLINE_CAP`, the `recall` tool, `[STORED:]` markers — all collapse
into `project` + `ResultStore`. The `scratchpad as Ref<Map<string,string>>` becomes
the content-addressed `ResultStore` (system-owned, not a model tool).

---

## Appendix — migration (subordinate; does not shape the design)
We cannot greenfield the repo, but we reach the target without compromising it, via
strangler-fig, control-first, ablation-gated:
1. **Pin the live path.** Instrument `defaultContextCurator.curate` + `think.ts`
   stream/complete branches; produce "what renders the live prompt today."
2. **Introduce `project` as the single entry, delegating byte-identically** to the
   current live renderer first (trace-diff = control). The live path becomes single +
   observable with zero behavior change. **This delegation shim is a temporary proving
   scaffold — deleted in step 3, never a permanent compat layer.**
3. **Migrate behind the one entry**: introduce the event-log + `ResultStore`
   projections incrementally; collapse and delete each legacy builder as its logic
   moves into a pure stage; each step gated trace-diff-identical or ablation-justified.
4. **Land §5 projection + reference tool in the one path**; verify on the
   wire-measured failure class (overflow, dishonest-success) cross-tier, N≥3,
   per-component attribution.
5. **Reconcile the curation ship** (`c9e6fba2`): confirm whether it ever ran live;
   fold its intent into §5.

The order is pragmatic; the destination is the design above, unchanged.

## Open questions (Phase-0 pinning)
- Where exactly does the live prompt render today (the unpinned curator binding / `think.ts` branch)?
- Does `ContextManager.build` have *any* live caller, or is `context-manager.ts` wholly legacy?
- Is the post-condition `GoalState` (Phase-1 spine) already derivable from existing state, or does the event-log need new event types first?
