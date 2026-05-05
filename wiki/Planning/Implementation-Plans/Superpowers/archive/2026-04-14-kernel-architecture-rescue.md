# Kernel Architecture Rescue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.
>
> **Project skills:** Use `agent-tdd` for TDD patterns, `implement-test` for Effect-TS test templates, `effect-ts-patterns` for coding conventions, `validate-build` for anti-pattern detection, `architecture-reference` for monorepo structure.

**Goal:** Complete the half-finished context architecture migration, eliminate all dead code and type debt in the reasoning package, wire the observation pipeline end-to-end, build a per-model calibration system, and deliver a lean, type-safe kernel.

**Architecture:** All harness steering signals flow through `pendingGuidance` on `KernelState`, rendered by `ContextManager.build()` as the single context assembly path. Per-model calibration drives delivery channel, observation handling, and tool result sizing. Evidence grounding gates final output claims against session data.

**Tech Stack:** TypeScript, Effect-TS, Bun runtime, Bun test runner, Ollama (calibration probes)

**Spec:** `docs/superpowers/specs/2026-04-14-kernel-architecture-rescue-design.md`

---

## Phase 1: Foundation (No Behavior Change)

Pure type and structural cleanup. Every test must continue passing after each task. Zero behavior change.

---

### Task 1: Type the Meta Bag — Define KernelMeta

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/kernel-state.ts:55-120` (KernelState), `:150-220` (KernelInput), `:426-520` (transitionState)
- Test: `bun test packages/reasoning/`

- [x] **Step 1: Define EntropyMeta, ControllerDecision, and KernelMeta interfaces**

Add above `KernelState` in `kernel-state.ts` (before line 55):

```typescript
// ── Typed Meta Sub-Records ────────────────────────────────────────────────────

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

- [x] **Step 2: Change KernelState.meta type**

In `kernel-state.ts`, change the `meta` field on `KernelState` (around line 100) from:

```typescript
readonly meta: Readonly<Record<string, unknown>>;
```

to:

```typescript
readonly meta: KernelMeta;
```

Update `initialKernelState` (line ~404) to use typed empty object:

```typescript
meta: {} as KernelMeta,
```

Update `transitionState` (line ~426) — the spread pattern works unchanged since `KernelMeta` spreads identically.

- [x] **Step 3: Run build to surface all type errors**

Run: `bun run build 2>&1 | grep "error TS" | head -40`

Expected: Multiple type errors where `as any` casts now conflict with typed meta. This is the migration manifest — each error is a cast to fix.

- [x] **Step 4: Fix reactive-observer.ts (16 casts)**

In `packages/reasoning/src/strategies/kernel/utils/reactive-observer.ts`, replace all `(state.meta.entropy as any)` with `state.meta.entropy` and `(state.meta as any).entropy` with typed access. The `EntropyMeta` interface matches what reactive-observer writes.

- [x] **Step 5: Fix think.ts (12 casts)**

In `packages/reasoning/src/strategies/kernel/phases/think.ts`, replace:
- `(state.meta.entropy as any)?.entropyHistory` → `state.meta.entropy?.history`
- `(state.meta.entropy as any)?.Score` → `state.meta.entropy?.score`
- `(state.meta.controllerDecisions as any[])` → `state.meta.controllerDecisions`
- `(state.meta.maxIterations as number)` → `state.meta.maxIterations`
- `(input.contextProfile as any)?.maxTokens` → `input.contextProfile?.maxTokens` (after adding `maxTokens` to ContextProfile in Step 7)

- [x] **Step 6: Fix message-window.ts (8 casts), act.ts (4 casts), kernel-runner.ts (1 cast), loop-detector.ts (1 cast), context-manager.ts (1 cast)**

Same pattern — replace `as any` with typed property access on `KernelMeta`.

- [x] **Step 7: Add maxTokens to ContextProfile**

In `packages/reasoning/src/context/context-profile.ts`, add to the schema:

```typescript
maxTokens: Schema.optional(Schema.Number),
```

Add appropriate defaults in `CONTEXT_PROFILES`:
- local: `maxTokens: 4096`
- mid: `maxTokens: 8192`
- large: `maxTokens: 32768`
- frontier: `maxTokens: 128000`

- [x] **Step 8: Run full test suite + build**

Run: `bun run build && bun test packages/reasoning/ --timeout 30000`

Expected: Zero TypeScript errors. 836/836 tests pass (or close — update any tests that construct `meta` with `as any`).

- [x] **Step 9: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/kernel-state.ts \
  packages/reasoning/src/strategies/kernel/utils/reactive-observer.ts \
  packages/reasoning/src/strategies/kernel/phases/think.ts \
  packages/reasoning/src/strategies/kernel/phases/act.ts \
  packages/reasoning/src/strategies/kernel/kernel-runner.ts \
  packages/reasoning/src/strategies/kernel/utils/loop-detector.ts \
  packages/reasoning/src/context/context-manager.ts \
  packages/reasoning/src/context/context-profile.ts \
  packages/reasoning/src/context/message-window.ts
git commit -m "refactor(reasoning): type KernelMeta — eliminate 43 as-any casts in reasoning package"
```

---

### Task 2: Merge ReActKernelInput into KernelInput

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/kernel-state.ts:150-220,528-601`
- Modify: `packages/reasoning/src/strategies/kernel/phases/think.ts:56,376,529-530,705`
- Modify: `packages/reasoning/src/strategies/kernel/kernel-runner.ts:32,406`
- Modify: `packages/reasoning/src/strategies/kernel/phases/context-builder.ts:15,97,137`
- Modify: `packages/reasoning/src/strategies/kernel/phases/guard.ts:10,28,253`
- Modify: `packages/reasoning/src/strategies/kernel/react-kernel.ts:41-42,98`
- Test: `bun test packages/reasoning/`

- [x] **Step 1: Add missing fields to KernelInput**

In `kernel-state.ts`, add to `KernelInput` interface (around line 220):

```typescript
  /** Native function calling resolver (when provider supports FC) */
  readonly toolCallResolver?: ToolCallResolver;

  /** Complete tool schema list before filtering (for completion gap detection) */
  readonly allToolSchemas?: readonly ToolSchema[];
```

Make sure `ToolCallResolver` type is imported at the top of the file.

- [x] **Step 2: Replace ReActKernelInput interface with type alias**

In `kernel-state.ts`, replace the full `ReActKernelInput` interface (lines 528-601) with:

```typescript
/** @deprecated Use KernelInput directly. Preserved as alias for existing consumers. */
export type ReActKernelInput = KernelInput;
```

- [x] **Step 3: Remove all `as ReActKernelInput` casts**

In `think.ts`:
- Line 376: `(input as ReActKernelInput).toolCallResolver` → `input.toolCallResolver`
- Line 529: `(input as ReActKernelInput).toolCallResolver` → `input.toolCallResolver`
- Line 530: `(input as ReActKernelInput).toolCallResolver!` → `input.toolCallResolver!`
- Line 705: `(input as ReActKernelInput).allToolSchemas` → `input.allToolSchemas`

In `kernel-runner.ts`:
- Line 406: `(input as ReActKernelInput).toolCallResolver` → `input.toolCallResolver`

In `context-builder.ts`, `guard.ts`: Update function parameter types from `ReActKernelInput` to `KernelInput`.

- [x] **Step 4: Run full test suite + build**

Run: `bun run build && bun test packages/reasoning/ --timeout 30000`

Expected: All pass. Type alias preserves backward compatibility.

- [x] **Step 5: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/kernel-state.ts \
  packages/reasoning/src/strategies/kernel/phases/think.ts \
  packages/reasoning/src/strategies/kernel/phases/act.ts \
  packages/reasoning/src/strategies/kernel/phases/context-builder.ts \
  packages/reasoning/src/strategies/kernel/phases/guard.ts \
  packages/reasoning/src/strategies/kernel/kernel-runner.ts \
  packages/reasoning/src/strategies/kernel/react-kernel.ts
