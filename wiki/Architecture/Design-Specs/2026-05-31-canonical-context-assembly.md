---
title: Canonical Context Assembly — one pure, observable pipeline
date: 2026-05-31
status: draft-spec
branch: overhaul/agentic-core-2026-05-31
scope: "Collapse the 4+ overlapping context-assembly paths into ONE pure, deterministic, observable pipeline that is the SOLE authority for what an LLM iteration receives. Foundational — every overhaul feature (system-owned projection, reference tool, honesty) wires into this, not around it."
relates:
  - "[[2026-05-31-agentic-core-overhaul]]"
  - "[[2026-05-30-context-curation-architecture]]"
  - "[[2026-05-31-context-truncation-wire-debrief]]"
sources:
  - "Anthropic — Effective Context Engineering (tool-result clearing, compaction, JIT, smallest-high-signal set)"
  - "Manus — Context Engineering Lessons (KV-cache stable prefix, recency, reversible compression)"
  - "12-Factor Agents — own your context window; stateless reducer over an event log"
---

# Canonical Context Assembly

## Why (the pain, evidence-grounded this session)
The context-assembly layer is a **maze of overlapping, partially-dead, swappable builders**:

| function | role | live? |
|---|---|---|
| `attend/context-utils.ts buildConversationMessages` | curation + the overhaul projection seam | only via `ContextManager.build`'s `if(adapter)` branch |
| `context/context-manager.ts buildCuratedMessages` | "adapter-less" plain path, no curation | the `else` branch |
| `context/context-manager.ts ContextManager.build` | dispatches the two above | **instrumented live — NEVER fired** |
| `context/context-curator.ts defaultContextCurator.curate` | wraps `build`; `ContextCurator` is **injectable** | `think.ts:331` calls it, but `build` didn't run → diverged/bypassed |

Consequences we hit, in order:
1. **Dead seams.** The age-aware curation default-on (`c9e6fba2`) and the overhaul projection both sit in `buildConversationMessages`, which the live path doesn't reach. Edits looked correct, passed unit tests, and **never ran**.
2. **No way to know what executes.** Caller-grep, unit-green, and a present src edit all proved nothing; only runtime instrumentation revealed the truth. (`require.resolve` → reasoning runs from **src**, not dist — yet `ContextManager.build` still never fired.)
3. **No observability of the rendered prompt.** We built an *external Ollama proxy* to see the wire; `metadata.toolCalls` came back empty. We inferred tool use from file format — wrongly.
4. **Model-facing indirection** lives in this layer: the flat `TOOL_RESULT_INLINE_CAP = 4000` truncation, `[STORED:]` markers, `recall(...)` hints — the exact strings weak models copy into deliverables.

**The multiplicity + opacity IS the disease.** No feature should be wired until there is ONE assembler and we can see its output.

## The design — one pure pipeline

### Single entry, single owner
```ts
// The SOLE authority for what an LLM iteration receives. think.ts and every
// strategy call ONLY this. No alternate builders.
function assembleContext(input: AssemblyInput): AssemblyResult;

interface AssemblyInput {
  readonly eventLog: readonly Step[];        // steps[] — what systems observe
  readonly conversation: readonly KernelMessage[]; // messages[] — provider thread (storedKey intact)
  readonly resultStore: ReadonlyMap<string, StoredResult>; // system-owned full bodies
  readonly capability: ResolvedCapability;   // window, outputBudget, dialect, tier — resolved ONCE
  readonly focus: GoalState;                  // goal + remaining post-conditions (recency anchor)
  readonly tools: ToolRegistrySnapshot;
  readonly persona: PersonaParts;
  readonly options?: AssemblyOptions;         // DI/test seam ONLY (no parallel impls)
}

interface AssemblyResult {
  readonly request: ProviderRequest;          // { systemPrompt, messages, tools } — exactly what is sent
  readonly trace: AssemblyTrace;              // always-on observability (see below)
}
```
`ContextCurator` as an *injectable interface with a production impl + parallel builders* is **removed**. The only seam is `AssemblyOptions` for test doubles at the boundary — not swappable rendering logic.

### A pure pipeline of named stages
`assembleContext` runs an ordered list of pure `(AssemblyCtx) → AssemblyCtx` stages. Each stage is individually unit-testable, emits a trace entry, and has no hidden branches. The current four builders collapse into these stages:

