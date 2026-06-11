---
type: design-analysis
status: analysis-complete
created: 2026-06-11
tags: [canonical-path, tool-execution, plan-execute, kernel, architecture, FM-I]
---

# Deep Analysis: Canonical Tool-Execution Path

> Pre-design architectural analysis for the canonical-path consolidation. Two parallel read-only inventories (tool-execution divergence; orchestration divergence) cross-referenced. **Headline: the two divergence axes have OPPOSITE verdicts — orchestration divergence is legitimate and must be preserved; tool-execution divergence is accidental and is the entire scope of the fix.**

## 1. The reframe (most important finding)

The user's instinct — "strategies diverge depending on reactive vs heavier; strength and weakness" — is **precisely correct, and the line falls exactly between two layers:**

| Layer | Divergent? | Verdict | Action |
|---|---|---|---|
| **Orchestration** (outer loop shape: BFS, plan-refine, critique-improve, dispatch) | Yes | **LEGITIMATE** — genuinely different control flow; cannot collapse without losing the strategies | **Preserve. Do not touch.** |
| **Tool execution + observation** (execute a tool, compress, observe, emit) | Yes | **ACCIDENTAL** — plan-execute reimplements an impoverished copy of the kernel's tool handling | **Canonicalize. This is the fix.** |

The shared kernel is the strength. The *per-strategy reimplementation of tool execution* is the weakness. They are cleanly separable.

## 2. Orchestration divergence — LEGITIMATE (inventory verdict)

Agent-2 matrix (strategies × {context-assembly, output-synthesis, termination, result-record, RI-loop}) found:

- **Canonical building blocks are well-factored and correctly used**: `buildKernelInput` (kernel/state/), `buildStrategyResult` + `makeStep` (sense/step-utils), `runKernel`/`runPass`/`iterateUntil` (loop/), `enforceQualityGate`+`collectToolData`+`decideSynthesisInput` (loop/finalize), `terminate` + arbitrator (single owner, no strategy bypasses it for per-iteration termination).
- **Every reimplemented outer-loop is legitimate**: plan-execute's multi-pass plan→execute→reflect (1234 LOC), reflexion's critique-improve via `iterateUntil` (909), ToT's BFS frontier expansion (881), code-action's sandbox loop (separate domain). These are different *control-flow shapes*, not duplicated logic.
- **Only "accidental" items found are cosmetic**: direct/reactive build a `KernelInput` literal inline instead of via `buildKernelInput` — zero functional consequence (field set complete). Optionally tidy; not in scope.
- One small future tidy: plan-execute + ToT both hand-wire the RI dispatcher at outer-loop boundaries (~20 LOC each) — a shared `invokeRIDispatcher` helper is possible but low ROI.

**Conclusion: do NOT refactor orchestration. "Unify all strategies into one path" is the wrong move — it would delete the strategies' reason to exist.**

## 3. Tool-execution divergence — ACCIDENTAL (the fix)

Agent-1 mapped every tool-execution site. The kernel act phase (`act.ts` + `tool-execution.ts`) is the rich, canonical path. plan-execute's `tool_call` direct-dispatch branch (`step-executor.ts:123-257`) is a **parallel reimplementation missing 9 capabilities the kernel provides:**

| # | Capability | Kernel act | plan-execute tool_call | Consequence of the gap |
|---|---|---|---|---|
| 1 | Healing pipeline (name/param/path/type repair) | ✓ `act.ts:221-237` | ✗ | malformed tool calls fail hard instead of auto-recovering |
| 2 | `observation.tool-result` compose tag | ✓ `act.ts:791` | ✗ | **the reported bug** — `.on()` hooks dead |
| 3 | `lifecycle.failure` / `nudge.healing-failure` tags | ✓ | ✗ | external observers blind to tool errors |
| 4 | Verifier on tool obs | ✓ `act.ts:600-608` | ✗ | arbitrator can't read verification on these steps |
| 5 | Semantic memory store (daemon) | ✓ | ✗ | tool observations lost to episodic memory |
| 6 | Error-recovery guidance hook | ✓ `act.ts:566-575` | ✗ | no "try this instead" hints on failure |
| 7 | Scratchpad auto-store of compressed result | ✓ | ✗ | different downstream data flow |
| 8 | Deterministic fact extraction | ✓ | ✗ | large results lose detail |
| 9 | Observation step built in-place (guaranteed metadata) | ✓ `makeStep`+`makeObservationResult` | ✗ caller must build it | metadata-omission risk (no build-time guarantee) |