git commit -m "refactor(reasoning): merge ReActKernelInput into KernelInput — eliminate 5 type casts"
```

---

### Task 3: Delete Dead Code

**Files:**
- Delete: `packages/reasoning/src/strategies/kernel/utils/context-utils.ts` (240 LOC)
- Delete: `packages/reasoning/tests/strategies/kernel/context-utils.test.ts` (~120 LOC)
- Modify: `packages/reasoning/src/strategies/kernel/index.ts:3`
- Test: `bun test packages/reasoning/`

- [x] **Step 1: Remove barrel export**

In `packages/reasoning/src/strategies/kernel/index.ts`, delete line 3:

```typescript
export * from "./utils/context-utils.js";
```

- [x] **Step 2: Delete the files**

```bash
rm packages/reasoning/src/strategies/kernel/utils/context-utils.ts
rm packages/reasoning/tests/strategies/kernel/context-utils.test.ts
```

- [x] **Step 3: Run full test suite + build**

Run: `bun run build && bun test packages/reasoning/ --timeout 30000`

Expected: All pass. No production code imported these files.

- [x] **Step 4: Commit**

```bash
git add -A packages/reasoning/src/strategies/kernel/utils/context-utils.ts \
  packages/reasoning/tests/strategies/kernel/context-utils.test.ts \
  packages/reasoning/src/strategies/kernel/index.ts
git commit -m "chore(reasoning): delete dead context-utils.ts — zero production callers"
```

---

### Task 4: Barrel Export Cleanup

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/index.ts:1-13`
- Modify: `packages/reasoning/src/index.ts`
- Test: `bun run build` (compiler catches missing exports downstream)

- [x] **Step 1: Identify public API surface**

Run: `grep -rn "from.*@reactive-agents/reasoning" packages/ apps/ --include="*.ts" | grep -v node_modules | grep -v "reasoning/src" | grep -v "reasoning/tests" | head -30`

This shows what external consumers actually import. Only these symbols need to be exported.

- [x] **Step 2: Replace kernel/index.ts export-star with explicit exports**

Replace all 13 `export *` lines in `packages/reasoning/src/strategies/kernel/index.ts` with explicit named exports based on the public API audit from Step 1. Start with:

```typescript
// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  KernelState,
  KernelInput,
  KernelMeta,
  EntropyMeta,
  ControllerDecision,
  KernelContext,
  KernelMessage,
  KernelStatus,
  Phase,
  ReActKernelInput,
  ReActKernelResult,
  PendingGuidance,
} from "./kernel-state.js";

export type { KernelHooks } from "./kernel-hooks.js";

// ── Factories & runners ───────────────────────────────────────────────────────
export { makeKernel, executeReActKernel } from "./react-kernel.js";
export { runKernel } from "./kernel-runner.js";

// ── Phase implementations (for custom kernel composition) ─────────────────────
export { handleThinking } from "./phases/think.js";
export { handleActing } from "./phases/act.js";
export { checkToolCall, defaultGuards } from "./phases/guard.js";

// ── Utilities needed by runtime package ───────────────────────────────────────
export { makeStep } from "./utils/step-utils.js";
export { transitionState, createInitialState } from "./kernel-state.js";
```

Add any additional exports that the Step 1 audit reveals are needed by external consumers.

- [x] **Step 3: Run build to find missing exports**

Run: `bun run build 2>&1 | grep "error TS" | head -30`

Expected: Some errors where runtime or other packages imported internal utils. Fix by adding those specific exports to the barrel, or by updating the consumer to use the correct import path.

- [x] **Step 4: Fix any broken imports, run full test suite + build**

Run: `bun run build && bun test packages/reasoning/ --timeout 30000`

Expected: All pass.

- [x] **Step 5: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/index.ts packages/reasoning/src/index.ts
git commit -m "refactor(reasoning): explicit barrel exports — no internal utils leaked"
```

---

### Task 5: Fix Layer Violation

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/utils/service-utils.ts:11`
- Test: `bun run build`

- [x] **Step 1: Audit the import**

Read `packages/reasoning/src/strategies/kernel/utils/service-utils.ts` line 11 to understand what `PromptService` is used for.

- [x] **Step 2: Resolve the violation**

If the usage is a single function call or type reference, inline it or move the calling code. If the coupling is deeper, add `@reactive-agents/prompts` to `packages/reasoning/package.json` dependencies.

- [x] **Step 3: Run build + tests**

Run: `bun run build && bun test packages/reasoning/ --timeout 30000`

- [x] **Step 4: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/utils/service-utils.ts
git commit -m "fix(reasoning): resolve layer violation — reasoning no longer imports from prompts"
```

---

**Phase 1 Gate:** `bun run build && bun test packages/reasoning/ --timeout 30000` — all pass, zero `as any` except ~1 SDK gap, zero dead code, explicit barrel exports.

---

## Phase 2: Structural Decomposition (No Behavior Change)

Mechanical file splits and renames. All logic stays identical — just moves between files.

---

### Task 6: Decompose tool-utils.ts into 3 Files

**Files:**
- Create: `packages/reasoning/src/strategies/kernel/utils/tool-formatting.ts`
- Create: `packages/reasoning/src/strategies/kernel/utils/tool-gating.ts`
- Create: `packages/reasoning/src/strategies/kernel/utils/tool-parsing.ts`
- Delete: `packages/reasoning/src/strategies/kernel/utils/tool-utils.ts`
- Modify: ~16 files that import from tool-utils.ts
- Test: `bun test packages/reasoning/`

- [x] **Step 1: Identify function groupings**

Read `packages/reasoning/src/strategies/kernel/utils/tool-utils.ts` and categorize every exported function:

**tool-formatting.ts** (~200 LOC): `formatToolCallForDisplay`, `formatToolResultPreview`, `buildToolCallSummary`, `stripPreamble`, and any display/string formatting helpers.

**tool-gating.ts** (~400 LOC): `gateNativeToolCallsForRequiredTools`, `shouldBlockOptionalTools`, repetition guard functions, parallel batching rules, `PARALLEL_SAFE_TOOLS` constant, `hasFinalAnswer`, `extractFinalAnswer`.

**tool-parsing.ts** (~200 LOC): `parseToolCallFromText`, `extractToolCallJson`, `normalizeToolArguments`, FC cleanup regex helpers, `evaluateTransform`.

- [x] **Step 2: Create the 3 new files**

Move functions into each file. Preserve all JSDoc comments, section headers, and imports. Each file gets only the imports it needs.

- [x] **Step 3: Update all 16 import sites**

Run: `grep -rn "from.*tool-utils" packages/reasoning/src/ --include="*.ts"`

For each importing file, change the import path to the specific new file. Example:
- `import { stripPreamble } from "../utils/tool-utils.js"` → `import { stripPreamble } from "../utils/tool-formatting.js"`
- `import { gateNativeToolCallsForRequiredTools } from "../utils/tool-utils.js"` → `import { gateNativeToolCallsForRequiredTools } from "../utils/tool-gating.js"`

- [x] **Step 4: Delete tool-utils.ts**

```bash
rm packages/reasoning/src/strategies/kernel/utils/tool-utils.ts
```

- [x] **Step 5: Update test imports**

Run: `grep -rn "from.*tool-utils" packages/reasoning/tests/ --include="*.ts"`

Update test imports to point to the new files.

- [x] **Step 6: Run full test suite + build**

Run: `bun run build && bun test packages/reasoning/ --timeout 30000`

Expected: All pass — pure mechanical move, no logic changes.

- [x] **Step 7: Commit**

```bash
git add -A packages/reasoning/src/strategies/kernel/utils/tool-utils.ts \
  packages/reasoning/src/strategies/kernel/utils/tool-formatting.ts \
  packages/reasoning/src/strategies/kernel/utils/tool-gating.ts \
  packages/reasoning/src/strategies/kernel/utils/tool-parsing.ts