1. **resolveCapability** — one source of truth: `{ window, outputBudget, dialect, tier }`. *Every* downstream budget (recency, aged, compaction, num_ctx) derives from this. Kills the 8192/32768/15360/maxContextTokens drift. *(principle #5)*
2. **systemPrompt** — stable KV-cache-friendly prefix: persona + instructions, then the **goal + remaining post-conditions recited into recency**. Single author (already the curator's job). *(Manus/12-factor)*
3. **selectTools** — stable, minimal, masked set (mask-don't-remove). Deterministic. *(principle #8)*
4. **projectResults** — **the core.** For each stored tool result, deterministically choose:
   - **present-full** when it fits the recency budget (model may reason/transcribe);
   - **summarize+ref** when it overflows → a clean system summary naming `result_ref`, pointing at `write_result_to_file` — **no `[STORED:]` marker, no preview, no `recall(...)` hint**;
   - **clear-aged** for deep-history results → reversible system pointer, re-expanded by the system on focus (auto-rehydration), never by a model tool.
   This is where today's `compressToolResult` / `TOOL_RESULT_INLINE_CAP` / `applyAgeAwareCuration` / the overhaul projection **all unify into one deterministic stage.** *(principles #1/#2/#7)*
5. **compactHistory** — near the window limit, high-fidelity summarize old turns. *(Anthropic)*
6. **finalize** — `toProviderMessage`, assemble `ProviderRequest`, emit the `AssemblyTrace`.

### Observability is built in (principle #4)
`finalize` always emits an `AssemblyTrace` — never optional, never an external proxy:
```ts
interface AssemblyTrace {
  readonly capability: ResolvedCapability;
  readonly tools: readonly string[];                  // exactly what was offered
  readonly messages: readonly { role: string; chars: number; tokensEst: number; projection?: "full" | "summary+ref" | "cleared" }[];
  readonly stages: readonly { name: string; note: string }[]; // what each stage changed
  // paired post-hoc with the provider response:
  readonly response?: { doneReason: string; promptTokens: number; evalTokens: number; toolCalls: string[] };
}
```
"What did the model receive + what did it return" becomes a durable, queryable artifact. No more inferring tool use from file format.

### What stays out of assembly
- **No LLM calls** in assembly — fully deterministic. *(principle #7; no LLM re-verify — M3 REWORK)*
- **No verification** — assembly *recites* the post-condition ledger into recency; the content-aware verifier (principle #3) consumes the same `GoalState`, so model and verifier share one truth.

## Pain-point → solution map
| pain (this session) | canonical solution |
|---|---|
| 4 overlapping builders, can't tell what's live | ONE `assembleContext` entry; parallel builders deleted |
| dead seams (curation/projection never ran) | single path → a seam is either in the pipeline or doesn't exist |
| can't see the rendered prompt | always-on `AssemblyTrace` (built into finalize) |
| `[STORED:]`/recall markers copied by weak models | `projectResults` summarize+ref / clear-aged — no model-facing markers |
| flat 4000 truncation, age/window-blind | `projectResults` budgets derive from resolved capability, per-age |
| budget/num_ctx drift across files | `resolveCapability` single source; all budgets derived |
| honesty (success ≠ what was produced) | shared `GoalState`; assembly recites, verifier checks content |

## Migration — strangler-fig, control-first, ablation-gated
1. **Phase 0 — PIN the live path.** Instrument `defaultContextCurator.curate` entry + read `think.ts` (~320-340) stream-vs-complete branches + how the curator is injected. Produce a one-page "what renders the live prompt today" note. *Nothing changes yet.*
2. **Phase 1 — single entry, byte-identical.** Define `assembleContext` + stage interfaces + `AssemblyTrace`. Route `think.ts` (the real live call) through `assembleContext`, which **initially delegates to the existing live builder** and emits the trace. Result: the live path is now SINGLE + OBSERVABLE with **zero behavior change** (trace-diff = identical). This is the control.
3. **Phase 2 — collapse the builders.** Migrate each stage's logic into its canonical pure stage; delete `buildConversationMessages` / `buildCuratedMessages` / the `ContextManager.build` dispatch / the injectable-curator swap. Each migration gated: `AssemblyTrace` diff identical, or the delta is ablation-justified (≥3pp / ≤15% tokens).
4. **Phase 3 — land the overhaul features in the ONE path.** `projectResults` summarize+ref + `write_result_to_file` offering live here. Now they actually run. Verify on the wire-measured failure class (20-commit overflow, dishonest-success) cross-tier, N≥3, per-component attribution.
5. **Phase 4 — verify the curation ship.** Confirm whether `c9e6fba2` (age-aware curation default-on, main) ever affected the live loop; fold its intent into `projectResults` and reconcile main.

## Done criteria
- `think.ts` and all strategies assemble via **one** `assembleContext`; the 4 legacy builders are deleted (no dead alternates).
- Every iteration emits an `AssemblyTrace`; "what the model received" is dumpable without an external proxy.
- `projectResults` is the single budget/projection authority; no `[STORED:]`/recall markers reach the model; budgets derive from `resolveCapability`.
- Phase-1 byte-identical control proven by trace-diff before any behavior change.

## Open questions (resolve during Phase 0/1)
- Where exactly does the live prompt get rendered today (the unpinned curator binding / think.ts branch)?
- Does `ContextManager.build` have *any* live caller, or is the whole `context-manager.ts` path legacy?
- Is the post-condition `GoalState` (Phase-1 spine) already threaded to assembly, or does it need a new input?