**Two execution cores already exist** in `tool-execution.ts`: `executeToolCall` (text-parsed args) and `executeNativeToolCall` (pre-parsed FC args). The kernel uses `executeNativeToolCall`. plan-execute uses NEITHER — it hand-rolls `toolService.execute` + `compressToolResult`. Since plan-execute's `step.toolArgs` are already structured, it is morally a *native* call.

### Legitimate differences within the tool path (must be preserved, parameterized — NOT forked)

plan-execute deliberately differs on two points for sound reasons tied to its tool-less downstream prompts:
- **`stripDeadStorageHints`** (`step-executor.ts:249`): plan-execute injects results into analysis/reflection/synthesis prompts that have no `recall()` mechanism, so `[STORED:]` pointers are dead and invite fabrication. The kernel keeps hints (its conversation thread can recall).
- **No scratchpad auto-store**: plan-execute passes `fullResult` string to synthesis rather than a scratchpad key.

These are **legitimate data-flow differences, parameterized via config** (`ToolExecutionConfig.scratchpad` presence ⇒ store; a `stripHints` flag), not justifications for a separate implementation.

## 4. Downstream contract (what a canonical path MUST emit)

Consumers reading the observation step's `observationResult` (must all be populated for parity): `success`, `toolName`, `displayText`, `category`, `resultKind`, `preserveOnCompaction`, `trustLevel`, `delegatedToolsUsed?`. Readers: guard pipeline, requirement-state, evidence-grounding, conversation-assembly, arbitrator, auto-checkpoint, ContextCurator. Events required: `ToolCallStarted` (rationale → debrief), `ToolCallCompleted` (→ MetricsCollector). plan-execute already emits the two events manually with matching payloads; it omits everything else.

## 5. Performance constraints (retain or improve)

- **Keep `tool_call` as direct dispatch** — it deliberately skips the LLM think phase for a pre-planned tool call. Routing it through the full kernel would add an LLM round-trip per tool step. The canonical primitive must be callable WITHOUT a kernel loop.
- The added capabilities are cheap: healing is heuristic (µs), compose-emit is fire-and-forget, fact-extraction is deterministic. The only non-trivial costs — verifier and semantic-memory — stay **opt-in per caller** (plan-execute `tool_call` keeps them off; it has its own reflection gate). So parity-or-better: plan-execute gains healing + emit + guaranteed metadata at ~zero cost, opts out of the heavy enrichments.
- `analysis` steps stay a direct `llm.complete` (no tool to observe) — out of scope.

## 6. Target architecture (for the design section)

One shared primitive — `executeToolAndObserve` — wrapping: healing → `executeNativeToolCall` (existing core) → fact extraction → compression (params: `storeMode`, `stripHints`) → build observation step (`makeObservationResult`) → emit `ToolCall*` events + `observation.tool-result`/`lifecycle.failure`/`nudge.healing-failure` → optional verifier → optional semantic-memory store. Returns `{ obsStep, content, fullResult, success, storedKey, observationResult }`.

- **Callers**: kernel `act.ts` (replaces inline 600-815 block) and plan-execute `step-executor.ts` tool_call branch (replaces hand-rolled 123-257). Both supply a `ComposeEmitContext` (kernel passes real `KernelState`; plan-execute synthesizes a minimal `KernelStateLike` from plan id + stepIndex).
- **Scope guard**: this is `kernel/capabilities/act/` (kernel-warden territory) + `strategies/plan-execute/` (main-thread). Equivalence test pins act.ts emitted obsStep+tags byte-identical pre/post (hot-path guard). New plan-execute integration test: `observation.tool-result` fires on a tool_call step (currently 0).

## 7. Explicitly out of scope (anti-creep)

- Orchestration outer loops (legitimate divergence, §2).
- code-action (separate sandbox domain).
- analysis-step LLM path (no tool to observe).
- direct/reactive inline-literal tidy (cosmetic).
- `invokeRIDispatcher` shared helper (low ROI; separate cleanup).