git add packages/reasoning/src/ packages/reasoning/tests/
git commit -m "refactor(reasoning): decompose tool-utils.ts (944 LOC) into 3 focused files"
```

---

### Task 7: Rename context-builder.ts → context-utils.ts

**Files:**
- Rename: `packages/reasoning/src/strategies/kernel/phases/context-builder.ts` → `packages/reasoning/src/strategies/kernel/phases/context-utils.ts`
- Rename: `packages/reasoning/tests/strategies/kernel/phases/context-builder.test.ts` → `packages/reasoning/tests/strategies/kernel/phases/context-utils.test.ts`
- Modify: All files that import from context-builder
- Test: `bun test packages/reasoning/`

- [x] **Step 1: Find all importers**

Run: `grep -rn "context-builder" packages/reasoning/ --include="*.ts"`

- [x] **Step 2: Rename files**

```bash
mv packages/reasoning/src/strategies/kernel/phases/context-builder.ts \
   packages/reasoning/src/strategies/kernel/phases/context-utils.ts
mv packages/reasoning/tests/strategies/kernel/phases/context-builder.test.ts \
   packages/reasoning/tests/strategies/kernel/phases/context-utils.test.ts
```

- [x] **Step 3: Update all import paths**

Change every `from "...context-builder.js"` to `from "...context-utils.js"` in all files found in Step 1.

- [x] **Step 4: Run full test suite + build**

Run: `bun run build && bun test packages/reasoning/ --timeout 30000`

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(reasoning): rename context-builder.ts → context-utils.ts"
```

---

### Task 8: Extract think-guards.ts

**Files:**
- Create: `packages/reasoning/src/strategies/kernel/phases/think-guards.ts`
- Modify: `packages/reasoning/src/strategies/kernel/phases/think.ts:600-870`
- Create: `packages/reasoning/tests/strategies/kernel/phases/think-guards.test.ts`
- Test: `bun test packages/reasoning/`

- [x] **Step 1: Write failing tests for guard functions**

Create `packages/reasoning/tests/strategies/kernel/phases/think-guards.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import {
  guardRequiredToolsBlock,
  guardPrematureFinalAnswer,
  guardCompletionGaps,
  guardQualityCheck,
  guardDiminishingReturns,
} from "../../../../src/strategies/kernel/phases/think-guards.js";
import { createInitialState } from "../../../../src/strategies/kernel/kernel-state.js";

// ── Test Helpers ──────────────────────────────────────────────────────────────
const defaultProfile = { tier: "mid" as const, toolResultMaxChars: 1200, toolResultPreviewItems: 5, toolSchemaDetail: "names-and-types" as const };
const noopHooks = { onThought: () => Promise.resolve(), onDone: () => Promise.resolve(), onError: () => Promise.resolve() } as any;
const defaultAdapter = {} as any;

function createMinimalState(overrides: Record<string, unknown>) {
  const base = createInitialState("test task");
  return { ...base, ...overrides };
}
function createMinimalInput(overrides: Record<string, unknown>) {
  return { task: "test", availableToolSchemas: [], ...overrides } as any;
}

describe("think-guards", () => {

  describe("guardRequiredToolsBlock", () => {
    it("should return state with pendingGuidance when required tools not in batch", () => {
      const state = createMinimalState({ requiredTools: ["web-search", "final-answer"] });
      const rawCalls = [{ name: "recall", arguments: {} }]; // not a required tool
      const input = createMinimalInput({ requiredTools: ["web-search", "final-answer"] });
      const result = guardRequiredToolsBlock(rawCalls as any, input, state, defaultProfile, noopHooks);
      expect(result).toBeDefined();
      expect(result!.pendingGuidance?.requiredToolsPending).toContain("web-search");
    });

    it("should return undefined when batch includes required tools", () => {
      const state = createMinimalState({});
      const rawCalls = [{ name: "web-search", arguments: { query: "test" } }];
      const input = createMinimalInput({ requiredTools: ["web-search"] });
      const result = guardRequiredToolsBlock(rawCalls as any, input, state, defaultProfile, noopHooks);
      expect(result).toBeUndefined();
    });
  });

  describe("guardPrematureFinalAnswer", () => {
    it("should redirect when required tools missing", () => {
      const state = createMinimalState({ toolsUsed: new Set() });
      const input = createMinimalInput({ requiredTools: ["web-search", "final-answer"] });
      const result = guardPrematureFinalAnswer(input, state, defaultProfile, defaultAdapter);
      expect(result).toBeDefined();
      expect(result!.pendingGuidance?.requiredToolsPending?.length).toBeGreaterThan(0);
    });

    it("should return undefined when all required tools called", () => {
      const state = createMinimalState({ toolsUsed: new Set(["web-search", "final-answer"]) });
      const input = createMinimalInput({ requiredTools: ["web-search", "final-answer"] });
      const result = guardPrematureFinalAnswer(input, state, defaultProfile, defaultAdapter);
      expect(result).toBeUndefined();
    });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test packages/reasoning/tests/strategies/kernel/phases/think-guards.test.ts`

Expected: FAIL — module not found.

- [x] **Step 3: Create think-guards.ts by extracting from think.ts**

Extract the guard logic from `think.ts` lines ~600-870 into `packages/reasoning/src/strategies/kernel/phases/think-guards.ts`. Each guard is a pure function:

```typescript
import type { KernelState, KernelInput, KernelMeta } from "../kernel-state.js";
import type { ContextProfile } from "../../../context/context-profile.js";
import type { ProviderAdapter } from "@reactive-agents/llm-provider";
import type { KernelHooks } from "../kernel-hooks.js";
import type { ToolCallSpec } from "@reactive-agents/tools";
import type { ReasoningStep } from "../../../types/step.js";
import { transitionState } from "../kernel-state.js";
import { getMissingRequiredToolsFromSteps } from "../utils/requirement-state.js";
import { detectCompletionGaps } from "../utils/output-synthesis.js";
import { makeStep } from "../utils/step-utils.js";
import { makeObservationResult } from "../utils/tool-execution.js";

/**
 * Guard: required tools not in the tool call batch.
 * Fires when strict dependency mode is active and the batch doesn't include
 * any missing required tool. Writes to pendingGuidance.requiredToolsPending.
 */
export function guardRequiredToolsBlock(
  rawCalls: ToolCallSpec[],
  input: KernelInput,
  state: KernelState,
  profile: ContextProfile,
  hooks: KernelHooks,
): KernelState | undefined {
  // Extract the block logic from think.ts lines ~600-620
  // Return transitionState with pendingGuidance set, or undefined to pass
}

// ... same pattern for each guard
```

Move the exact logic from think.ts into each function. The function bodies are the code currently at think.ts lines 600-870, split by the conditional boundaries.

- [x] **Step 4: Update think.ts to use guard chain**

Replace the inline guard logic in think.ts with:

```typescript
import {
  guardRequiredToolsBlock,
  guardPrematureFinalAnswer,
  guardCompletionGaps,
  guardQualityCheck,
  guardDiminishingReturns,
} from "./think-guards.js";

// After FC resolution, route through guard chain
const redirect =
  guardRequiredToolsBlock(rawCalls, input, state, profile, hooks) ??
  guardPrematureFinalAnswer(input, state, profile, adapter) ??
  guardCompletionGaps(input, state, newSteps) ??
  guardQualityCheck(input, state, profile, adapter) ??
  guardDiminishingReturns(state, input, novelty);

if (redirect) return redirect;
```

