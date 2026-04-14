# Kernel Architecture Rescue — Design Spec

> **Scope:** Reasoning package kernel + typed meta bag (crosses into runtime). Excludes execution-engine.ts / builder.ts decomposition (Zone B follow-up).
>
> **Goal:** Complete the half-finished context architecture migration, eliminate all dead code and type debt, wire the observation pipeline end-to-end, build a per-model calibration system, and deliver a lean, type-safe, high-performing kernel ready for V1.0.
>
> **Success criteria:** Zero `as any` in reasoning package (except SDK type gaps). Zero dead production code. Single context assembly path. Per-model calibration drives all model-adaptive behavior. Evidence grounding gates final output. Agent performance on scratch.ts crypto task improves or holds.

---

## Table of Contents

1. [Diagnosis: What Went Wrong](#1-diagnosis-what-went-wrong)
2. [Architectural Principles](#2-architectural-principles)
3. [Section 1: Eliminate Dual-Channel Guidance](#3-section-1-eliminate-dual-channel-guidance)
4. [Section 2: ContextManager as Sole Context Path](#4-section-2-contextmanager-as-sole-context-path)
5. [Section 3: Observation Pipeline](#5-section-3-observation-pipeline)
6. [Section 4: Typed Meta Bag](#6-section-4-typed-meta-bag)
7. [Section 5: think.ts Decomposition + Evidence Grounding](#7-section-5-thinkts-decomposition--evidence-grounding)
8. [Section 6: Dead Code Purge + ReActKernelInput Merge](#8-section-6-dead-code-purge--reactkernelinput-merge)
9. [Section 7: Calibration System](#9-section-7-calibration-system)
10. [Section 8: Message Window Simplification](#10-section-8-message-window-simplification)
11. [Section 9: context-builder.ts → context-utils.ts](#11-section-9-context-builderts--context-utilsts)
12. [Section 10: tool-utils.ts Decomposition](#12-section-10-tool-utilsts-decomposition)
13. [Section 11: Barrel Export Cleanup](#13-section-11-barrel-export-cleanup)
14. [Section 12: Layer Violation Fix](#14-section-12-layer-violation-fix)
15. [Section 13: Validation Strategy](#15-section-13-validation-strategy)
16. [File Change Summary](#16-file-change-summary)
17. [Execution Order](#17-execution-order)
18. [Risk Assessment](#18-risk-assessment)

---

## 1. Diagnosis: What Went Wrong

Over ~50 commits, 5 overlapping plans were executed in parallel:

- **Context Architecture Overhaul** — Phases 0a-3 completed. Phase 4 (unify guidance into GuidanceContext, remove USER injections) never done.
- **Observation Quality Pipeline** — 3 bugs fixed. LLM extraction added. But deterministic fact extraction never implemented and `buildPriorWorkSection()` never wired.
- **Wire Observation Facts Pipeline** — All 3 phases still pending.
- **Fix Reactive Output Quality** — Web snippet cleaning, quality gates improved. But the output quality gates aren't connected to evidence grounding.
- **Context Pipeline Redesign** — Calibration system designed. Never implemented.

The result: two half-finished architectures coexist. The old scattered-injection pattern and the new centralized-guidance pattern both operate simultaneously, producing conflicting signals that confuse models — especially local ones.

**Key metrics of the problem:**
- 8 active USER message injection sites across think.ts + act.ts
- `ContextManager.build()` has 18 tests but zero production callers
- `buildPriorWorkSection()` and `buildProgressSection()` built but never wired
- 44 `as any` casts in reasoning package from untyped `state.meta` bag
- `ReActKernelInput` duplicates ~25 fields from `KernelInput` with 5 cast sites
- ~550 LOC of dead production code (evidence-grounding unwired, context-utils unused)
- `tool-utils.ts` at 944 LOC with 5+ concerns, imported by 16 files
- `kernel/index.ts` leaks internal utils via `export *` from 13 modules
- Hard-coded tier adapters guess at model behavior instead of measuring it

---

## 2. Architectural Principles

These principles govern all decisions in this spec:

### 2.1 Single Owner for Context

Everything the model sees comes from `ContextManager.build()`. No phase independently assembles system prompts or injects messages. One function, one call, one output: `{ systemPrompt, messages }`.

### 2.2 Guidance Through System Prompt, Delivery Calibrated Per-Model

All harness steering signals flow through `pendingGuidance` on `KernelState`. The delivery channel (system prompt, user message, or hybrid) is determined by per-model calibration data, not hard-coded assumptions.

### 2.3 Recall Is a Utility, Not Critical Path

The model must have enough data to complete the task without ever calling recall. The Observations section in the system prompt and properly-sized tool_result content guarantee this. Recall remains available for ad-hoc deep dives into stored content.

### 2.4 Measure, Don't Guess

Per-model calibration replaces hard-coded tier behavior. Each calibration field exists because it drives a downstream harness decision that cannot be derived from model card, tier, or general LLM knowledge.

### 2.5 Every Field Earns Its Place

No speculative types, no unused schema fields, no "future use" placeholders. If a field doesn't have a consumer in production code, it doesn't exist.

### 2.6 Claims Must Be Grounded

The agent's final output is verified against session evidence before delivery. Ungrounded claims are flagged and trigger re-synthesis.

---

## 3. Section 1: Eliminate Dual-Channel Guidance

### Problem

8 sites in think.ts and act.ts inject `{ role: "user" }` messages into the conversation thread alongside the legitimate `pendingGuidance → Guidance:` system prompt section. The model sees competing signals from two channels.

### Solution

Every harness signal writes to `pendingGuidance` on `KernelState`. No phase ever appends a synthetic USER message to `state.messages`. The next think turn reads `pendingGuidance`, passes it to `ContextManager.build()`, which renders guidance per the model's calibrated `steeringCompliance` preference, then clears it.

### Injection Sites to Convert

| File | Line | Current behavior | New behavior |
|------|------|-----------------|-------------|
| `think.ts:619` | `blockMsg` | USER: "Required tools not satisfied, call X now" | Write to `pendingGuidance.requiredToolsPending` + return status "thinking" |
| `think.ts:690` | `redirectMsg` | USER: "Not done, still need to call X" | Write to `pendingGuidance.requiredToolsPending` |
| `think.ts:714` | `gapMsg` | USER: "Missing steps: ..." | Write to `pendingGuidance.oracleGuidance` |
| `think.ts:738` | `qcMsg` | USER: adapter quality check | Write to `pendingGuidance.qualityGateHint` |
| `think.ts:864` | `nudgeMessage` | USER: "Research sufficient, call X" | Write to `pendingGuidance.oracleGuidance` |
| `act.ts:790` | `progressMsg` | USER: "You must still call X" | Write to `pendingGuidance.actReminder` |
| `act.ts:819` | `finishMsg` | USER: "Required tools satisfied" | Write to `pendingGuidance.actReminder` |
| `act.ts:830` | `retryMsg` | USER: "Tool calls failed, retry" | Write to `pendingGuidance.errorRecovery` |

### After This Change

`state.messages` contains ONLY:
1. The initial user task message
2. Assistant turns (thought + tool_use)
3. FC protocol `tool_result` messages
4. `max_tokens` recovery (the one legitimate USER message, prefixed `[Harness]:`)

### Calibration-Driven Delivery

`ContextManager.build()` renders guidance based on `calibration.steeringCompliance`:

| Value | Behavior |
|-------|----------|
| `"system-prompt"` | Guidance rendered in system prompt `Guidance:` section only |
| `"user-message"` | Guidance rendered as a single short USER message appended to messages |
| `"hybrid"` | Guidance in system prompt AND a 1-line USER reminder after last tool_result |

When no calibration exists, falls back to tier default: `local` → `"hybrid"`, `mid` → `"hybrid"`, `large`/`frontier` → `"system-prompt"`.

The tier defaults are conservative — `"hybrid"` ensures local models get guidance through the higher-salience user message channel while the system prompt provides full context. Calibration overrides this when empirical data shows the model follows system prompts reliably.

---

## 4. Section 2: ContextManager as Sole Context Path

### Problem

`ContextManager.build()` exists (253 LOC, 18 tests) with zero production callers. think.ts manually assembles the system prompt by cherry-picking individual functions from context-manager.ts and context-engine.ts, maintaining its own 40-line assembly block.

### Solution

think.ts calls `ContextManager.build()` once and uses the returned `{ systemPrompt, messages }` directly.

### Current Flow (Scattered)

```
think.ts:
  1. base = buildSystemPrompt(state, input, profile)          // context-builder.ts
  2. patched = adapter.systemPromptPatch(base)                 // adapter hook
  3. static = buildStaticContext(input, profile)                // context-engine.ts
  4. guidance = buildGuidanceSection(pendingGuidance)           // context-manager.ts
  5. systemPrompt = [patched, static, elaboration, guidance]    // manual join in think.ts
  6. messages = buildConversationMessages(state, input, ...)    // context-builder.ts
```

### Target Flow (Single Owner)

```
think.ts:
  1. { systemPrompt, messages } = ContextManager.build(
       state, input, profile, guidance, adapter, calibration?
     )
  // Done. One call, one owner.
```

### ContextManager.build() Expanded Signature

```typescript
export const ContextManager = {
  build(
    state: KernelState,
    input: KernelInput,
    profile: ContextProfile,
    guidance: GuidanceContext,
    adapter: ProviderAdapter,
    calibration?: ModelCalibration,
  ): ContextManagerOutput
};
```

### System Prompt Sections (assembled in order)

1. **Identity** — tier-adaptive agent identity (1-3 lines)
2. **Adapter patch** — `adapter.systemPromptPatch(base)` applied
3. **Environment** — date/time/timezone/platform from `buildEnvironmentContext()`
4. **Task** — the task text
5. **Tools** — schema at profile-appropriate detail level from `buildToolReference()`
6. **Rules** — tier-aware rules from `buildRules()`
7. **Tool elaboration** — optional section when tool elaboration content provided
8. **Progress** — `[Iteration N/M] Called: web-search x4. Required: final-answer (pending).`
9. **Observations** — deterministic one-line facts from `extractedFact` on steps (see Section 3)
10. **Guidance** — rendered from `GuidanceContext` per `calibration.steeringCompliance`

### Message Array

`ContextManager.build()` calls `buildConversationMessages()` (moved from context-builder.ts, see Section 9) which applies the simplified message window (see Section 8) and returns the curated FC conversation thread.

### What Stays in think.ts

- Reading `pendingGuidance` from state and clearing it
- Assembling the `GuidanceContext` struct from pending signals
- Tool list preparation (meta-tool injection, classification pruning, context pressure narrowing)
- The LLM call itself (`llm.stream()` with the ContextManager output)
- Response parsing, FC resolution, and routing through guards

### Testability

`ContextManager.build()` is a pure function. Unit tests assert:
- Required-tool pending → `Progress:` section contains tool name
- Loop detected → `Guidance:` section contains loop message
- 4 completed searches → `Observations:` section lists 4 facts
- Calibration `"hybrid"` → messages array includes 1-line guidance USER message
- Calibration `"system-prompt"` → messages array has no guidance USER messages

---

## 5. Section 3: Observation Pipeline

### Problem

Three links in the observation pipeline are broken:

1. `extractObservationFacts()` runs on compressed content (800 chars), not raw — facts get truncated mid-sentence
2. `extractedFact` is never stored on step metadata (field exists but is never populated)
3. `buildPriorWorkSection()` is never called — system prompt has no Observations section

Local models can't synthesize answers from compressed web noise. The Observations section was designed to fix this but was never wired.

### Design Principle: Recall Is Not Critical Path

The observation pipeline must guarantee the model has enough data to complete the task without calling recall. Two mechanisms ensure this:

1. **Observations section in system prompt** — deterministic one-line facts extracted from raw content before compression. Always present. Primary recall mechanism for all models.
2. **Tool result content** — calibration-driven sizing ensures the `tool_result` message itself is useful.

Recall remains a registered tool for ad-hoc deep dives. No harness logic depends on the model calling it.

### Change 1: Deterministic Fact Extraction on Raw Content

New pure function in `tool-execution.ts`:

```typescript
export function extractFactDeterministic(
  toolName: string,
  args: Record<string, unknown>,
  rawResult: string,
): string | undefined
```

Regex-based extraction for common data patterns:
- Dollar amounts: `$1.33`, `$63,450.00`
- Percentages: `+0.91%`, `-2.3%`
- Dates and timestamps
- URLs for source attribution
- Key numbers near entity mentions from the tool arguments

Returns a one-liner: `"web-search('XRP price USD'): XRP $1.327, 24h vol $1.9B (source: revolut.com)"`

Falls back to `extractObservationFacts()` (existing LLM extraction, 200 tokens, temp=0) only when:
- Deterministic extraction finds nothing meaningful, AND
- Calibration is not `"needs-inline-facts"` (which means inline the content directly)

### Change 2: Execution Order Fix + Store on Step Metadata

In `act.ts`, both parallel batch and sequential paths:

```
BEFORE: raw → compress → extract(compressed) → makeStep(no extractedFact)
AFTER:  raw → extractFactDeterministic(raw) → compress → makeStep(extractedFact: fact)
```

The `extractedFact` field already exists on `StepMetadata` (added Apr 13). It just needs to be populated with the deterministic extraction result.

### Change 3: buildPriorWorkSection() Wired Through ContextManager

Already implemented in `context-manager.ts`. Reads `extractedFact` from `state.steps` where `step.type === "observation"`. Renders as:

```
Observations:
- web-search('XRP price USD'): XRP $1.327, 24h vol $1.9B (source: revolut.com)
- web-search('ETH price USD'): ETH $1,581.20 (source: coingecko.com)
- web-search('BTC price USD'): BTC $63,450 (source: binance.com)
- web-search('XLM price USD'): XLM $0.093 (source: coinmarketcap.com)
```

Appears in system prompt section 9 (see Section 2) on iteration 2+.

### Calibration Interaction

`calibration.observationHandling` drives the tool_result content strategy:

| Value | tool_result content | Recall hints | Observations section |
|-------|-------------------|--------------|---------------------|
| `"needs-inline-facts"` | Extracted fact replaces compressed preview. No scratchpad storage for small results. | None | Always present |
| `"uses-recall"` | Compressed preview + single recall hint | Present | Always present |
| `"hallucinate-risk"` | Larger inline excerpt (2x normal budget) | None | Always present |

The Observations section in the system prompt is always present regardless of calibration. It's cheap (one line per tool call) and provides redundant grounding that all models benefit from.

When no calibration exists, falls back to tier default: `local` → `"needs-inline-facts"`, `mid` → `"needs-inline-facts"`, `large` → `"uses-recall"`, `frontier` → `"uses-recall"`.

---

## 6. Section 4: Typed Meta Bag

### Problem

`state.meta: Readonly<Record<string, unknown>>` with 44 `as any` casts across the reasoning package. Every kernel phase reads and writes untyped properties.

### Solution

Replace with a typed `KernelMeta` interface. Each sub-group collects related concerns.

```typescript
// kernel-state.ts

export interface EntropyMeta {
  readonly score: number;
  readonly trajectory: "increasing" | "decreasing" | "stable";
  readonly history: readonly number[];
  readonly modelId?: string;
}

export interface ControllerDecision {
  readonly reason: string;
  readonly action: string;
  readonly iteration: number;
}

export interface KernelMeta {
  // ── Entropy & reactive observer ──
  readonly entropy?: EntropyMeta;
  readonly controllerDecisions?: readonly ControllerDecision[];

  // ── Tool execution tracking ──
  readonly pendingNativeToolCalls?: readonly ToolCallSpec[];
  readonly lastThought?: string;
  readonly lastThinking?: string;
  readonly gateBlockedTools?: readonly string[];

  // ── Termination & iteration control ──
  readonly terminatedBy?: string;
  readonly maxIterations?: number;
  readonly consecutiveLowDeltaCount?: number;
  readonly maxOutputTokensOverride?: number;

  // ── Quality gate state ──
  readonly qualityCheckDone?: boolean;
  readonly lastMetaToolCall?: string;

  // ── Harness delivery ──
  readonly harnessDeliveryAttempted?: boolean;
}
```

### Migration

1. Define `KernelMeta` in `kernel-state.ts`
2. Change `KernelState.meta` from `Readonly<Record<string, unknown>>` to `KernelMeta`
3. `transitionState()` spread pattern works unchanged — typed records spread identically
4. Find-and-replace all `(state.meta.X as any)` with `state.meta.X` — types now flow
5. Eliminate all `(state.meta as any).X = Y` mutations — use `transitionState` immutable update

### ContextProfile Fix

Several files cast `(input.contextProfile as any)?.maxTokens`. Add `maxTokens?: number` to `ContextProfile` schema properly. Audit all `contextProfile as any` access patterns and add any missing fields to the schema.

### Impact

| File | `as any` before | `as any` after |
|------|----------------|---------------|
| reactive-observer.ts | 16 | 0 |
| think.ts | 12 | 0 |
| message-window.ts | 8 | 0 |
| act.ts | 4 | 0 |
| kernel-runner.ts | 1 | 0 |
| loop-detector.ts | 1 | 0 |
| reflexion.ts | 1 | 1 (SDK type gap) |
| context-manager.ts | 1 | 0 |
| **Total reasoning** | **44** | **~1** |

---

## 7. Section 5: think.ts Decomposition + Evidence Grounding

### Problem

think.ts is 997 LOC with 10+ concerns: system prompt assembly, LLM streaming, FC parsing, completion gap detection, quality check routing, required-tool redirect, gate blocking, nudge injection, entity validation, preamble stripping.

### Solution: Extract think-guards.ts

New file: `phases/think-guards.ts` (~300 LOC)

Each guard is a pure function that returns either a state transition (redirect the model) or `undefined` (proceed normally):

```typescript
/** Required tools not satisfied and model tried to skip them */
export function guardRequiredToolsBlock(
  rawCalls: ToolCallSpec[],
  input: KernelInput,
  state: KernelState,
  profile: ContextProfile,
  hooks: KernelHooks,
): KernelState | undefined;

/** Model gave final_answer but required tools aren't done */
export function guardPrematureFinalAnswer(
  input: KernelInput,
  state: KernelState,
  profile: ContextProfile,
  adapter: ProviderAdapter,
): KernelState | undefined;

/** Dynamic completion gaps detected */
export function guardCompletionGaps(
  input: KernelInput,
  state: KernelState,
  newSteps: ReasoningStep[],
): KernelState | undefined;

/** Verify claims in output against session evidence */
export function guardEvidenceGrounding(
  output: string,
  state: KernelState,
): KernelState | undefined;

/** Adapter quality check before accepting prose answer */
export function guardQualityCheck(
  input: KernelInput,
  state: KernelState,
  profile: ContextProfile,
  adapter: ProviderAdapter,
): KernelState | undefined;

/** Research shows diminishing returns, redirect to synthesis */
export function guardDiminishingReturns(
  state: KernelState,
  input: KernelInput,
  novelty: number,
): KernelState | undefined;
```

### Guard Chain in think.ts

```typescript
// After parsing LLM response, route through guards
const redirect =
  guardRequiredToolsBlock(rawCalls, input, state, profile, hooks) ??
  guardPrematureFinalAnswer(input, state, profile, adapter) ??
  guardCompletionGaps(input, state, newSteps) ??
  guardEvidenceGrounding(output, state) ??
  guardQualityCheck(input, state, profile, adapter) ??
  guardDiminishingReturns(state, input, novelty);

if (redirect) return redirect;
// proceed with normal result handling
```

Each guard that fires writes to `pendingGuidance` on the returned state (per Section 1). No USER message injection.

### Evidence Grounding: How It Works

`guardEvidenceGrounding()` runs when the model produces a final answer. It:

1. **Extracts claims** from the output — numbers, prices, dates, percentages, specific data points
2. **Compares each claim** against `extractedFact` values stored on observation steps in `state.steps`
3. **Flags ungrounded claims** — data points in the output that don't appear in any session evidence
4. **Decision:**
   - If >80% of claims are grounded → accept the output
   - If <80% grounded → write ungrounded claims to `pendingGuidance.evidenceGap` and return "thinking" status to trigger re-synthesis

The existing `evidence-grounding.ts` (112 LOC) is refactored to work with `extractedFact` data rather than raw step content. The core logic stays in `evidence-grounding.ts` (it's a utility), and `guardEvidenceGrounding()` in `think-guards.ts` calls into it.

### PendingGuidance Update

`PendingGuidance` needs a new optional field for evidence grounding:

```typescript
export interface PendingGuidance {
  // ... existing fields ...
  /** Ungrounded claims detected in final answer — triggers re-synthesis */
  readonly evidenceGap?: string;
}
```

`buildGuidanceSection()` in ContextManager renders this as: `"Your answer contains claims not supported by tool results: [list]. Revise using only data from the Observations above."`

### think.ts After Extraction (~700 LOC)

Structure:
1. Constants and imports (~50 LOC)
2. `shouldNarrowToFinalAnswerOnly()` — context pressure check (~10 LOC)
3. `handleThinking()` main function:
   - Tool list preparation (meta-tool injection, pruning, narrowing) (~80 LOC)
   - Get context from `ContextManager.build()` (~10 LOC)
   - LLM stream call + token accumulation (~100 LOC)
   - FC resolution / text parsing (~150 LOC)
   - Guard chain routing (~20 LOC)
   - Normal result handling (tool calls → acting, final answer → done) (~280 LOC)

---

## 8. Section 6: Dead Code Purge + ReActKernelInput Merge

### Dead Production Code to Delete

| File | LOC | Evidence |
|------|-----|---------|
| `context-utils.ts` (kernel/utils/) | 240 | Zero src/ imports. Only re-exported from barrel, used only in tests. |
| Tests for `context-utils.ts` | ~120 | Tests for dead code |

Note: `evidence-grounding.ts` is NOT deleted — it is refactored and wired into the guard chain (Section 5).

### ReActKernelInput Merge

**Current:** `ReActKernelInput` (lines 528-601 in kernel-state.ts) duplicates ~25 fields from `KernelInput`. 5 sites cast `(input as ReActKernelInput)` to access:
- `toolCallResolver` — the native FC resolver
- `allToolSchemas` — the complete tool schema list before filtering

**Fix:** Add these 2 fields as optional to `KernelInput`:

```typescript
export interface KernelInput {
  // ... existing fields ...

  /** Native function calling resolver (when provider supports FC) */
  readonly toolCallResolver?: ToolCallResolver;
  
  /** Complete tool schema list before filtering (for completion gap detection) */
  readonly allToolSchemas?: readonly ToolSchema[];
}
```

`ReActKernelInput` becomes a type alias for backward compatibility:

```typescript
/** @deprecated Use KernelInput directly. Preserved as alias for existing consumers. */
export type ReActKernelInput = KernelInput;
```

All 5 `as ReActKernelInput` cast sites replaced with direct property access.

### Net Deletion

~360 LOC of dead code removed. ~75 LOC of duplicated interface collapsed. 5 `as ReActKernelInput` casts eliminated.

---

## 9. Section 7: Calibration System

### Scope

Build the foundation: schema, probe suite, buildCalibratedAdapter, selectAdapter upgrade, builder integration, pre-bake 3 popular models. NOT the real-time evolution layer (V1.1+).

### ModelCalibration Schema

```typescript
// packages/llm-provider/src/calibration.ts

import { Schema } from "effect";

export const ModelCalibrationSchema = Schema.Struct({
  /** The model identifier (e.g., "gemma4:e4b", "llama3.2:3b") */
  modelId: Schema.String,
  
  /** ISO timestamp of calibration run */
  calibratedAt: Schema.String,
  
  /** Probe suite version — old calibrations degrade gracefully when this increments */
  probeVersion: Schema.Number,
  
  /** Number of probe runs averaged for stability */
  runsAveraged: Schema.Number,

  /** Does this model follow steering better in system prompt, user message, or both? */
  steeringCompliance: Schema.Literal("system-prompt", "user-message", "hybrid"),

  /** Can this model reliably batch independent tool calls in one turn? */
  parallelCallCapability: Schema.Literal("reliable", "partial", "sequential-only"),

  /** Given compressed preview + recall hint, does it call recall or hallucinate? */
  observationHandling: Schema.Literal("uses-recall", "needs-inline-facts", "hallucinate-risk"),

  /** After 4+ turns, does the model still follow system prompt rules? */
  systemPromptAttention: Schema.Literal("strong", "moderate", "weak"),

  /** Optimal chars per tool result before hallucination starts */
  optimalToolResultChars: Schema.Number,
});

export type ModelCalibration = typeof ModelCalibrationSchema.Type;
```

**Every field passes the necessity test:**

| Field | Can't derive from | Drives |
|-------|-------------------|--------|
| `steeringCompliance` | Model card, tier, general knowledge | `ContextManager.build()` guidance delivery channel |
| `parallelCallCapability` | Model size (some 7B batch, some 14B don't) | `maxBatch` in tool gating, parallel hint in RULES |
| `observationHandling` | Provider capabilities | Observation pipeline: inline-facts vs compress+recall |
| `systemPromptAttention` | Architecture (varies per fine-tune) | Rule repetition strategy, hybrid guidance on later turns |
| `optimalToolResultChars` | Context window size (truncation kills mid-fact) | `toolResultMaxChars` in ContextProfile |

### Probe Suite

5 scenarios, one per calibration field. Temperature 0, deterministic. Each probe is a self-contained chat call with tools.

**Probe 1 — Steering Channel (→ `steeringCompliance`)**
- Setup: Give identical instruction ("respond with ONLY the word 'blue'") in three variants: system-only, user-only, and both
- Measure: Which variant the model follows most reliably across 3 runs
- Output: majority vote across runs

**Probe 2 — Parallel Batching (→ `parallelCallCapability`)**
- Setup: Two independent tools (`get_a`, `get_b`). Task: "Get A and B simultaneously"
- Measure: Did it issue both calls in one turn, or sequentially?
- Output: `"reliable"` if 3/3 batch, `"partial"` if 1-2/3, `"sequential-only"` if 0/3

**Probe 3 — Recall Behavior (→ `observationHandling`)**
- Setup: Compressed preview with `recall("_tool_result_1")` hint. Ask model to answer using the data.
- Measure: Does it call recall, hallucinate the data, or say "I don't have enough information"?
- Output: categorize response

**Probe 4 — System Prompt Decay (→ `systemPromptAttention`)**
- Setup: Rule in system prompt: "Always end responses with [VERIFIED]". Run 5 tool-call turns.
- Measure: Does turn 5 response still end with [VERIFIED]?
- Output: `"strong"` if 3/3 comply on turn 5, `"moderate"` if 1-2/3, `"weak"` if 0/3

**Probe 5 — Compression Threshold (→ `optimalToolResultChars`)**
- Setup: Same factual content at 500, 1000, 1500, 2000 chars (padded with surrounding text). Ask model to extract the fact.
- Measure: At which length does extraction accuracy drop (hallucinated or missed fact)?
- Output: the char count at the highest compression where extraction still succeeds

**Run configuration:** 3 runs per probe, majority for categoricals, median for numerics. Total: ~15 Ollama calls, <30 seconds for local models.

### buildCalibratedAdapter()

```typescript
// packages/llm-provider/src/calibration.ts

export function buildCalibratedAdapter(
  calibration: ModelCalibration,
): { adapter: ProviderAdapter; profileOverrides: Partial<ContextProfile> } {
  const adapter: ProviderAdapter = {
    // steeringCompliance drives guidance delivery in ContextManager
    // (passed through, not an adapter hook — ContextManager reads calibration directly)
    
    // systemPromptAttention drives rule repetition
    systemPromptPatch: calibration.systemPromptAttention === "weak"
      ? (base) => base + "\nIMPORTANT: Follow ALL rules above exactly."
      : undefined,

    // parallelCallCapability drives tool guidance
    toolGuidance: calibration.parallelCallCapability === "sequential-only"
      ? () => "Call tools one at a time. Do not batch multiple tool calls."
      : calibration.parallelCallCapability === "partial"
        ? () => "You may call up to 2 independent tools at once."
        : undefined,

    // Existing hooks preserved from tier adapters where calibration doesn't override
    taskFraming: undefined,  // use tier default
    continuationHint: undefined,
    errorRecovery: undefined,
    synthesisPrompt: undefined,
    qualityCheck: undefined,
  };

  const profileOverrides: Partial<ContextProfile> = {
    toolResultMaxChars: calibration.optimalToolResultChars,
  };

  return { adapter, profileOverrides };
}
```

### selectAdapter() Upgrade

```typescript
export function selectAdapter(
  capabilities: ProviderCapabilities,
  tier?: string,
  modelId?: string,
): { adapter: ProviderAdapter; profileOverrides?: Partial<ContextProfile> } {
  // 1. Calibrated adapter wins if available
  if (modelId) {
    const calibration = loadCalibration(modelId);
    if (calibration) return buildCalibratedAdapter(calibration);
  }
  // 2. Fall back to tier-based adapter
  if (tier === "local") return { adapter: localModelAdapter };
  if (tier === "mid") return { adapter: midModelAdapter };
  return { adapter: defaultAdapter };
}
```

`loadCalibration()` checks:
1. Pre-baked JSONs in `packages/llm-provider/src/calibrations/<modelId>.json`
2. User cache at `~/.reactive-agents/calibrations/<modelId>.json`

Model ID normalization: colons → hyphens, lowercase, trim version tags for matching.

### Builder Integration

```typescript
// packages/runtime/src/builder.ts

.withCalibration(mode: "auto" | "skip" | ModelCalibration)
```

| Mode | Behavior |
|------|----------|
| `"auto"` | Check for cached calibration. If found, use it. If not, run probe suite before agent starts. Cache result. |
| `"skip"` | Pure tier-based behavior. No calibration, no probes. |
| `ModelCalibration` object | User-provided calibration data. Used directly, no probes. |

Default when `.withCalibration()` is not called: behaves as `"skip"` for backward compatibility. Users opt into calibration explicitly.

### Pre-Baked Calibrations

Stored in `packages/llm-provider/src/calibrations/`:
- `gemma4-e4b.json`
- `llama3.2-3b.json`
- `qwen2.5-coder-7b.json`

These ship with the framework. When a user runs `.withProvider("ollama").withModel("gemma4:e4b")`, `selectAdapter()` finds the pre-baked calibration automatically — no explicit `.withCalibration()` needed.

### CLI Command

```bash
bun run calibrate --model gemma4:e4b              # single run
bun run calibrate --model gemma4:e4b --runs 3     # average 3 runs
bun run calibrate --model gemma4:e4b --commit      # write to src/calibrations/ for framework shipping
```

---

## 10. Section 8: Message Window Simplification

### Problem

`applyMessageWindowWithCompact` manages `frozenToolResultIds` — a set that prevents re-compaction of tool results the model might need to recall. With recall off the critical path (Section 3), frozen ID tracking is unnecessary complexity.

### Solution

Simplify to a single sliding window. The Observations section in the system prompt preserves distilled data. The message window's job is to keep the FC conversation thread within token budget — nothing more.

### Changes

1. **Remove `frozenToolResultIds`** from `KernelState`. Remove all tracking in `applyMessageWindowWithCompact` and all `transitionState` calls that update it.

2. **Single-pass sliding window:** Keep first user message + last N turns. Older turns summarized as `[Prior: called X → brief result]`. N is tier-based: local=2, mid=3, large=5, frontier=8 (existing `KEEP_FULL_TURNS_BY_TIER` values).

3. **No recall hints in compacted messages.** Old tool results that get compacted don't include "use recall(...)" hints. The data is in the Observations section.

4. **Token budget check remains** — window only fires when message array exceeds 75% of `maxTokens`. Most of the time, the message array stays under budget because ContextManager.build() curates it.

### Net Result

`message-window.ts` drops from 127 LOC to ~80 LOC. Frozen ID logic (~30 LOC) deleted. Simpler, more predictable compaction.

---

## 11. Section 9: context-builder.ts → context-utils.ts

### Problem

After ContextManager becomes the sole context path, `context-builder.ts` (180 LOC) has functions that either move into ContextManager or become standalone utilities. Its name ("builder") implies it's a phase, but it becomes a utility module.

### Solution

Rename to `context-utils.ts` (in `phases/` directory). Clarify which functions live where:

| Function | Current home | New home | Reason |
|----------|-------------|----------|--------|
| `buildSystemPrompt()` | context-builder.ts | ContextManager.build() internal | Identity section of system prompt |
| `toProviderMessage()` | context-builder.ts | context-utils.ts | Pure conversion utility, called by ContextManager |
| `buildToolSchemas()` | context-builder.ts | context-utils.ts | Pure utility, called by ContextManager and think.ts |
| `buildConversationMessages()` | context-builder.ts | context-utils.ts (called by ContextManager) | Message curation with window + task framing |

### File Rename

`phases/context-builder.ts` → `phases/context-utils.ts`

All imports updated. The function `buildConversationMessages()` is called by `ContextManager.build()` — think.ts no longer calls it directly.

### Result

context-utils.ts is ~120 LOC of pure utility functions. No phase responsibilities, no state management, no guidance logic. Just data transformation.

---

## 12. Section 10: tool-utils.ts Decomposition

### Problem

`tool-utils.ts` is 944 LOC with 5+ concerns, imported by 16 files. Changes to formatting pull in gating logic and vice versa.

### Solution

Split into 3 focused files in `kernel/utils/`:

| New file | Functions moved | ~LOC | Imported by |
|----------|----------------|------|-------------|
| `tool-formatting.ts` | `formatToolCallForDisplay`, `formatToolResultPreview`, `buildToolCallSummary`, `stripPreamble`, display helpers | ~200 | console-exporter, act.ts, think.ts |
| `tool-gating.ts` | `gateNativeToolCallsForRequiredTools`, `shouldBlockOptionalTools`, repetition guard, parallel batching rules, `PARALLEL_SAFE_TOOLS` | ~400 | think.ts, guard.ts, kernel-runner.ts |
| `tool-parsing.ts` | `parseToolCallFromText`, `extractToolCallJson`, `normalizeToolArguments`, FC cleanup helpers | ~200 | think.ts, act.ts, tool-execution.ts |

`tool-utils.ts` is deleted after all functions are moved.

### Import Migration

All 16 files that import from `tool-utils.ts` are updated to import from the specific file using direct relative paths. These are internal utilities — they are NOT re-exported from `kernel/index.ts` (see Section 11). This is a mechanical change — no logic changes, just import paths.

---

## 13. Section 11: Barrel Export Cleanup

### Problem

`kernel/index.ts` uses `export *` from 13 modules, leaking internal utilities as public API. Anyone importing from `@reactive-agents/reasoning` gets access to every internal helper.

### Solution

Replace `export *` with explicit named exports for the public API:

```typescript
// kernel/index.ts — explicit public API only

// Types
export type { KernelState, KernelInput, KernelMeta, KernelContext, Phase } from "./kernel-state.js";
export type { ReActKernelInput, ReActKernelResult } from "./kernel-state.js";
export type { KernelHooks } from "./kernel-hooks.js";

// Factories
export { makeKernel } from "./react-kernel.js";
export { executeReActKernel } from "./react-kernel.js";

// Phase implementations (for custom kernel composition)
export { handleThinking } from "./phases/think.js";
export { handleActing } from "./phases/act.js";
export { checkToolCall, defaultGuards } from "./phases/guard.js";
```

Internal utilities (`tool-formatting.ts`, `tool-gating.ts`, `tool-parsing.ts`, `tool-execution.ts`, `reactive-observer.ts`, `loop-detector.ts`, `ics-coordinator.ts`, etc.) are NOT re-exported. They're internal implementation details.

### reasoning/src/index.ts

Same treatment — audit and replace `export *` from kernel with specific named exports that form the package's public API.

---

## 14. Section 12: Layer Violation Fix

### Problem

`service-utils.ts` in the reasoning package imports `PromptService` from `@reactive-agents/prompts`. This is outside reasoning's declared dependency boundary (core, llm-provider, memory, tools).

### Solution

Audit the import. Two options:

**Option A (preferred):** If the usage is small (likely a single function call), inline the needed logic or move the calling code to the runtime package where prompts is an allowed dependency.

**Option B:** If the coupling is deep, add `@reactive-agents/prompts` to reasoning's `package.json` dependencies and document the boundary expansion.

The fix is determined during implementation by reading the actual usage in `service-utils.ts`.

---

## 15. Section 13: Validation Strategy

### Unit Tests

- All 836 existing tests must pass after each implementation phase
- Tests that assert USER message injection patterns are updated to check `pendingGuidance` writes instead
- Tests that use `state.meta as any` are updated to use typed `KernelMeta` properties
- New tests for: `extractFactDeterministic()`, `guardEvidenceGrounding()`, calibration probe suite, `buildCalibratedAdapter()`

### Build Gate

`bun run build` must exit 0 with zero TypeScript errors after each phase. Type errors from the meta bag migration are caught at this stage.

### End-to-End Probe

Run the `scratch.ts` crypto price task against `gemma4:e4b` before and after the changes. Measure:

| Metric | Current baseline | Target |
|--------|-----------------|--------|
| Gets all 4 prices | ~5/8 runs | 7/8+ runs |
| Iterations to complete | 3-5 | 2-3 |
| Output grounded in real data | Partial (hallucination risk) | Verified by evidence grounding |
| Context cleanliness | 10-12 messages with synthetic USER noise | 5-6 messages, clean FC thread |

### Calibration Validation

The probe suite itself serves as ongoing regression testing. If calibration results for `gemma4:e4b` change after a code change (e.g., `steeringCompliance` shifts from `"hybrid"` to `"weak"`), that's a signal something in the harness changed behavior.

### Regression Gate

Before the final commit: full test suite (`bun test`), full build (`bun run build`), scratch.ts probe with `gemma4:e4b` (at least 3 runs). All three must pass.

---

## 16. File Change Summary

### New Files

| File | Purpose | ~LOC |
|------|---------|------|
| `reasoning/src/strategies/kernel/phases/think-guards.ts` | Extracted guard chain from think.ts + evidence grounding | ~300 |
| `reasoning/src/strategies/kernel/utils/tool-formatting.ts` | Display formatting extracted from tool-utils.ts | ~200 |
| `reasoning/src/strategies/kernel/utils/tool-gating.ts` | Required tool checks, batching rules from tool-utils.ts | ~400 |
| `reasoning/src/strategies/kernel/utils/tool-parsing.ts` | FC parsing, argument normalization from tool-utils.ts | ~200 |
| `llm-provider/src/calibration.ts` | ModelCalibration schema + buildCalibratedAdapter + loadCalibration | ~200 |
| `llm-provider/src/calibration-runner.ts` | Probe suite implementation + CLI entry point | ~300 |
| `llm-provider/src/calibrations/gemma4-e4b.json` | Pre-baked calibration | ~20 |
| `llm-provider/src/calibrations/llama3.2-3b.json` | Pre-baked calibration | ~20 |
| `llm-provider/src/calibrations/qwen2.5-coder-7b.json` | Pre-baked calibration | ~20 |

### Modified Files

| File | Changes |
|------|---------|
| `reasoning/src/context/context-manager.ts` | Expanded `build()` to be sole context path; calibration-driven guidance delivery |
| `reasoning/src/context/context-engine.ts` | No changes — already clean, called by ContextManager |
| `reasoning/src/context/context-profile.ts` | Add `maxTokens?: number` and any other fields accessed via `as any` casts |
| `reasoning/src/context/message-window.ts` | Remove frozenToolResultIds tracking; simplify to single sliding window |
| `reasoning/src/strategies/kernel/kernel-state.ts` | `KernelMeta` typed interface; `ReActKernelInput` → type alias; remove `frozenToolResultIds` from state |
| `reasoning/src/strategies/kernel/kernel-runner.ts` | Update meta access to typed properties; remove frozenToolResultIds updates |
| `reasoning/src/strategies/kernel/phases/think.ts` | Replace system prompt assembly with ContextManager.build(); replace USER injections with pendingGuidance; use guard chain |
| `reasoning/src/strategies/kernel/phases/act.ts` | Replace USER injections with pendingGuidance; wire extractFactDeterministic; populate extractedFact on steps |
| `reasoning/src/strategies/kernel/phases/context-builder.ts` | Rename to context-utils.ts; remove functions moved to ContextManager |
| `reasoning/src/strategies/kernel/phases/guard.ts` | Update to typed KernelMeta |
| `reasoning/src/strategies/kernel/utils/tool-execution.ts` | Add extractFactDeterministic(); update meta access |
| `reasoning/src/strategies/kernel/utils/evidence-grounding.ts` | Refactor to work with extractedFact data; consumed by think-guards.ts |
| `reasoning/src/strategies/kernel/utils/output-synthesis.ts` | Update meta access to typed properties |
| `reasoning/src/strategies/kernel/utils/reactive-observer.ts` | Replace 16 `as any` with typed `EntropyMeta` access |
| `reasoning/src/strategies/kernel/utils/loop-detector.ts` | Replace `as any` with typed meta access |
| `reasoning/src/strategies/kernel/utils/task-intent.ts` | No changes expected |
| `reasoning/src/strategies/kernel/react-kernel.ts` | Update ReActKernelInput references |
| `reasoning/src/strategies/kernel/index.ts` | Replace `export *` with explicit named exports |
| `reasoning/src/strategies/reactive.ts` | Pass calibration through to kernel input |
| `reasoning/src/context/index.ts` | Update exports for removed/renamed modules |
| `reasoning/src/index.ts` | Update barrel exports |
| `reasoning/src/types/step.ts` | No changes (extractedFact field already exists) |
| `llm-provider/src/adapter.ts` | Upgrade selectAdapter() to check calibration; return profileOverrides |
| `runtime/src/execution-engine.ts` | Wire calibration from builder config to kernel input; pass to selectAdapter |
| `runtime/src/builder.ts` | Add `.withCalibration()` method |

### Deleted Files

| File | LOC | Reason |
|------|-----|--------|
| `reasoning/src/strategies/kernel/utils/context-utils.ts` | 240 | Zero production callers |
| `reasoning/src/strategies/kernel/utils/tool-utils.ts` | 944 | Replaced by tool-formatting.ts + tool-gating.ts + tool-parsing.ts |
| `reasoning/tests/strategies/kernel/context-utils.test.ts` | ~120 | Tests for deleted code |

### Renamed Files

| From | To |
|------|-----|
| `phases/context-builder.ts` | `phases/context-utils.ts` |
| `tests/.../context-builder.test.ts` | `tests/.../context-utils.test.ts` |

---

## 17. Execution Order

```
Phase 1: Foundation (no behavior change)
├── 1a. Type the meta bag (Section 4)           ← eliminates as-any, safe refactor
├── 1b. ReActKernelInput merge (Section 6)      ← type cleanup, safe refactor
├── 1c. Dead code purge (Section 6)             ← delete unused files
├── 1d. Barrel export cleanup (Section 11)      ← explicit exports
└── 1e. Layer violation fix (Section 12)        ← dependency cleanup
    Gate: bun test + bun run build pass

Phase 2: Structural decomposition (no behavior change)
├── 2a. tool-utils.ts → 3 files (Section 10)   ← mechanical split
├── 2b. context-builder.ts → context-utils.ts rename (Section 9)
└── 2c. think-guards.ts extraction (Section 5)  ← extract guard functions
    Gate: bun test + bun run build pass

Phase 3: Context architecture (behavior change — core)
├── 3a. ContextManager.build() as sole path (Section 2)
├── 3b. Eliminate dual-channel guidance (Section 1)
├── 3c. Message window simplification (Section 8)
└── 3d. Wire observation pipeline (Section 3)
    Gate: bun test + bun run build + scratch.ts probe

Phase 4: Calibration system (new feature)
├── 4a. ModelCalibration schema + types (Section 7)
├── 4b. Probe suite implementation (Section 7)
├── 4c. buildCalibratedAdapter + selectAdapter upgrade (Section 7)
├── 4d. Builder .withCalibration() integration (Section 7)
├── 4e. Pre-bake calibrations for 3 models (Section 7)
└── 4f. Wire calibration through execution-engine to kernel (Section 7)
    Gate: bun test + bun run build + calibration probe passes

Phase 5: Evidence grounding (wires into guard chain)
├── 5a. Refactor evidence-grounding.ts for extractedFact data
└── 5b. Wire guardEvidenceGrounding into think-guards chain
    Gate: bun test + bun run build

Phase 6: Validation (final gate)
├── 6a. Full test suite pass
├── 6b. Full build pass
├── 6c. scratch.ts e2e probe (3+ runs, gemma4:e4b)
└── 6d. Calibration regression check
```

Phases 1-2 are pure refactoring — zero behavior change, tests pass throughout. Phase 3 is the core architectural change. Phase 4 is additive (new feature). Phase 5 wires evidence grounding. Phase 6 validates everything.

---

## 18. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Guard chain changes behavior of existing tests | High | Medium | Run tests after each guard extraction; update assertions from USER messages to pendingGuidance |
| ContextManager.build() produces different system prompt than current manual assembly | Medium | High | Diff test: run both paths, assert identical output before switching |
| Calibration probe suite gives inconsistent results for non-deterministic models | Medium | Low | 3 runs per probe, majority vote; temperature=0; accept that some models are inherently variable |
| tool-utils.ts split breaks imports in 16 files | High | Low | Mechanical change; TypeScript compiler catches all missing imports |
| Meta bag typing reveals hidden type mismatches | Medium | Medium | Fix each one — the cast was hiding a real bug. Better to surface now. |
| Message window simplification loses important context | Low | High | Observations section in system prompt provides redundant grounding; test with scratch.ts probe |
| ReActKernelInput removal breaks external consumers | Low | Medium | Type alias preserved for backward compatibility |
| selectAdapter() return type changes from `ProviderAdapter` to `{ adapter, profileOverrides? }` | High | Medium | All call sites in think.ts, act.ts, kernel-runner.ts must destructure. Mechanical change — TypeScript compiler catches all sites. |
| Barrel export cleanup breaks external consumers importing internal utils | Low | Low | Only affects consumers importing internal kernel utils (unlikely). Public API explicitly re-exported. |

---

_Version: 1.0.0_
_Created: 2026-04-14_
_Status: DESIGN SPEC_
_Author: Tyler Buell + Claude_