- [x] **Step 5: Run full test suite + build**

Run: `bun run build && bun test packages/reasoning/ --timeout 30000`

Expected: All pass — same logic, just moved to separate file.

- [x] **Step 6: Flesh out think-guards tests**

Add concrete test cases that verify each guard's `pendingGuidance` writes, using mock state objects. Cover: guard fires when condition met (returns state with guidance), guard passes when condition not met (returns undefined).

- [x] **Step 7: Run tests**

Run: `bun test packages/reasoning/tests/strategies/kernel/phases/think-guards.test.ts`

Expected: All pass.

- [x] **Step 8: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/phases/think-guards.ts \
  packages/reasoning/src/strategies/kernel/phases/think.ts \
  packages/reasoning/tests/strategies/kernel/phases/think-guards.test.ts
git commit -m "refactor(reasoning): extract think-guards.ts — 6 guard functions from think.ts"
```

---

**Phase 2 Gate:** `bun run build && bun test packages/reasoning/ --timeout 30000` — all pass. think.ts ~700 LOC, tool-utils.ts gone (replaced by 3 focused files), context-builder.ts renamed.

---

## Phase 3: Context Architecture (Behavior Change — Core)

This phase changes how the model receives context and guidance. Test carefully.

---

### Task 9: Eliminate Dual-Channel Guidance

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/kernel-state.ts:40-51` (PendingGuidance)
- Modify: `packages/reasoning/src/strategies/kernel/phases/think.ts` (lines 619, 690, 714, 738, 864)
- Modify: `packages/reasoning/src/strategies/kernel/phases/act.ts` (lines 787-833)
- Modify: `packages/reasoning/src/context/context-manager.ts:28-38` (GuidanceContext)
- Test: `bun test packages/reasoning/`

- [x] **Step 1: Expand PendingGuidance with missing fields**

In `kernel-state.ts`, update `PendingGuidance` (line 40):

```typescript
export interface PendingGuidance {
  readonly requiredToolsPending?: readonly string[];
  readonly loopDetected?: boolean;
  readonly icsGuidance?: string;
  readonly oracleGuidance?: string;
  readonly errorRecovery?: string;
  readonly actReminder?: string;
  readonly qualityGateHint?: string;
  readonly evidenceGap?: string;
}
```

Update `GuidanceContext` in `context-manager.ts` (line 28) to match:

```typescript
export interface GuidanceContext {
  readonly requiredToolsPending: readonly string[];
  readonly loopDetected: boolean;
  readonly icsGuidance?: string;
  readonly oracleGuidance?: string;
  readonly errorRecovery?: string;
  readonly actReminder?: string;
  readonly qualityGateHint?: string;
  readonly evidenceGap?: string;
}
```

- [x] **Step 2: Update buildGuidanceSection to render new fields**

In `context-manager.ts` `buildGuidanceSection()` (line 224), add rendering for `actReminder`, `qualityGateHint`, and `evidenceGap`:

```typescript
if (guidance.actReminder) signals.push(guidance.actReminder);
if (guidance.qualityGateHint) signals.push(guidance.qualityGateHint);
if (guidance.evidenceGap) signals.push(
  `Your answer contains claims not supported by tool results: ${guidance.evidenceGap}. Revise using only data from the Observations above.`
);
```

- [x] **Step 3: Convert think.ts USER injections to pendingGuidance writes**

For each of the 5 injection sites in think.ts, replace the `{ role: "user", content: X }` message append with a `pendingGuidance` write on the returned state. Each guard function in `think-guards.ts` already returns via `transitionState` — update them to write to `pendingGuidance` instead of appending to `messages`.

Example for `guardRequiredToolsBlock` (was think.ts:619):

```typescript
// BEFORE (in think-guards.ts):
const blockMessages = [...state.messages, { role: "user", content: blockMsg }];
return transitionState(state, { messages: blockMessages, ... });

// AFTER:
return transitionState(state, {
  pendingGuidance: { requiredToolsPending: missing },
  ...
});
// Do NOT append blockMsg to messages
```

Apply same pattern for all 5 guards.

- [x] **Step 4: Convert act.ts USER injections to pendingGuidance writes**

In `act.ts`, the message history assembly IIFE (lines ~780-870):

**progressMsg (line 790):** Replace USER message with pendingGuidance write:
```typescript
// BEFORE:
const progressMsg: KernelMessage = { role: "user", content: progressContent };
return [...prior, assistantMsg, ...toolResultMessages, progressMsg];

// AFTER:
// Write to pendingGuidance, return clean FC thread
state = transitionState(state, {
  pendingGuidance: { actReminder: progressContent },
});
return [...prior, assistantMsg, ...toolResultMessages];
```

**finishMsg (line 819):** Same pattern — write to `pendingGuidance.actReminder`.

**retryMsg (line 830):** Write to `pendingGuidance.errorRecovery`.

- [x] **Step 5: Update tests that assert USER message injection**

Run: `grep -rn "role.*user.*must still call\|role.*user.*Required tools\|role.*user.*Not done" packages/reasoning/tests/ --include="*.ts"`

Update these tests to assert `pendingGuidance` fields instead of USER messages in the message array.

- [x] **Step 6: Run full test suite + build**

Run: `bun run build && bun test packages/reasoning/ --timeout 30000`

Expected: All pass after test updates.

- [x] **Step 7: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/kernel-state.ts \
  packages/reasoning/src/strategies/kernel/phases/think.ts \
  packages/reasoning/src/strategies/kernel/phases/think-guards.ts \
  packages/reasoning/src/strategies/kernel/phases/act.ts \
  packages/reasoning/src/context/context-manager.ts \
  packages/reasoning/tests/
git commit -m "feat(reasoning): single-channel guidance — all 8 USER injections converted to pendingGuidance"
```

---

### Task 10: Wire ContextManager.build() as Sole Context Path

**Files:**
- Modify: `packages/reasoning/src/context/context-manager.ts:61-120`
- Modify: `packages/reasoning/src/strategies/kernel/phases/think.ts:164-206`
- Modify: `packages/reasoning/src/strategies/kernel/phases/context-utils.ts` (was context-builder.ts)
- Test: `bun test packages/reasoning/`

- [x] **Step 1: Expand ContextManager.build() to include all system prompt sections**

Update `ContextManager.build()` in `context-manager.ts` (line 61) to accept `adapter` parameter and assemble the complete system prompt:

```typescript
export const ContextManager = {
  build(
    state: KernelState,
    input: KernelInput,
    profile: ContextProfile,
    guidance: GuidanceContext,
    adapter: ProviderAdapter,
    calibration?: ModelCalibration,
  ): ContextManagerOutput {
    // 1. Identity
    const base = buildSystemPrompt(state, input, profile);
    // 2. Adapter patch
    const patched = adapter.systemPromptPatch?.(base) ?? base;
    // 3. Static context (env + tools + task + rules)
    const staticCtx = buildStaticContext(input, profile);
    // 4. Tool elaboration
    const elaboration = input.toolElaboration ?? "";
    // 5. Progress section
    const progress = buildProgressSection(state, input);
    // 6. Observations / Prior work section
    const observations = buildPriorWorkSection(state);
    // 7. Guidance section (calibration-aware delivery)
    const guidanceSection = buildGuidanceSection(guidance);

    const systemPrompt = [patched, staticCtx, elaboration, progress, observations, guidanceSection]
      .filter(Boolean)
      .join("\n\n");

    // Message curation
    const messages = buildConversationMessages(state, input, profile, adapter);

    // Calibration-driven guidance delivery
    if (calibration?.steeringCompliance === "hybrid" || 
        (!calibration && (profile.tier === "local" || profile.tier === "mid"))) {
      // Hybrid: also append 1-line guidance as USER message
      const shortGuidance = buildShortGuidanceReminder(guidance);
      if (shortGuidance) {
        messages.push({ role: "user", content: shortGuidance });
      }
    }

    return { systemPrompt, messages };
  },
};
```

Import `buildSystemPrompt`, `buildConversationMessages` from `./phases/context-utils.js` and `buildStaticContext` from `./context-engine.js`.

- [x] **Step 2: Add buildShortGuidanceReminder helper**

In `context-manager.ts`, add a private helper that produces a 1-line user message for hybrid delivery:

```typescript
function buildShortGuidanceReminder(guidance: GuidanceContext): string | undefined {
  if (guidance.requiredToolsPending.length > 0) {
    return `[Harness] Required: ${guidance.requiredToolsPending.join(", ")}`;
  }
  if (guidance.loopDetected) return "[Harness] Loop detected — change approach.";
  if (guidance.actReminder) return `[Harness] ${guidance.actReminder.slice(0, 120)}`;
  if (guidance.evidenceGap) return "[Harness] Output contains ungrounded claims — revise.";
  return undefined;
}
```

- [x] **Step 3: Replace think.ts system prompt assembly with ContextManager.build()**

In `think.ts`, replace lines ~164-206 (the manual system prompt assembly block) with:

```typescript
import { ContextManager } from "../../../context/context-manager.js";

// Read and clear pendingGuidance
const pending = state.pendingGuidance;
state = transitionState(state, { pendingGuidance: undefined });
const guidance: GuidanceContext = {
  requiredToolsPending: pending?.requiredToolsPending ?? [],
  loopDetected: pending?.loopDetected ?? false,
  icsGuidance: pending?.icsGuidance,
  oracleGuidance: pending?.oracleGuidance,
  errorRecovery: pending?.errorRecovery,
  actReminder: pending?.actReminder,
  qualityGateHint: pending?.qualityGateHint,
  evidenceGap: pending?.evidenceGap,
};

const { systemPrompt, messages: curatedMessages } = ContextManager.build(
  state, input, profile, guidance, adapter, calibration,
);
```

Remove the old manual calls to `buildStaticContext`, `buildGuidanceSection`, `buildConversationMessages` from think.ts.

- [x] **Step 4: Diff-test: verify system prompt parity**

Before fully switching, add a temporary assertion that the old and new system prompts produce equivalent content (modulo the new Progress and Observations sections). Remove this assertion after verification.

- [x] **Step 5: Run full test suite + build**

Run: `bun run build && bun test packages/reasoning/ --timeout 30000`

- [x] **Step 6: Commit**

```bash
git add packages/reasoning/src/context/context-manager.ts \
  packages/reasoning/src/strategies/kernel/phases/think.ts \
  packages/reasoning/src/strategies/kernel/phases/context-utils.ts
git commit -m "feat(reasoning): ContextManager.build() is sole context assembly path"
```

---

### Task 11: Simplify Message Window

**Files:**
- Modify: `packages/reasoning/src/context/message-window.ts:16,29,36-127`
- Modify: `packages/reasoning/src/strategies/kernel/kernel-state.ts` (remove frozenToolResultIds)
- Modify: `packages/reasoning/src/strategies/kernel/phases/context-utils.ts` (remove frozen ID tracking)
- Test: `bun test packages/reasoning/tests/context/message-window.test.ts`

- [x] **Step 1: Remove frozenToolResultIds from KernelState**

In `kernel-state.ts`, remove `frozenToolResultIds` field (line ~412) from state and `initialKernelState`.

- [x] **Step 2: Remove frozen ID logic from message-window.ts**

In `message-window.ts`, remove the `frozenToolResultIds` parameter from `applyMessageWindowWithCompact`, remove the freeze tracking logic (~30 LOC), and remove recall hints from compacted messages.

Simplified signature:

```typescript
export function applyMessageWindowWithCompact(
  messages: readonly KernelMessage[],
  tier: ModelTier,
  maxTokens: number,
): KernelMessage[]
```

- [x] **Step 3: Remove frozen ID tracking from context-utils.ts**

In `phases/context-utils.ts`, remove the `newlyFrozenIds` return value from `buildConversationMessages` and the `transitionState` call that persists frozen IDs.

- [x] **Step 4: Update tests**

Update `packages/reasoning/tests/context/message-window.test.ts` to remove frozen ID test cases and update function signatures.

- [x] **Step 5: Run full test suite + build**

Run: `bun run build && bun test packages/reasoning/ --timeout 30000`

- [x] **Step 6: Commit**

```bash
git add packages/reasoning/src/context/message-window.ts \
  packages/reasoning/src/strategies/kernel/kernel-state.ts \
  packages/reasoning/src/strategies/kernel/phases/context-utils.ts \
  packages/reasoning/tests/
git commit -m "refactor(reasoning): simplify message window — remove frozenToolResultIds, recall off critical path"
```

---

### Task 12: Wire Observation Pipeline

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/utils/tool-execution.ts`
- Modify: `packages/reasoning/src/strategies/kernel/phases/act.ts`
- Create: `packages/reasoning/tests/strategies/kernel/utils/extract-fact.test.ts`
- Test: `bun test packages/reasoning/`

- [x] **Step 1: Write failing tests for extractFactDeterministic**

Create `packages/reasoning/tests/strategies/kernel/utils/extract-fact.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { extractFactDeterministic } from "../../../../src/strategies/kernel/utils/tool-execution.js";

describe("extractFactDeterministic", () => {
  it("should extract dollar amount near entity mention", () => {
    const raw = "The current price of XRP is $1.327 according to CoinGecko...";
    const fact = extractFactDeterministic("web-search", { query: "XRP price USD" }, raw);
    expect(fact).toContain("$1.327");
    expect(fact).toContain("XRP");
  });

  it("should extract URL source attribution", () => {
    const raw = "Bitcoin price is $63,450 from https://binance.com/en/trade";
    const fact = extractFactDeterministic("web-search", { query: "BTC price" }, raw);
    expect(fact).toContain("binance.com");
  });

  it("should return undefined when no structured data found", () => {
    const raw = "This page contains no numerical data whatsoever.";
    const fact = extractFactDeterministic("web-search", { query: "test" }, raw);
    expect(fact).toBeUndefined();
  });

  it("should handle multiple dollar amounts by picking the first", () => {
    const raw = "XRP costs $1.33 on Kraken and $1.327 on Revolut. Market cap is $68.2B.";
    const fact = extractFactDeterministic("web-search", { query: "XRP price USD" }, raw);
    expect(fact).toContain("$1.33");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test packages/reasoning/tests/strategies/kernel/utils/extract-fact.test.ts`

Expected: FAIL — function not exported.

- [x] **Step 3: Implement extractFactDeterministic**

Add to `packages/reasoning/src/strategies/kernel/utils/tool-execution.ts`:

```typescript
/**
 * Deterministic fact extraction from raw tool output.
 * Runs BEFORE compression. Zero LLM calls.
 * Returns a one-liner or undefined if no structured data found.
 */
export function extractFactDeterministic(
  toolName: string,
  args: Record<string, unknown>,
  rawResult: string,
): string | undefined {
  const query = String(args.query ?? args.url ?? args.input ?? "");
  
  // Extract dollar amounts
  const dollarMatch = rawResult.match(/\$[\d,]+\.?\d*/);
  
  // Extract percentages
  const pctMatch = rawResult.match(/[+-]?\d+\.?\d*%/);
  
  // Extract first URL for source attribution
  const urlMatch = rawResult.match(/https?:\/\/([^/\s)]+)/);
  const source = urlMatch ? urlMatch[1] : undefined;
  
  if (!dollarMatch && !pctMatch) return undefined;
  
  const parts: string[] = [];
  if (dollarMatch) parts.push(dollarMatch[0]);
  if (pctMatch) parts.push(pctMatch[0]);
  
  const sourceSuffix = source ? ` (source: ${source})` : "";
  return `${toolName}('${query.slice(0, 60)}'): ${parts.join(", ")}${sourceSuffix}`;
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `bun test packages/reasoning/tests/strategies/kernel/utils/extract-fact.test.ts`

Expected: All pass.

- [x] **Step 5: Wire extraction into act.ts**

In `act.ts`, for both parallel batch path and sequential path, change the execution order:

```typescript
// BEFORE: raw → compress → extract(compressed)
// AFTER: raw → extractFactDeterministic(raw) → compress

import { extractFactDeterministic } from "../utils/tool-execution.js";

// After tool execution returns raw result:
const extractedFact = extractFactDeterministic(
  result.toolName, 
  result.args ?? {}, 
  result.rawContent,
);

// Pass to makeStep:
const obsStep = makeStep("observation", obsContent, {
  toolCallId: result.callId,
  storedKey: result.execResult.storedKey,
  extractedFact,  // <-- NEW: populated from deterministic extraction
  observationResult: makeObservationResult(...),
});
```

- [x] **Step 6: Verify buildPriorWorkSection reads extractedFact**

Read `context-manager.ts` `buildPriorWorkSection()` (line ~212) and confirm it reads `step.metadata?.extractedFact`. If it doesn't, update it to do so.

- [x] **Step 7: Run full test suite + build**

Run: `bun run build && bun test packages/reasoning/ --timeout 30000`

- [x] **Step 8: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/utils/tool-execution.ts \
  packages/reasoning/src/strategies/kernel/phases/act.ts \
  packages/reasoning/tests/strategies/kernel/utils/extract-fact.test.ts
git commit -m "feat(reasoning): wire observation pipeline — extractFactDeterministic → step metadata → Observations section"
```

---

**Phase 3 Gate:** `bun run build && bun test packages/reasoning/ --timeout 30000` — all pass. Run `scratch.ts` with gemma4:e4b to verify agent performance. Check: (1) clean FC message thread (no synthetic USER messages), (2) Observations section in system prompt, (3) guidance delivered through system prompt.

---

## Phase 4: Calibration System (New Feature)

---

### Task 13: ModelCalibration Schema + Types

**Files:**
- Create: `packages/llm-provider/src/calibration.ts`
- Create: `packages/llm-provider/tests/calibration.test.ts`
- Test: `bun test packages/llm-provider/`

- [x] **Step 1: Write failing test for schema validation**

Create `packages/llm-provider/tests/calibration.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { ModelCalibrationSchema, type ModelCalibration } from "../src/calibration.js";

describe("ModelCalibration schema", () => {
  it("should accept a valid calibration", () => {
    const cal: ModelCalibration = {
      modelId: "gemma4:e4b",
      calibratedAt: "2026-04-14T10:00:00Z",
      probeVersion: 1,
      runsAveraged: 3,
      steeringCompliance: "hybrid",
      parallelCallCapability: "reliable",
      observationHandling: "needs-inline-facts",
      systemPromptAttention: "strong",
      optimalToolResultChars: 1500,
    };
    const result = Schema.decodeUnknownSync(ModelCalibrationSchema)(cal);
    expect(result.modelId).toBe("gemma4:e4b");
  });

  it("should reject invalid steeringCompliance", () => {
    const bad = {
      modelId: "test",
      calibratedAt: "2026-04-14T10:00:00Z",
      probeVersion: 1,
      runsAveraged: 1,
      steeringCompliance: "invalid",
      parallelCallCapability: "reliable",
      observationHandling: "needs-inline-facts",
      systemPromptAttention: "strong",
      optimalToolResultChars: 1500,
    };
    expect(() => Schema.decodeUnknownSync(ModelCalibrationSchema)(bad)).toThrow();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test packages/llm-provider/tests/calibration.test.ts`

Expected: FAIL — module not found.

- [x] **Step 3: Implement calibration.ts**

Create `packages/llm-provider/src/calibration.ts`:

```typescript
import { Schema } from "effect";

// ── Schema ────────────────────────────────────────────────────────────────────

export const ModelCalibrationSchema = Schema.Struct({
  modelId: Schema.String,
  calibratedAt: Schema.String,
  probeVersion: Schema.Number,
  runsAveraged: Schema.Number,
  steeringCompliance: Schema.Literal("system-prompt", "user-message", "hybrid"),
  parallelCallCapability: Schema.Literal("reliable", "partial", "sequential-only"),
  observationHandling: Schema.Literal("uses-recall", "needs-inline-facts", "hallucinate-risk"),
  systemPromptAttention: Schema.Literal("strong", "moderate", "weak"),
  optimalToolResultChars: Schema.Number,
});

export type ModelCalibration = typeof ModelCalibrationSchema.Type;

// ── Loader ────────────────────────────────────────────────────────────────────

const calibrationCache = new Map<string, ModelCalibration | null>();

function normalizeModelId(modelId: string): string {
  return modelId.toLowerCase().replace(/:/g, "-").replace(/\s+/g, "-");
}

/**
 * Load a pre-baked or cached calibration for the given modelId.
 * Returns undefined if no calibration exists.
 */
export function loadCalibration(modelId: string): ModelCalibration | undefined {
  const key = normalizeModelId(modelId);
  if (calibrationCache.has(key)) return calibrationCache.get(key) ?? undefined;

  try {
    // Try pre-baked calibrations shipped with the framework
    const path = new URL(`./calibrations/${key}.json`, import.meta.url);
    const data = JSON.parse(require("fs").readFileSync(path, "utf-8"));
    const cal = Schema.decodeUnknownSync(ModelCalibrationSchema)(data);
    calibrationCache.set(key, cal);
    return cal;
  } catch {
    calibrationCache.set(key, null);
    return undefined;
  }
}
```

- [x] **Step 4: Run tests**

Run: `bun test packages/llm-provider/tests/calibration.test.ts`

Expected: All pass.

- [x] **Step 5: Export from package barrel**

Add to `packages/llm-provider/src/index.ts`:

```typescript
export { ModelCalibrationSchema, loadCalibration, type ModelCalibration } from "./calibration.js";
```

- [x] **Step 6: Commit**

```bash
git add packages/llm-provider/src/calibration.ts \
  packages/llm-provider/tests/calibration.test.ts \
  packages/llm-provider/src/index.ts
git commit -m "feat(llm-provider): ModelCalibration schema + loader"
```

---

### Task 14: buildCalibratedAdapter + selectAdapter Upgrade

**Files:**
- Modify: `packages/llm-provider/src/calibration.ts`
- Modify: `packages/llm-provider/src/adapter.ts:262-280`
- Modify: `packages/llm-provider/tests/adapter.test.ts`
- Test: `bun test packages/llm-provider/`

- [x] **Step 1: Write failing tests**

Add to `packages/llm-provider/tests/adapter.test.ts`:

```typescript
import { buildCalibratedAdapter } from "../src/calibration.js";
import type { ModelCalibration } from "../src/calibration.js";

describe("buildCalibratedAdapter", () => {
  const baseCal: ModelCalibration = {
    modelId: "test-model",
    calibratedAt: "2026-04-14T10:00:00Z",
    probeVersion: 1,
    runsAveraged: 3,
    steeringCompliance: "hybrid",
    parallelCallCapability: "sequential-only",
    observationHandling: "needs-inline-facts",
    systemPromptAttention: "weak",
    optimalToolResultChars: 1500,
  };

  it("should set toolGuidance for sequential-only models", () => {
    const { adapter } = buildCalibratedAdapter(baseCal);
    expect(adapter.toolGuidance).toBeDefined();
    const guidance = adapter.toolGuidance!({} as any);
    expect(guidance).toContain("one at a time");
  });

  it("should set systemPromptPatch for weak attention models", () => {
    const { adapter } = buildCalibratedAdapter(baseCal);
    expect(adapter.systemPromptPatch).toBeDefined();
  });

  it("should set profileOverrides.toolResultMaxChars", () => {
    const { profileOverrides } = buildCalibratedAdapter(baseCal);
    expect(profileOverrides.toolResultMaxChars).toBe(1500);
  });
});
```

- [x] **Step 2: Implement buildCalibratedAdapter**

Add to `packages/llm-provider/src/calibration.ts`:

```typescript
import type { ProviderAdapter } from "./adapter.js";
import type { ContextProfile } from "@reactive-agents/reasoning";

export function buildCalibratedAdapter(
  calibration: ModelCalibration,
): { adapter: ProviderAdapter; profileOverrides: Partial<ContextProfile> } {
  const adapter: ProviderAdapter = {
    systemPromptPatch: calibration.systemPromptAttention === "weak"
      ? (base) => base + "\nIMPORTANT: Follow ALL rules above exactly."
      : undefined,

    toolGuidance: calibration.parallelCallCapability === "sequential-only"
      ? () => "Call tools one at a time. Do not batch multiple tool calls."
      : calibration.parallelCallCapability === "partial"
        ? () => "You may call up to 2 independent tools at once."
        : undefined,
  };

  const profileOverrides: Partial<ContextProfile> = {
    toolResultMaxChars: calibration.optimalToolResultChars,
  };

  return { adapter, profileOverrides };
}
```

- [x] **Step 3: Upgrade selectAdapter return type**

In `packages/llm-provider/src/adapter.ts` (line 262), change `selectAdapter` to return `{ adapter, profileOverrides? }`:

```typescript
export function selectAdapter(
  capabilities: { supportsToolCalling: boolean },
  tier?: string,
  modelId?: string,
): { adapter: ProviderAdapter; profileOverrides?: Partial<ContextProfile> } {
  // 1. Calibrated adapter wins
  if (modelId) {
    const cal = loadCalibration(modelId);
    if (cal) return buildCalibratedAdapter(cal);
  }
  // 2. Tier fallback
  if (tier === "local") return { adapter: localModelAdapter };
  if (tier === "mid") return { adapter: midModelAdapter };
  return { adapter: defaultAdapter };
}
```

- [x] **Step 4: Update all selectAdapter call sites**

Run: `grep -rn "selectAdapter(" packages/reasoning/src/ --include="*.ts"`

Update each call site to destructure:

```typescript
// BEFORE:
const adapter = selectAdapter(caps, profile.tier, input.modelId);

// AFTER:
const { adapter, profileOverrides } = selectAdapter(caps, profile.tier, input.modelId);
if (profileOverrides) Object.assign(profile, profileOverrides);
```

- [x] **Step 5: Run full build + tests**

Run: `bun run build && bun test packages/llm-provider/ --timeout 30000 && bun test packages/reasoning/ --timeout 30000`

- [x] **Step 6: Commit**

```bash
git add packages/llm-provider/src/calibration.ts \
  packages/llm-provider/src/adapter.ts \
  packages/llm-provider/tests/adapter.test.ts \
  packages/reasoning/src/
git commit -m "feat(llm-provider): buildCalibratedAdapter + selectAdapter calibration-first upgrade"
```

---

### Task 15: Calibration Probe Suite

**Files:**
- Create: `packages/llm-provider/src/calibration-runner.ts`
- Create: `packages/llm-provider/tests/calibration-runner.test.ts`
- Test: `bun test packages/llm-provider/`

- [x] **Step 1: Implement probe runner with 5 probes**

Create `packages/llm-provider/src/calibration-runner.ts` with:

```typescript
import type { ModelCalibration } from "./calibration.js";

interface ProbeResult {
  steeringCompliance: "system-prompt" | "user-message" | "hybrid";
  parallelCallCapability: "reliable" | "partial" | "sequential-only";
  observationHandling: "uses-recall" | "needs-inline-facts" | "hallucinate-risk";
  systemPromptAttention: "strong" | "moderate" | "weak";
  optimalToolResultChars: number;
}

/**
 * Run the full calibration probe suite against a model.
 * Uses Ollama HTTP API directly (no framework dependency).
 */
export async function runCalibrationProbes(
  modelId: string,
  runs: number = 3,
): Promise<ModelCalibration> {
  const results: ProbeResult[] = [];
  
  for (let i = 0; i < runs; i++) {
    results.push({
      steeringCompliance: await probeSteeringChannel(modelId),
      parallelCallCapability: await probeParallelBatching(modelId),
      observationHandling: await probeRecallBehavior(modelId),
      systemPromptAttention: await probeSystemPromptDecay(modelId),
      optimalToolResultChars: await probeCompressionThreshold(modelId),
    });
  }

  return {
    modelId,
    calibratedAt: new Date().toISOString(),
    probeVersion: 1,
    runsAveraged: runs,
    steeringCompliance: majority(results.map(r => r.steeringCompliance)),
    parallelCallCapability: majority(results.map(r => r.parallelCallCapability)),
    observationHandling: majority(results.map(r => r.observationHandling)),
    systemPromptAttention: majority(results.map(r => r.systemPromptAttention)),
    optimalToolResultChars: median(results.map(r => r.optimalToolResultChars)),
  };
}
```

Implement each probe function (`probeSteeringChannel`, `probeParallelBatching`, etc.) using direct Ollama HTTP API calls (`fetch("http://localhost:11434/api/chat", ...)`). Each probe is a focused 100-token scenario as described in the spec.

- [x] **Step 2: Write tests (with mock Ollama responses)**

The probe tests mock the Ollama HTTP API to verify probe logic without requiring a running model.

- [x] **Step 3: Run tests**

Run: `bun test packages/llm-provider/tests/calibration-runner.test.ts`

- [x] **Step 4: Commit**

```bash
git add packages/llm-provider/src/calibration-runner.ts \
  packages/llm-provider/tests/calibration-runner.test.ts
git commit -m "feat(llm-provider): calibration probe suite — 5 probes for per-model behavior measurement"
```

---

### Task 16: Builder .withCalibration() + Pre-Baked JSONs

**Files:**
- Modify: `packages/runtime/src/builder.ts`
- Modify: `packages/runtime/src/execution-engine.ts`
- Create: `packages/llm-provider/src/calibrations/gemma4-e4b.json`
- Create: `packages/llm-provider/src/calibrations/llama3.2-3b.json`
- Create: `packages/llm-provider/src/calibrations/qwen2.5-coder-7b.json`
- Test: `bun run build`

- [x] **Step 1: Add withCalibration to builder**

In `packages/runtime/src/builder.ts`, add:

```typescript
withCalibration(mode: "auto" | "skip" | ModelCalibration) {
  this.config.calibration = mode;
  return this;
}
```

- [x] **Step 2: Wire calibration through execution-engine to kernel input**

In `packages/runtime/src/execution-engine.ts`, pass calibration data from builder config through to `KernelInput` so it reaches `ContextManager.build()`.

- [x] **Step 3: Pre-bake calibration JSONs**

Create `packages/llm-provider/src/calibrations/` directory. Run the probe suite against each model (requires Ollama running with models pulled) and save results:

```bash
bun run packages/llm-provider/src/calibration-runner.ts --model gemma4:e4b --runs 3 --commit
bun run packages/llm-provider/src/calibration-runner.ts --model llama3.2:3b --runs 3 --commit
bun run packages/llm-provider/src/calibration-runner.ts --model qwen2.5-coder:7b --runs 3 --commit
```

If models aren't available, create reasonable initial JSONs based on known behavior and mark `runsAveraged: 0` to indicate they need empirical validation.

- [x] **Step 4: Run full build + tests**

Run: `bun run build && bun test packages/reasoning/ --timeout 30000`

- [x] **Step 5: Commit**

```bash
git add packages/runtime/src/builder.ts \
  packages/runtime/src/execution-engine.ts \
  packages/llm-provider/src/calibrations/
git commit -m "feat(runtime): .withCalibration() builder method + pre-baked calibrations for 3 models"
```

---

**Phase 4 Gate:** `bun run build && bun test --timeout 30000` — all pass. Calibration loads for known models. selectAdapter returns calibrated adapter when available.

---

## Phase 5: Evidence Grounding

---

### Task 17: Wire Evidence Grounding into Guard Chain

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/utils/evidence-grounding.ts`
- Modify: `packages/reasoning/src/strategies/kernel/phases/think-guards.ts`
- Create: `packages/reasoning/tests/strategies/kernel/phases/evidence-grounding-guard.test.ts`
- Test: `bun test packages/reasoning/`

- [x] **Step 1: Write failing tests**

Create `packages/reasoning/tests/strategies/kernel/phases/evidence-grounding-guard.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { guardEvidenceGrounding } from "../../../../src/strategies/kernel/phases/think-guards.js";
import { createInitialState } from "../../../../src/strategies/kernel/kernel-state.js";
import { makeStep } from "../../../../src/strategies/kernel/utils/step-utils.js";

describe("guardEvidenceGrounding", () => {
  it("should pass when output claims match extractedFacts", () => {
    const state = createInitialState("test task");
    // Add observation steps with extractedFact
    const step = makeStep("observation", "web-search result", {
      extractedFact: "web-search('XRP price'): $1.327 (source: coingecko.com)",
    });
    state.steps.push(step);

    const output = "XRP is currently priced at $1.327 according to CoinGecko.";
    const result = guardEvidenceGrounding(output, state);
    expect(result).toBeUndefined(); // pass through
  });

  it("should redirect when output claims don't match any facts", () => {
    const state = createInitialState("test task");
    const step = makeStep("observation", "web-search result", {
      extractedFact: "web-search('XRP price'): $1.327 (source: coingecko.com)",
    });
    state.steps.push(step);

    const output = "XRP is currently priced at $999.99."; // hallucinated
    const result = guardEvidenceGrounding(output, state);
    expect(result).toBeDefined(); // redirect
    expect(result?.pendingGuidance?.evidenceGap).toBeDefined();
  });
});
```

- [x] **Step 2: Refactor evidence-grounding.ts**

Update `packages/reasoning/src/strategies/kernel/utils/evidence-grounding.ts` to work with `extractedFact` data:

```typescript
/**
 * Extract numerical claims from text (prices, percentages, counts).
 */
export function extractClaims(text: string): string[] {
  const claims: string[] = [];
  const dollars = text.match(/\$[\d,]+\.?\d*/g) ?? [];
  const percents = text.match(/[+-]?\d+\.?\d*%/g) ?? [];
  return [...dollars, ...percents];
}

/**
 * Check if a claim appears in any observation fact from the session.
 */
export function isClaimGrounded(claim: string, facts: string[]): boolean {
  return facts.some(fact => fact.includes(claim));
}

/**
 * Validate that output claims are grounded in session evidence.
 * Returns list of ungrounded claims.
 */
export function findUngroundedClaims(
  output: string,
  extractedFacts: string[],
): string[] {
  const claims = extractClaims(output);
  if (claims.length === 0) return []; // no numerical claims to verify
  return claims.filter(claim => !isClaimGrounded(claim, extractedFacts));
}
```

- [x] **Step 3: Add guardEvidenceGrounding to think-guards.ts**

```typescript
import { findUngroundedClaims } from "../utils/evidence-grounding.js";

export function guardEvidenceGrounding(
  output: string,
  state: KernelState,
): KernelState | undefined {
  // Collect all extractedFact values from observation steps
  const facts = state.steps
    .filter(s => s.type === "observation" && s.metadata?.extractedFact)
    .map(s => s.metadata!.extractedFact as string);

  if (facts.length === 0) return undefined; // no facts to verify against

  const ungrounded = findUngroundedClaims(output, facts);
  const total = extractClaims(output).length;

  if (total === 0) return undefined; // no numerical claims
  if (ungrounded.length / total <= 0.2) return undefined; // >80% grounded

  // Too many ungrounded claims — redirect
  return transitionState(state, {
    status: "thinking",
    iteration: state.iteration + 1,
    pendingGuidance: {
      evidenceGap: ungrounded.join(", "),
    },
  });
}
```

- [x] **Step 4: Wire into guard chain in think.ts**

Ensure `guardEvidenceGrounding` is in the guard chain (already done in Task 8 if the placeholder was included — verify it's imported and called).

- [x] **Step 5: Run full test suite + build**

Run: `bun run build && bun test packages/reasoning/ --timeout 30000`

- [x] **Step 6: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/utils/evidence-grounding.ts \
  packages/reasoning/src/strategies/kernel/phases/think-guards.ts \
  packages/reasoning/tests/strategies/kernel/phases/evidence-grounding-guard.test.ts
git commit -m "feat(reasoning): evidence grounding guard — verify output claims against session facts"
```

---

**Phase 5 Gate:** `bun run build && bun test packages/reasoning/ --timeout 30000` — all pass.

---

## Phase 6: Final Validation

---

### Task 18: End-to-End Validation

**Files:**
- Run: `scratch.ts` with `gemma4:e4b`
- Run: Full monorepo test suite

- [x] **Step 1: Full monorepo build**

Run: `bun run build`

Expected: Zero TypeScript errors across all packages.

- [x] **Step 2: Full monorepo test suite**

Run: `bun test --timeout 30000`

Expected: All tests pass across all packages.

- [x] **Step 3: Reasoning package as-any audit**

Run: `grep -rn "as any" packages/reasoning/src/ --include="*.ts" | grep -v "test" | wc -l`

Expected: 0-2 (SDK type gaps only).

- [x] **Step 4: Dead code audit**

Run:
```bash
# No production callers for internal utils
grep -rn "context-utils" packages/reasoning/src/strategies/kernel/ --include="*.ts" | grep -v index.ts
grep -rn "tool-utils" packages/reasoning/src/ --include="*.ts"
```

Expected: Zero results for both.

- [x] **Step 5: End-to-end probe with gemma4:e4b**

Run `scratch.ts` 3 times. Check:
1. Clean FC message thread (no synthetic USER messages except `[Harness]:` max_tokens recovery)
2. Observations section visible in system prompt (iteration 2+)
3. Guidance delivered through system prompt (or hybrid per calibration)
4. All 4 crypto prices retrieved
5. Output grounded in session evidence

- [x] **Step 6: Verify calibration loads**

Run: `bun -e "const { loadCalibration } = require('./packages/llm-provider/src/calibration.js'); console.log(loadCalibration('gemma4:e4b'))"`

Expected: Returns the pre-baked calibration JSON.

- [x] **Step 7: Final commit with updated docs**

Update `AGENTS.md` and `.agents/MEMORY.md` to reflect the new architecture. Commit.

```bash
git add -A
git commit -m "feat(reasoning): kernel architecture rescue — complete context migration, calibration system, evidence grounding"
```

---

**Plan complete.** 18 tasks across 6 phases. Each phase has a gate. Total estimated: ~25 files modified, ~9 new files, ~3 deleted, net ~500 LOC reduction.
