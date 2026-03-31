# Kernel Refactor: Composable Phase Architecture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename `strategies/shared/` → `strategies/kernel/`, split the 1,700-line `react-kernel.ts` into four focused phase files, introduce a composable `Phase[]` pipeline with a configurable `Guard[]` chain and `MetaToolHandler` registry, and move utility files into a `utils/` subdirectory — with zero behavior changes, improved type safety, and new isolated tests for each extracted module.

**Architecture:** The kernel directory becomes self-documenting: `react-kernel.ts` (orchestrator) → `phases/context-builder.ts` (prepares LLM input) → `phases/think.ts` (LLM call + parse) → `phases/guard.ts` (validates tool calls) → `phases/act.ts` (executes tools). Supporting files live in `utils/`. Phases are typed as `(state, ctx) => Effect<KernelState>` so strategies can substitute individual phases without rewriting the orchestrator.

**Tech Stack:** TypeScript, Effect-TS (Effect, Layer, Context), bun:test, `git mv` for history-preserving renames.

**Spec:** `docs/superpowers/specs/2026-03-30-kernel-refactor-design.md`

---

## Correction from Spec

The spec stated `step-utils.ts` would be absorbed into `act.ts`. This is incorrect — `makeStep` and `buildStrategyResult` are imported by all five strategy files (`adaptive.ts`, `reactive.ts`, `plan-execute.ts`, `reflexion.ts`, `tree-of-thought.ts`), not just `act.ts`. `step-utils.ts` moves to `kernel/utils/step-utils.ts` unchanged.

---

## File Map

### Created
```
packages/reasoning/src/strategies/kernel/phases/context-builder.ts
packages/reasoning/src/strategies/kernel/phases/think.ts
packages/reasoning/src/strategies/kernel/phases/guard.ts
packages/reasoning/src/strategies/kernel/phases/act.ts
packages/reasoning/src/strategies/kernel/utils/ics-coordinator.ts
packages/reasoning/tests/strategies/kernel/phases/guard.test.ts
packages/reasoning/tests/strategies/kernel/phases/context-builder.test.ts
```

### Renamed (git mv — history preserved)
```
strategies/shared/                    → strategies/kernel/
tests/strategies/shared/              → tests/strategies/kernel/
kernel/thinking-utils.ts              → kernel/utils/stream-parser.ts
```

### Moved within repo
```
kernel/tool-utils.ts          → kernel/utils/tool-utils.ts
kernel/tool-execution.ts      → kernel/utils/tool-execution.ts
kernel/termination-oracle.ts  → kernel/utils/termination-oracle.ts
kernel/strategy-evaluator.ts  → kernel/utils/strategy-evaluator.ts
kernel/context-utils.ts       → kernel/utils/context-utils.ts
kernel/quality-utils.ts       → kernel/utils/quality-utils.ts
kernel/service-utils.ts       → kernel/utils/service-utils.ts
kernel/step-utils.ts          → kernel/utils/step-utils.ts
kernel/plan-prompts.ts        → strategies/plan-prompts.ts
```

### Modified
```
kernel/kernel-state.ts    — add Phase, PhaseContext; move ReActKernelInput/ReActKernelResult here
kernel/react-kernel.ts    — slim to ~150 lines, add makeKernel(), absorb output-assembly.ts, re-export types
kernel/kernel-runner.ts   — extract ICS block (~150 lines) to utils/ics-coordinator.ts
strategies/adaptive.ts    — update imports: shared → kernel, step-utils path
strategies/reactive.ts    — update imports
strategies/plan-execute.ts — update imports + plan-prompts path
strategies/reflexion.ts   — update imports
strategies/tree-of-thought.ts — update imports
AGENTS.md                 — update debugging entry points: shared/ → kernel/
```

### Absorbed (too small to justify standalone files)
```
kernel/output-assembly.ts (83 lines) → inlined into react-kernel.ts
```

---

## Task 1: Rename `shared/` → `kernel/` and Create Subdirectories

**Files:**
- Rename: `packages/reasoning/src/strategies/shared/` → `packages/reasoning/src/strategies/kernel/`
- Rename: `packages/reasoning/tests/strategies/shared/` → `packages/reasoning/tests/strategies/kernel/`
- Create: `packages/reasoning/src/strategies/kernel/phases/` (directory)
- Create: `packages/reasoning/src/strategies/kernel/utils/` (directory)

- [ ] **Step 1: Rename the source directory with git (preserves history)**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
git mv packages/reasoning/src/strategies/shared packages/reasoning/src/strategies/kernel
```

- [ ] **Step 2: Rename the test directory with git**

```bash
git mv packages/reasoning/tests/strategies/shared packages/reasoning/tests/strategies/kernel
```

- [ ] **Step 3: Create phase and utils subdirectories**

```bash
mkdir -p packages/reasoning/src/strategies/kernel/phases
mkdir -p packages/reasoning/src/strategies/kernel/utils
touch packages/reasoning/src/strategies/kernel/phases/.gitkeep
touch packages/reasoning/src/strategies/kernel/utils/.gitkeep
```

- [ ] **Step 4: Update imports in all five strategy files (shared → kernel)**

In `packages/reasoning/src/strategies/adaptive.ts`, replace every occurrence of `"./shared/` with `"./kernel/`:

```bash
sed -i 's|from "\./shared/|from "./kernel/|g' packages/reasoning/src/strategies/adaptive.ts
sed -i 's|from "\./shared/|from "./kernel/|g' packages/reasoning/src/strategies/reactive.ts
sed -i 's|from "\./shared/|from "./kernel/|g' packages/reasoning/src/strategies/plan-execute.ts
sed -i 's|from "\./shared/|from "./kernel/|g' packages/reasoning/src/strategies/reflexion.ts
sed -i 's|from "\./shared/|from "./kernel/|g' packages/reasoning/src/strategies/tree-of-thought.ts
```

- [ ] **Step 5: Update imports in test files that reference shared/**

```bash
# Find all test files importing from shared/ and update them
find packages/reasoning/tests -name "*.ts" -exec sed -i 's|from ".*strategies/shared/|from "../../strategies/kernel/|g' {} \;
find packages/reasoning/tests -name "*.ts" -exec sed -i 's|from "\.\./shared/|from "../kernel/|g' {} \;
find packages/reasoning/tests -name "*.ts" -exec sed -i 's|from "\./shared/|from "./kernel/|g' {} \;
```

- [ ] **Step 6: Verify no remaining references to `strategies/shared`**

```bash
grep -r "strategies/shared" packages/reasoning/src packages/reasoning/tests
```

Expected: no output (zero matches).

- [ ] **Step 7: Run the reasoning test suite to verify nothing broke**

```bash
bun test packages/reasoning --timeout 15000
```

Expected: same pass count as before (all green). If any fail, check the import path fixes above.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(reasoning): rename strategies/shared → strategies/kernel, create phases/ and utils/ dirs"
```

---

## Task 2: Move Utilities into `utils/` and Rename `thinking-utils.ts`

**Files:**
- Move 8 utility files into `kernel/utils/`
- Rename `thinking-utils.ts` → `stream-parser.ts`
- Move `plan-prompts.ts` to `strategies/` root (it belongs with `plan-execute.ts`)
- Update all imports

- [ ] **Step 1: Move utility files with git mv**

```bash
cd packages/reasoning/src/strategies/kernel

git mv tool-utils.ts utils/tool-utils.ts
git mv tool-execution.ts utils/tool-execution.ts
git mv termination-oracle.ts utils/termination-oracle.ts
git mv strategy-evaluator.ts utils/strategy-evaluator.ts
git mv context-utils.ts utils/context-utils.ts
git mv quality-utils.ts utils/quality-utils.ts
git mv service-utils.ts utils/service-utils.ts
git mv step-utils.ts utils/step-utils.ts
git mv thinking-utils.ts utils/stream-parser.ts
```

- [ ] **Step 2: Move plan-prompts.ts to strategies/ root**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
git mv packages/reasoning/src/strategies/kernel/plan-prompts.ts packages/reasoning/src/strategies/plan-prompts.ts
```

- [ ] **Step 3: Update internal kernel imports — all files in kernel/ that import from these moved modules**

The files still inside `kernel/` (react-kernel.ts, kernel-runner.ts, kernel-hooks.ts, kernel-state.ts) import these utilities with relative paths like `"./tool-utils.js"`. They now need `"./utils/tool-utils.js"`.

```bash
# Update imports inside kernel/ source files
find packages/reasoning/src/strategies/kernel -maxdepth 1 -name "*.ts" | xargs sed -i \
  -e 's|from "\./tool-utils\.js"|from "./utils/tool-utils.js"|g' \
  -e 's|from "\./tool-execution\.js"|from "./utils/tool-execution.js"|g' \
  -e 's|from "\./termination-oracle\.js"|from "./utils/termination-oracle.js"|g' \
  -e 's|from "\./strategy-evaluator\.js"|from "./utils/strategy-evaluator.js"|g' \
  -e 's|from "\./context-utils\.js"|from "./utils/context-utils.js"|g' \
  -e 's|from "\./quality-utils\.js"|from "./utils/quality-utils.js"|g' \
  -e 's|from "\./service-utils\.js"|from "./utils/service-utils.js"|g' \
  -e 's|from "\./step-utils\.js"|from "./utils/step-utils.js"|g' \
  -e 's|from "\./thinking-utils\.js"|from "./utils/stream-parser.js"|g' \
  -e 's|from "\./plan-prompts\.js"|from "../plan-prompts.js"|g'
```

- [ ] **Step 4: Update strategy files — they import step-utils and thinking-utils from kernel/**

```bash
# adaptive.ts, reactive.ts, plan-execute.ts, reflexion.ts, tree-of-thought.ts
# now reference kernel/utils/ for these
find packages/reasoning/src/strategies -maxdepth 1 -name "*.ts" | xargs sed -i \
  -e 's|from "\./kernel/tool-utils\.js"|from "./kernel/utils/tool-utils.js"|g' \
  -e 's|from "\./kernel/step-utils\.js"|from "./kernel/utils/step-utils.js"|g' \
  -e 's|from "\./kernel/quality-utils\.js"|from "./kernel/utils/quality-utils.js"|g' \
  -e 's|from "\./kernel/service-utils\.js"|from "./kernel/utils/service-utils.js"|g' \
  -e 's|from "\./kernel/thinking-utils\.js"|from "./kernel/utils/stream-parser.js"|g' \
  -e 's|from "\./kernel/context-utils\.js"|from "./kernel/utils/context-utils.js"|g' \
  -e 's|from "\./kernel/plan-prompts\.js"|from "./plan-prompts.js"|g'
```

- [ ] **Step 5: Update test files for moved modules**

```bash
find packages/reasoning/tests -name "*.ts" | xargs sed -i \
  -e 's|kernel/tool-utils|kernel/utils/tool-utils|g' \
  -e 's|kernel/step-utils|kernel/utils/step-utils|g' \
  -e 's|kernel/quality-utils|kernel/utils/quality-utils|g' \
  -e 's|kernel/service-utils|kernel/utils/service-utils|g' \
  -e 's|kernel/thinking-utils|kernel/utils/stream-parser|g' \
  -e 's|kernel/termination-oracle|kernel/utils/termination-oracle|g' \
  -e 's|kernel/strategy-evaluator|kernel/utils/strategy-evaluator|g' \
  -e 's|kernel/tool-execution|kernel/utils/tool-execution|g' \
  -e 's|kernel/context-utils|kernel/utils/context-utils|g' \
  -e 's|kernel/plan-prompts|strategies/plan-prompts|g'
```

- [ ] **Step 6: Verify no orphan imports remain**

```bash
grep -r "from.*kernel/tool-utils\b\|from.*kernel/step-utils\b\|from.*kernel/thinking-utils\b\|from.*kernel/plan-prompts\b" \
  packages/reasoning/src packages/reasoning/tests
```

Expected: no output.

- [ ] **Step 7: Run tests**

```bash
bun test packages/reasoning --timeout 15000
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(reasoning): move utilities to kernel/utils/, rename thinking-utils → stream-parser, relocate plan-prompts"
```

---

## Task 3: Add `Phase` Type and Move `ReActKernelInput`/`ReActKernelResult` to `kernel-state.ts`

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/kernel-state.ts`
- Modify: `packages/reasoning/src/strategies/kernel/react-kernel.ts`

- [ ] **Step 1: Read both files to understand current exports**

```bash
head -80 packages/reasoning/src/strategies/kernel/kernel-state.ts
grep -n "export interface ReActKernelInput\|export interface ReActKernelResult" \
  packages/reasoning/src/strategies/kernel/react-kernel.ts
```

- [ ] **Step 2: Add `Phase`, `PhaseContext`, and the moved types to `kernel-state.ts`**

At the bottom of `packages/reasoning/src/strategies/kernel/kernel-state.ts`, add:

```typescript
// ─── Phase Pipeline Types ────────────────────────────────────────────────────

import type { ContextProfile } from "../../context/context-profile.js";
import type { LLMService } from "@reactive-agents/llm-provider";

/**
 * A single step in the kernel turn pipeline.
 *
 * Pure state transition: takes the current immutable KernelState and a read-only
 * PhaseContext, returns an Effect that produces the next KernelState.
 *
 * Composable: custom kernels substitute individual phases via makeKernel({ phases }).
 */
export type Phase = (
  state: KernelState,
  ctx: PhaseContext,
) => Effect.Effect<KernelState, never, LLMService>;

/**
 * Immutable per-turn context passed to every phase.
 * Phases read from ctx, write only to returned KernelState.
 */
export interface PhaseContext {
  readonly input: ReActKernelInput;
  readonly profile: ContextProfile;
  readonly hooks: KernelHooks;
}
```

Note: `ReActKernelInput` is defined in `react-kernel.ts` today. The reference above creates a forward dependency. Resolve in the next step by physically moving the interface.

- [ ] **Step 3: Move `ReActKernelInput` and `ReActKernelResult` from `react-kernel.ts` to `kernel-state.ts`**

Cut the two interface definitions from `react-kernel.ts` (the `export interface ReActKernelInput { ... }` and `export interface ReActKernelResult { ... }` blocks) and paste them into `kernel-state.ts` above the Phase types added in Step 2.

Then in `react-kernel.ts`, replace the now-removed interface bodies with re-exports:

```typescript
// Re-exported from kernel-state for backward compatibility — all consumers compile unchanged
export type { ReActKernelInput, ReActKernelResult } from "./kernel-state.js";
```

- [ ] **Step 4: Verify TypeScript compiles cleanly**

```bash
cd packages/reasoning && bun run typecheck 2>&1 | head -40
```

Expected: no errors related to `ReActKernelInput` or `ReActKernelResult`.

- [ ] **Step 5: Run tests**

```bash
bun test packages/reasoning --timeout 15000
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/kernel-state.ts \
        packages/reasoning/src/strategies/kernel/react-kernel.ts
git commit -m "refactor(reasoning): move ReActKernelInput/Result to kernel-state, add Phase and PhaseContext types"
```

---

## Task 4: Extract `phases/guard.ts` — Configurable Guard Pipeline

**Files:**
- Create: `packages/reasoning/src/strategies/kernel/phases/guard.ts`
- Create: `packages/reasoning/tests/strategies/kernel/phases/guard.test.ts`
- Modify: `packages/reasoning/src/strategies/kernel/react-kernel.ts` (remove inline guard logic, call `checkToolCall`)

- [ ] **Step 1: Write the failing tests first**

Create `packages/reasoning/tests/strategies/kernel/phases/guard.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import {
  blockedGuard,
  duplicateGuard,
  sideEffectGuard,
  repetitionGuard,
  defaultGuards,
  checkToolCall,
} from "../../../../src/strategies/kernel/phases/guard.js";
import type { KernelState } from "../../../../src/strategies/kernel/kernel-state.js";
import { transitionState } from "../../../../src/strategies/kernel/kernel-state.js";

// ── Minimal state factory ─────────────────────────────────────────────────────

function makeState(overrides: Partial<KernelState> = {}): KernelState {
  return {
    taskId: "test-task",
    strategy: "reactive",
    kernelType: "react",
    steps: [],
    toolsUsed: new Set(),
    scratchpad: new Map(),
    iteration: 0,
    tokens: 0,
    cost: 0,
    status: "acting",
    output: null,
    error: null,
    llmCalls: 0,
    meta: {},
    controllerDecisionLog: [],
    messages: [],
    ...overrides,
  } as KernelState;
}

function makeTc(name: string, args: Record<string, unknown> = {}, id = "call-1") {
  return { id, name, arguments: args };
}

const baseInput = { task: "do something", requiredTools: [] } as any;

// ── blockedGuard ──────────────────────────────────────────────────────────────

describe("blockedGuard", () => {
  it("passes when tool is not in input.blockedTools", () => {
    const result = blockedGuard(makeTc("web-search"), makeState(), { ...baseInput, blockedTools: [] });
    expect(result.pass).toBe(true);
  });

  it("blocks when tool is in input.blockedTools", () => {
    const result = blockedGuard(makeTc("web-search"), makeState(), { ...baseInput, blockedTools: ["web-search"] });
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.observation).toContain("web-search");
      expect(result.observation).toContain("BLOCKED");
    }
  });

  it("passes when blockedTools is undefined", () => {
    const result = blockedGuard(makeTc("web-search"), makeState(), { ...baseInput, blockedTools: undefined });
    expect(result.pass).toBe(true);
  });
});

// ── sideEffectGuard ───────────────────────────────────────────────────────────

describe("sideEffectGuard", () => {
  it("passes for a non-side-effect tool", () => {
    const result = sideEffectGuard(makeTc("web-search"), makeState(), baseInput);
    expect(result.pass).toBe(true);
  });

  it("passes for a side-effect tool with no prior successful call", () => {
    const result = sideEffectGuard(makeTc("send-email"), makeState(), baseInput);
    expect(result.pass).toBe(true);
  });

  it("blocks a side-effect tool that already ran successfully", () => {
    const priorAction = {
      id: "step-1", type: "action" as const, content: "send-email({})",
      metadata: { toolCall: { name: "send-email", arguments: {} } }, timestamp: new Date(),
    };
    const priorObs = {
      id: "step-2", type: "observation" as const, content: "Email sent",
      metadata: { observationResult: { toolName: "send-email", success: true, content: "Email sent" } },
      timestamp: new Date(),
    };
    const state = makeState({ steps: [priorAction, priorObs] as any });
    const result = sideEffectGuard(makeTc("send-email", { to: "other@example.com" }), state, baseInput);
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.observation).toContain("Side-effect tools must NOT be called twice");
    }
  });
});

// ── repetitionGuard ───────────────────────────────────────────────────────────

describe("repetitionGuard", () => {
  it("passes when tool called fewer than 2 times", () => {
    const action = {
      id: "s1", type: "action" as const, content: "web-search({})",
      metadata: { toolCall: { name: "web-search", arguments: {} } }, timestamp: new Date(),
    };
    const state = makeState({ steps: [action] as any });
    const result = repetitionGuard(makeTc("web-search"), state, baseInput);
    expect(result.pass).toBe(true);
  });

  it("blocks when tool has been called 2 or more times", () => {
    const makeAction = (id: string) => ({
      id, type: "action" as const, content: "web-search({})",
      metadata: { toolCall: { name: "web-search", arguments: {} } }, timestamp: new Date(),
    });
    const state = makeState({ steps: [makeAction("s1"), makeAction("s2")] as any });
    const result = repetitionGuard(makeTc("web-search"), state, baseInput);
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.observation).toContain("Stop repeating this tool");
    }
  });

  it("passes for meta-tools regardless of call count", () => {
    const makeAction = (id: string) => ({
      id, type: "action" as const, content: "brief({})",
      metadata: { toolCall: { name: "brief", arguments: {} } }, timestamp: new Date(),
    });
    const state = makeState({ steps: [makeAction("s1"), makeAction("s2"), makeAction("s3")] as any });
    const result = repetitionGuard(makeTc("brief"), state, baseInput);
    expect(result.pass).toBe(true);
  });
});

// ── checkToolCall (pipeline) ──────────────────────────────────────────────────

describe("checkToolCall", () => {
  it("passes when all guards pass", () => {
    const check = checkToolCall(defaultGuards);
    const result = check(makeTc("web-search"), makeState(), baseInput);
    expect(result.pass).toBe(true);
  });

  it("short-circuits on first failing guard", () => {
    const alwaysFail = () => ({ pass: false as const, observation: "first guard failed" });
    const neverRun = () => { throw new Error("should not be called"); };
    const check = checkToolCall([alwaysFail, neverRun] as any);
    const result = check(makeTc("web-search"), makeState(), baseInput);
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.observation).toBe("first guard failed");
  });

  it("accepts a custom guard chain — strategies can configure their own rules", () => {
    const customGuard = (tc: any) =>
      tc.name === "forbidden" ? { pass: false as const, observation: "forbidden tool" } : { pass: true as const };
    const check = checkToolCall([customGuard]);
    expect(check(makeTc("web-search"), makeState(), baseInput).pass).toBe(true);
    expect(check(makeTc("forbidden"), makeState(), baseInput).pass).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails (file doesn't exist yet)**

```bash
bun test packages/reasoning/tests/strategies/kernel/phases/guard.test.ts --timeout 10000
```

Expected: FAIL — `Cannot find module '.../phases/guard.js'`

- [ ] **Step 3: Create `packages/reasoning/src/strategies/kernel/phases/guard.ts`**

Extract the guard logic from `react-kernel.ts` `handleActing` (the four inline guard blocks at lines ~1272–1475) into clean, exported functions:

```typescript
/**
 * Guard pipeline for the acting phase.
 *
 * Each Guard is a pure function: (toolCall, state, input) → GuardOutcome.
 * Guards run in order; first failure short-circuits with an observation
 * injected back into the LLM context on the next turn.
 *
 * Strategies configure their own chain by passing a custom Guard[] to checkToolCall().
 */
import type { KernelState } from "../kernel-state.js";
import type { ReActKernelInput } from "../kernel-state.js";
import type { ToolCallSpec } from "@reactive-agents/tools";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GuardOutcome =
  | { readonly pass: true }
  | { readonly pass: false; readonly observation: string };

export type Guard = (
  tc: ToolCallSpec,
  state: KernelState,
  input: ReActKernelInput,
) => GuardOutcome;

// ─── Individual Guards ────────────────────────────────────────────────────────

const META_TOOL_NAMES = new Set([
  "final-answer", "task-complete", "context-status",
  "brief", "pulse", "find", "recall",
]);

/**
 * Blocks tools explicitly listed in input.blockedTools.
 * Used by strategies to prevent re-execution across kernel passes.
 */
export const blockedGuard: Guard = (tc, _state, input) => {
  if (input.blockedTools?.includes(tc.name)) {
    return {
      pass: false,
      observation: `⚠️ BLOCKED: ${tc.name} already executed successfully in a prior pass.`,
    };
  }
  return { pass: true };
};

/**
 * Blocks the exact same tool+arguments pair if it already succeeded in a prior step.
 * Surfaces the prior result with an advisory to avoid redundant LLM calls.
 */
export const duplicateGuard: Guard = (tc, state, input) => {
  const currentActionJson = JSON.stringify({ tool: tc.name, args: tc.arguments });
  const priorSuccessIdx = state.steps.findIndex((step, idx) => {
    if (step.type !== "action") return false;
    const stepTc = step.metadata?.toolCall as { name: string; arguments: unknown } | undefined;
    if (!stepTc) return false;
    if (JSON.stringify({ tool: stepTc.name, args: stepTc.arguments }) !== currentActionJson) return false;
    const next = state.steps[idx + 1];
    return next?.type === "observation" && next.metadata?.observationResult?.success === true;
  });

  if (priorSuccessIdx < 0) return { pass: true };

  const priorObsContent = state.steps[priorSuccessIdx + 1]?.content ?? "";
  const requiredTools = input.requiredTools ?? [];
  const missingReq = requiredTools.filter((t) => !state.toolsUsed.has(t));
  const nextHint = missingReq.length > 0
    ? `You still need to call: ${missingReq.join(", ")}. Do that now.`
    : "Give FINAL ANSWER if all steps are complete.";

  return {
    pass: false,
    observation: `${priorObsContent} [Already done — do NOT repeat. ${nextHint}]`,
  };
};

/**
 * Blocks re-execution of tools whose names start with a side-effect prefix
 * (send, create, delete, push, etc.) when they've already succeeded — even
 * with different arguments, since the external mutation already occurred.
 */
export const sideEffectGuard: Guard = (tc, state, _input) => {
  const SIDE_EFFECT_PREFIXES = [
    "send", "create", "delete", "push", "merge",
    "fork", "update", "assign", "remove",
  ];
  const isSideEffectTool = SIDE_EFFECT_PREFIXES.some(
    (p) => tc.name.toLowerCase().includes(p),
  );
  if (!isSideEffectTool) return { pass: true };

  const alreadyDone = state.steps.some((step, idx) => {
    if (step.type !== "action") return false;
    const stepTc = step.metadata?.toolCall as { name: string } | undefined;
    if (stepTc?.name !== tc.name) return false;
    const next = state.steps[idx + 1];
    return next?.type === "observation" && next.metadata?.observationResult?.success === true;
  });

  if (!alreadyDone) return { pass: true };

  return {
    pass: false,
    observation: `⚠️ ${tc.name} already executed successfully with different parameters. Side-effect tools must NOT be called twice. Move on to the next step or give FINAL ANSWER.`,
  };
};

/**
 * Nudges the LLM when it calls the same non-meta tool 2+ times in a row.
 * Includes a hint about remaining required tools to redirect attention.
 */
export const repetitionGuard: Guard = (tc, state, input) => {
  if (META_TOOL_NAMES.has(tc.name)) return { pass: true };

  const priorCalls = state.steps.filter((s) => {
    if (s.type !== "action") return false;
    const stepTc = s.metadata?.toolCall as { name: string } | undefined;
    return (stepTc?.name ?? "") === tc.name;
  }).length;

  if (priorCalls < 2) return { pass: true };

  const requiredTools = input.requiredTools ?? [];
  const missingRequired = requiredTools.filter((t) => !state.toolsUsed.has(t));
  const missingHint = missingRequired.length > 0
    ? ` You still need to call: ${missingRequired.join(", ")}. Do that now instead of repeating ${tc.name}.`
    : " Use final-answer to respond now.";

  return {
    pass: false,
    observation: `⚠️ You have already called ${tc.name} ${priorCalls} times. Stop repeating this tool.${missingHint}`,
  };
};

// ─── Default Pipeline ─────────────────────────────────────────────────────────

/** Default guard chain used by the standard ReAct kernel. */
export const defaultGuards: Guard[] = [
  blockedGuard,
  duplicateGuard,
  sideEffectGuard,
  repetitionGuard,
];

// ─── Pipeline Runner ──────────────────────────────────────────────────────────

/**
 * Builds a guard-check function from a pipeline of guards.
 * Guards run in order; first failure short-circuits.
 *
 * @example
 * // Standard usage
 * const check = checkToolCall(defaultGuards);
 *
 * // Strategy-specific: reflexion skips repetitionGuard
 * const check = checkToolCall([blockedGuard, duplicateGuard, sideEffectGuard]);
 */
export function checkToolCall(guards: Guard[]) {
  return (tc: ToolCallSpec, state: KernelState, input: ReActKernelInput): GuardOutcome => {
    for (const guard of guards) {
      const outcome = guard(tc, state, input);
      if (!outcome.pass) return outcome;
    }
    return { pass: true };
  };
}
```

- [ ] **Step 4: Run the guard tests**

```bash
bun test packages/reasoning/tests/strategies/kernel/phases/guard.test.ts --timeout 10000
```

Expected: all tests PASS.

- [ ] **Step 5: Replace inline guard blocks in `react-kernel.ts` `handleActing` with `checkToolCall` calls**

In `react-kernel.ts`, add to imports:
```typescript
import {
  checkToolCall,
  defaultGuards,
  type GuardOutcome,
} from "./phases/guard.js";
```

In `handleActing`, replace the four inline guard blocks (the `isBlocked` check, `isDuplicate` check, `isSideEffectTool` check, and `priorCallsOfSameTool` check) with a single guard pipeline call:

```typescript
// Replace the four separate guard blocks with:
const guardCheck = checkToolCall(defaultGuards);
const guardOutcome = guardCheck(tc, transitionState(state, { steps: allSteps }), input);
if (!guardOutcome.pass) {
  const actionStep = makeStep("action", `${tc.name}(${JSON.stringify(tc.arguments)})`, {
    toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments },
  });
  const guardObsStep = makeStep("observation", guardOutcome.observation, {
    observationResult: makeObservationResult(tc.name, true, guardOutcome.observation),
  });
  yield* hooks.onAction(state, tc.name, JSON.stringify(tc.arguments));
  yield* hooks.onObservation(
    transitionState(state, { steps: [...allSteps, actionStep] }),
    guardOutcome.observation,
    true,
  );
  allSteps = [...allSteps, actionStep, guardObsStep];
  continue;
}
```

- [ ] **Step 6: Run the full reasoning test suite**

```bash
bun test packages/reasoning --timeout 15000
```

Expected: all green. If guard behavior tests fail, compare the extracted logic against the original inline blocks.

- [ ] **Step 7: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/phases/guard.ts \
        packages/reasoning/tests/strategies/kernel/phases/guard.test.ts \
        packages/reasoning/src/strategies/kernel/react-kernel.ts
git commit -m "refactor(reasoning): extract guard pipeline to phases/guard.ts — Guard[], checkToolCall(), defaultGuards"
```

---

## Task 5: Extract `phases/context-builder.ts`

**Files:**
- Create: `packages/reasoning/src/strategies/kernel/phases/context-builder.ts`
- Create: `packages/reasoning/tests/strategies/kernel/phases/context-builder.test.ts`
- Modify: `packages/reasoning/src/strategies/kernel/react-kernel.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/reasoning/tests/strategies/kernel/phases/context-builder.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import {
  buildSystemPrompt,
  toProviderMessage,
  buildToolSchemas,
} from "../../../../src/strategies/kernel/phases/context-builder.js";
import type { KernelMessage } from "../../../../src/strategies/kernel/kernel-state.js";

// ── buildSystemPrompt ─────────────────────────────────────────────────────────

describe("buildSystemPrompt", () => {
  it("includes the task description", () => {
    const result = buildSystemPrompt("Write a haiku", undefined, "mid");
    expect(result).toContain("Write a haiku");
  });

  it("includes a custom system prompt when provided", () => {
    const result = buildSystemPrompt("task", "You are a poet.", "mid");
    expect(result).toContain("You are a poet.");
  });

  it("returns a non-empty string for all tiers", () => {
    for (const tier of ["local", "mid", "large", "frontier"] as const) {
      expect(buildSystemPrompt("task", undefined, tier).length).toBeGreaterThan(10);
    }
  });
});

// ── toProviderMessage ─────────────────────────────────────────────────────────

describe("toProviderMessage", () => {
  it("converts a user KernelMessage to LLMMessage format", () => {
    const msg: KernelMessage = { role: "user", content: "hello" };
    const result = toProviderMessage(msg);
    expect(result.role).toBe("user");
    expect(result.content).toBe("hello");
  });

  it("converts an assistant KernelMessage without toolCalls", () => {
    const msg: KernelMessage = { role: "assistant", content: "I will search." };
    const result = toProviderMessage(msg);
    expect(result.role).toBe("assistant");
  });

  it("converts a tool_result KernelMessage", () => {
    const msg: KernelMessage = {
      role: "tool_result",
      toolCallId: "call-1",
      toolName: "web-search",
      content: "Results here",
    };
    const result = toProviderMessage(msg);
    // Provider format varies — just verify it doesn't throw and has content
    expect(typeof result.content).toBe("string");
  });
});

// ── buildToolSchemas ──────────────────────────────────────────────────────────

describe("buildToolSchemas", () => {
  const mockProfile = { tier: "mid" as const, maxTokens: 4096, temperature: 0.7 };
  const mockInput = {
    task: "do something",
    availableToolSchemas: [
      { name: "web-search", description: "Search", parameters: {} },
      { name: "file-write", description: "Write", parameters: {} },
    ],
    blockedTools: [],
  } as any;

  it("returns all schemas when no tools are gate-blocked", () => {
    const state = {
      toolsUsed: new Set<string>(),
      meta: { gateBlockedTools: [] },
      steps: [],
    } as any;
    const schemas = buildToolSchemas(state, mockInput, mockProfile as any);
    expect(schemas.length).toBeGreaterThanOrEqual(2);
  });

  it("removes gate-blocked tools when required tools are still unmet", () => {
    const state = {
      toolsUsed: new Set<string>(),
      meta: { gateBlockedTools: ["file-write"] },
      steps: [],
    } as any;
    const inputWithRequired = { ...mockInput, requiredTools: ["web-search"] };
    const schemas = buildToolSchemas(state, inputWithRequired, mockProfile as any);
    expect(schemas.find((s: any) => s.name === "file-write")).toBeUndefined();
    expect(schemas.find((s: any) => s.name === "web-search")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun test packages/reasoning/tests/strategies/kernel/phases/context-builder.test.ts --timeout 10000
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `packages/reasoning/src/strategies/kernel/phases/context-builder.ts`**

Extract from the top of `handleThinking` in `react-kernel.ts` (the functions `buildSystemPrompt`, `toProviderMessage`, and the inline message/tool-schema building logic):

```typescript
/**
 * Context Builder — prepares everything the LLM sees on this turn.
 *
 * Pure data transformation: no LLM calls, no Effect services.
 * Fully unit-testable in isolation.
 */
import type { ContextProfile } from "../../../context/context-profile.js";
import { applyMessageWindow } from "../../../context/message-window.js";
import { buildStaticContext, buildRules } from "../../../context/context-engine.js";
import type { LLMMessage } from "@reactive-agents/llm-provider";
import { selectAdapter } from "@reactive-agents/llm-provider";
import { scratchpadStoreRef } from "@reactive-agents/tools";
import { Ref } from "effect";
import type { ToolSchema } from "../utils/tool-utils.js";
import type { KernelState, KernelMessage, ReActKernelInput } from "../kernel-state.js";

// ─── System Prompt ────────────────────────────────────────────────────────────

/**
 * Builds the static system prompt for this turn.
 * Combines the task description with an optional custom system prompt
 * and tier-adaptive rules from the context engine.
 */
export function buildSystemPrompt(
  task: string,
  systemPrompt: string | undefined,
  tier: string,
): string {
  // Extract the existing implementation from react-kernel.ts lines ~168-188
  // (the buildSystemPrompt function currently defined at module scope)
  const base = systemPrompt ?? "";
  const tierNote = tier === "local"
    ? "\nYou are running on a local model. Be concise and focused."
    : "";
  return [base, tierNote, `\nTask: ${task}`].filter(Boolean).join("\n").trim();
}

// ─── Message Conversion ───────────────────────────────────────────────────────

/**
 * Converts a kernel-internal KernelMessage to the LLM provider's LLMMessage format.
 * The kernel uses KernelMessage for its own conversation thread;
 * the provider needs LLMMessage for API calls.
 */
export function toProviderMessage(msg: KernelMessage): LLMMessage {
  // Extract from react-kernel.ts lines ~217-247 (the toProviderMessage function)
  if (msg.role === "user") {
    return { role: "user", content: msg.content };
  }
  if (msg.role === "assistant") {
    return {
      role: "assistant",
      content: msg.content,
      ...(msg.toolCalls && msg.toolCalls.length > 0 ? { toolCalls: msg.toolCalls } : {}),
    } as LLMMessage;
  }
  // tool_result
  return {
    role: "tool",
    content: msg.content,
    toolCallId: msg.toolCallId,
    toolName: msg.toolName,
  } as LLMMessage;
}

// ─── Tool Schemas ─────────────────────────────────────────────────────────────

/**
 * Filters tool schemas for this turn.
 *
 * When required tools are unmet and gate-blocked tools are set, removes gate-blocked
 * tools from the schema list so the LLM focuses on the remaining required tools.
 * Meta-tools and the final-answer tool are injected/managed by think.ts separately.
 */
export function buildToolSchemas(
  state: KernelState,
  input: ReActKernelInput,
  _profile: ContextProfile,
): readonly ToolSchema[] {
  const schemas = (input.availableToolSchemas ?? []) as ToolSchema[];
  const gateBlockedTools = (state.meta.gateBlockedTools as readonly string[] | undefined) ?? [];
  const missingRequired = (input.requiredTools ?? []).filter((t) => !state.toolsUsed.has(t));

  if (gateBlockedTools.length > 0 && missingRequired.length > 0) {
    return schemas.filter((s) => !gateBlockedTools.includes(s.name));
  }
  return schemas;
}

// ─── Conversation Messages ────────────────────────────────────────────────────

/**
 * Prepares the conversation message array for this LLM call.
 *
 * Applies the sliding message window (tier-adaptive), injects ICS synthesized
 * context when present, and injects the auto-forward scratchpad section for
 * compressed tool results from the prior turn.
 */
export function buildConversationMessages(
  state: KernelState,
  input: ReActKernelInput,
  profile: ContextProfile,
): readonly KernelMessage[] {
  // Extract the ICS + message-window + auto-forward logic from
  // react-kernel.ts handleThinking lines ~319-453
  // (the hasICS branch, autoForwardSection, applyMessageWindow call)
  const hasICS = state.synthesizedContext != null;
  if (hasICS && state.synthesizedContext) {
    return applyMessageWindow(state.messages, profile.tier ?? "mid");
  }
  return applyMessageWindow(state.messages, profile.tier ?? "mid");
}
```

> **Implementation note:** The actual bodies of `buildSystemPrompt`, `toProviderMessage`, and `buildConversationMessages` should be exact extractions of the corresponding logic from `react-kernel.ts` — not the simplified stubs above. The stubs are shown for interface clarity. Copy the full implementations from lines 168–188, 217–247, and 302–453 of `react-kernel.ts` respectively.

- [ ] **Step 4: Run context-builder tests**

```bash
bun test packages/reasoning/tests/strategies/kernel/phases/context-builder.test.ts --timeout 10000
```

Expected: all PASS.

- [ ] **Step 5: Update `react-kernel.ts` to import from context-builder**

Add to imports in `react-kernel.ts`:
```typescript
import {
  buildSystemPrompt,
  toProviderMessage,
  buildConversationMessages,
  buildToolSchemas,
} from "./phases/context-builder.js";
```

Remove the now-duplicated `buildSystemPrompt` and `toProviderMessage` function definitions from `react-kernel.ts` (they're now in context-builder). Replace inline calls in `handleThinking` to use the imported versions.

- [ ] **Step 6: Run full suite**

```bash
bun test packages/reasoning --timeout 15000
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/phases/context-builder.ts \
        packages/reasoning/tests/strategies/kernel/phases/context-builder.test.ts \
        packages/reasoning/src/strategies/kernel/react-kernel.ts
git commit -m "refactor(reasoning): extract context-builder phase — buildSystemPrompt, toProviderMessage, buildToolSchemas, buildConversationMessages"
```

---

## Task 6: Extract `phases/think.ts`

**Files:**
- Create: `packages/reasoning/src/strategies/kernel/phases/think.ts`
- Modify: `packages/reasoning/src/strategies/kernel/react-kernel.ts`

- [ ] **Step 1: Create `packages/reasoning/src/strategies/kernel/phases/think.ts`**

Extract the entire `handleThinking` function from `react-kernel.ts` into this file. The function signature changes from a closure to an explicit module-level function matching the `Phase` type:

```typescript
/**
 * Think phase — calls the LLM and understands what it decided to do.
 *
 * Responsibilities:
 * - Calls context-builder to prepare messages, system prompt, and tool schemas
 * - Streams the LLM response, accumulating text deltas via FiberRef callback
 * - Parses native FC tool_use blocks from the stream
 * - Detects consecutive identical thoughts and injects nudge observations
 * - Handles the trivial-task fast-path exit (1 iteration for simple Q&A)
 * - Calls the termination oracle when appropriate
 *
 * On return:
 * - state.meta.pendingNativeToolCalls set → acting phase will dispatch them
 * - state.status = "done" → fast-path or direct-answer exit
 * - state.status = "acting" → normal flow continues to act phase
 */
import { Effect, FiberRef, Either } from "effect";
import { LLMService, selectAdapter } from "@reactive-agents/llm-provider";
import { StreamingTextCallback } from "@reactive-agents/core";
import {
  buildConversationMessages,
  buildToolSchemas,
  buildSystemPrompt,
  toProviderMessage,
} from "./context-builder.js";
import { evaluateTermination, defaultEvaluators } from "../utils/termination-oracle.js";
import { extractThinking, rescueFromThinking } from "../utils/stream-parser.js";
import { makeStep } from "../utils/step-utils.js";
import { transitionState, type KernelState, type PhaseContext } from "../kernel-state.js";
import { shouldShowFinalAnswer, finalAnswerTool } from "@reactive-agents/tools";
// ... (all other imports carried over from react-kernel.ts handleThinking)

export function handleThinking(
  state: KernelState,
  ctx: PhaseContext,
): Effect.Effect<KernelState, never, LLMService> {
  return Effect.gen(function* () {
    // Full body extracted from react-kernel.ts handleThinking (lines ~250-1090)
    // Closed-over variables (input, profile, hooks) are now read from ctx:
    //   input   → ctx.input
    //   profile → ctx.profile
    //   hooks   → ctx.hooks
  });
}
```

> **Implementation note:** Copy the full `handleThinking` body from `react-kernel.ts` lines 250–1090 verbatim. Replace every reference to `input`, `profile`, and `hooks` that were previously closed over with `ctx.input`, `ctx.profile`, and `ctx.hooks`. The logic does not change.

- [ ] **Step 2: Update `react-kernel.ts` to call `think.ts`**

In `react-kernel.ts`:

```typescript
import { handleThinking } from "./phases/think.js";
```

Replace the inline `handleThinking` function definition with a call to the imported version.

- [ ] **Step 3: Run the full test suite**

```bash
bun test packages/reasoning --timeout 15000
```

Expected: all green. The existing `react-kernel.test.ts`, `reactive.test.ts` etc. are the regression suite.

- [ ] **Step 4: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/phases/think.ts \
        packages/reasoning/src/strategies/kernel/react-kernel.ts
git commit -m "refactor(reasoning): extract think phase to phases/think.ts — LLM stream, FC parsing, loop detection, fast-path"
```

---

## Task 7: Extract `phases/act.ts` with Meta-Tool Registry

**Files:**
- Create: `packages/reasoning/src/strategies/kernel/phases/act.ts`
- Modify: `packages/reasoning/src/strategies/kernel/react-kernel.ts`

- [ ] **Step 1: Create `packages/reasoning/src/strategies/kernel/phases/act.ts`**

Extract the entire `handleActing` function from `react-kernel.ts`. Introduce the `MetaToolHandler` registry pattern to replace the four inline `if (tc.name === "brief")` / `if (tc.name === "pulse")` blocks.

```typescript
/**
 * Act phase — executes tool calls approved by the guard pipeline.
 *
 * Responsibilities:
 * - Dispatches meta-tools (brief, pulse, recall, find) via a registry
 * - Runs the final-answer hard gate (completion gap detection, capture, rejection)
 * - Calls checkToolCall(defaultGuards) for all other tool calls
 * - Executes approved tools via ToolService
 * - Builds the FC message thread entries (assistant turn + tool_result messages)
 * - Emits onAction / onObservation hooks for observability
 */
import { Effect, Ref } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import {
  ToolService,
  scratchpadStoreRef,
  makeFinalAnswerHandler,
  shouldShowFinalAnswer,
  detectCompletionGaps,
  makeRecallHandler,
  makeFindHandler,
  buildBriefResponse,
  buildPulseResponse,
  type BriefInput,
  type PulseInput,
  type FinalAnswerCapture,
  type ToolCallSpec,
  makeObservationResult,
  executeNativeToolCall,
} from "@reactive-agents/tools";
import { checkToolCall, defaultGuards } from "./guard.js";
import { makeStep } from "../utils/step-utils.js";
import { selectAdapter } from "@reactive-agents/llm-provider";
import {
  transitionState,
  type KernelState,
  type KernelMessage,
  type PhaseContext,
} from "../kernel-state.js";

// ─── Meta-Tool Registry ───────────────────────────────────────────────────────

type MetaToolResult = { content: string; success: boolean };

type MetaToolHandler = (
  tc: ToolCallSpec,
  state: KernelState,
  ctx: PhaseContext,
) => Effect.Effect<MetaToolResult, never>;

// Registry — new meta-tools are one-line additions here
const metaToolRegistry = new Map<string, MetaToolHandler>([
  ["brief",  handleBrief],
  ["pulse",  handlePulse],
  ["recall", handleRecall],
  ["find",   handleFind],
]);

// Individual handlers extracted from react-kernel.ts handleActing
// (lines ~1112-1180, one block per meta-tool)

function handleBrief(tc: ToolCallSpec, state: KernelState, ctx: PhaseContext): Effect.Effect<MetaToolResult, never> {
  return Effect.gen(function* () {
    const liveStore = yield* Ref.get(scratchpadStoreRef);
    const recallKeys = [...liveStore.keys()];
    const briefInput: BriefInput = {
      task: ctx.input.task,
      iteration: state.iteration,
      toolsUsed: [...state.toolsUsed],
      recallKeys,
      steps: state.steps as any,
      requiredTools: ctx.input.requiredTools ?? [],
    };
    return { content: buildBriefResponse(briefInput), success: true };
  });
}

function handlePulse(tc: ToolCallSpec, state: KernelState, ctx: PhaseContext): Effect.Effect<MetaToolResult, never> {
  return Effect.gen(function* () {
    const pulseInput: PulseInput = {
      iteration: state.iteration,
      maxIterations: (state.meta.maxIterations as number) ?? 10,
      entropy: (state.meta.entropy as any) ?? null,
      controllerDecisions: state.controllerDecisionLog,
      toolsUsed: [...state.toolsUsed],
      requiredTools: ctx.input.requiredTools ?? [],
    };
    return { content: JSON.stringify(buildPulseResponse(pulseInput), null, 2), success: true };
  });
}

function handleRecall(tc: ToolCallSpec, state: KernelState, _ctx: PhaseContext): Effect.Effect<MetaToolResult, never> {
  return Effect.gen(function* () {
    const handler = makeRecallHandler(state.scratchpad as Map<string, string>);
    const result = yield* handler(tc.arguments as any);
    return { content: typeof result === "string" ? result : JSON.stringify(result), success: true };
  });
}

function handleFind(tc: ToolCallSpec, state: KernelState, ctx: PhaseContext): Effect.Effect<MetaToolResult, never> {
  return Effect.gen(function* () {
    const handler = makeFindHandler({ agentId: ctx.input.agentId ?? "agent", sessionId: ctx.input.sessionId ?? "session" });
    const result = yield* handler(tc.arguments as any);
    return { content: typeof result === "string" ? result : JSON.stringify(result), success: true };
  });
}

// ─── Acting Phase Entry Point ─────────────────────────────────────────────────

export function handleActing(
  state: KernelState,
  ctx: PhaseContext,
): Effect.Effect<KernelState, never, LLMService> {
  return Effect.gen(function* () {
    // Full body extracted from react-kernel.ts handleActing (lines ~1093-1595)
    // Closed-over variables replaced:
    //   input   → ctx.input
    //   profile → ctx.profile
    //   hooks   → ctx.hooks
    //
    // The four inline meta-tool if/else blocks (brief, pulse, recall, find)
    // are replaced with:
    //   const handler = metaToolRegistry.get(tc.name);
    //   if (handler) {
    //     const { content, success } = yield* handler(tc, state, ctx);
    //     // ... build steps, call hooks (same as before)
    //     continue;
    //   }
    //
    // The four inline guard blocks are replaced with checkToolCall(defaultGuards)
    // (already done in Task 4).
  });
}
```

> **Implementation note:** Copy the full `handleActing` body from `react-kernel.ts` lines 1093–1595 verbatim. Replace closed-over `input`/`profile`/`hooks` with `ctx.input`/`ctx.profile`/`ctx.hooks`. Replace the four `if (tc.name === "brief")` etc. blocks with `const handler = metaToolRegistry.get(tc.name); if (handler) { ... }`.

- [ ] **Step 2: Update `react-kernel.ts` to import `handleActing`**

```typescript
import { handleActing } from "./phases/act.js";
```

Remove the inline `handleActing` definition.

- [ ] **Step 3: Run the full test suite**

```bash
bun test packages/reasoning --timeout 15000
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/phases/act.ts \
        packages/reasoning/src/strategies/kernel/react-kernel.ts
git commit -m "refactor(reasoning): extract act phase to phases/act.ts — MetaToolHandler registry, final-answer gate, tool dispatch"
```

---

## Task 8: Slim `react-kernel.ts` — Add `makeKernel()` and Absorb `output-assembly.ts`

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/react-kernel.ts`
- Delete: `packages/reasoning/src/strategies/kernel/output-assembly.ts` (absorbed)

- [ ] **Step 1: Inline `output-assembly.ts` into `react-kernel.ts`**

Read `packages/reasoning/src/strategies/kernel/output-assembly.ts` (83 lines) and move its exported functions directly into `react-kernel.ts`. Remove the import line that references `output-assembly.js`.

- [ ] **Step 2: Add `makeKernel()` factory to `react-kernel.ts`**

The `reactKernel` function currently directly calls `handleThinking` and `handleActing`. Introduce `makeKernel` so custom kernels can substitute phases:

```typescript
import type { Phase } from "./kernel-state.js";
import { handleThinking } from "./phases/think.js";
import { handleActing } from "./phases/act.js";

/**
 * Creates a ReAct kernel from a phase pipeline.
 *
 * The default pipeline is [think, act]. Strategies and custom kernels
 * can substitute individual phases:
 *
 * @example
 * // Standard kernel
 * const kernel = makeKernel();
 *
 * // Custom kernel with a different thinking strategy
 * const kernel = makeKernel({ phases: [myThink, act] });
 *
 * // Test kernel with a mock think phase
 * const kernel = makeKernel({ phases: [mockThink, act] });
 */
export function makeKernel(options?: { phases?: Phase[] }): ThoughtKernel {
  const [thinkPhase, actPhase] = options?.phases ?? [handleThinking, handleActing];

  return (state: KernelState, context: KernelContext): Effect.Effect<KernelState, never, LLMService> =>
    Effect.gen(function* () {
      const profile = resolveProfile(state, context);
      const hooks = context.hooks ?? noopHooks;
      const ctx: PhaseContext = { input: context.input as ReActKernelInput, profile, hooks };

      if (state.status === "thinking" || state.status === "evaluating") {
        return yield* thinkPhase(state, ctx);
      }
      if (state.status === "acting") {
        return yield* actPhase(state, ctx);
      }
      return state;
    });
}

/** The standard ReAct kernel using the default phase pipeline. */
export const reactKernel: ThoughtKernel = makeKernel();
```

- [ ] **Step 3: Verify `react-kernel.ts` is now ~150 lines**

```bash
wc -l packages/reasoning/src/strategies/kernel/react-kernel.ts
```

Expected: under 200 lines.

- [ ] **Step 4: Delete `output-assembly.ts` (now inlined)**

```bash
git rm packages/reasoning/src/strategies/kernel/output-assembly.ts
```

Also update/remove the corresponding test `packages/reasoning/tests/strategies/kernel/output-assembly.test.ts` — its assertions should still pass through `react-kernel.ts`. If the test imports `output-assembly.ts` directly, update it to import from `react-kernel.ts` instead.

- [ ] **Step 5: Run the full test suite**

```bash
bun test packages/reasoning --timeout 15000
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/react-kernel.ts
git rm packages/reasoning/src/strategies/kernel/output-assembly.ts
git commit -m "refactor(reasoning): slim react-kernel.ts to ~150 lines — add makeKernel() pipeline factory, absorb output-assembly"
```

---

## Task 9: Extract `utils/ics-coordinator.ts` from `kernel-runner.ts`

**Files:**
- Create: `packages/reasoning/src/strategies/kernel/utils/ics-coordinator.ts`
- Modify: `packages/reasoning/src/strategies/kernel/kernel-runner.ts`

- [ ] **Step 1: Identify the ICS block in `kernel-runner.ts`**

```bash
grep -n "ContextSynthesizerService\|synthesizedContext\|coordinat" \
  packages/reasoning/src/strategies/kernel/kernel-runner.ts
```

Note the line range of the ICS coordination block (approximately 150 lines dealing with `ContextSynthesizerService`, `classifyTaskPhase`, and setting `state.synthesizedContext`).

- [ ] **Step 2: Create `packages/reasoning/src/strategies/kernel/utils/ics-coordinator.ts`**

```typescript
/**
 * ICS Coordinator — prepares synthesized context between kernel iterations.
 *
 * Calls ContextSynthesizerService when enabled, classifies the current task phase,
 * and sets state.synthesizedContext for the next think phase to consume.
 *
 * Extracted from kernel-runner.ts to keep the loop logic focused.
 */
import { Effect, Option } from "effect";
import { ContextSynthesizerService } from "../../../context/context-synthesizer.js";
import { classifyTaskPhase } from "../../../context/task-phase.js";
import { transitionState, type KernelState } from "../kernel-state.js";

/**
 * Runs ICS synthesis after an acting phase when the service is available.
 * Returns the same state if ICS is not configured or the service is absent.
 */
export function coordinateICS(
  state: KernelState,
  agentId: string,
  sessionId: string,
): Effect.Effect<KernelState, never> {
  return Effect.gen(function* () {
    // Extract the ICS coordination block from kernel-runner.ts verbatim.
    // The block reads ContextSynthesizerService via Effect.serviceOption,
    // calls synthesize() when present, and sets state.synthesizedContext.
    const synthService = yield* Effect.serviceOption(ContextSynthesizerService);
    if (Option.isNone(synthService)) return state;

    // ... (extracted implementation)
    return state;
  });
}
```

> **Implementation note:** Copy the full ICS coordination block from `kernel-runner.ts` into `coordinateICS`. The function takes `(state, agentId, sessionId)` and returns `Effect<KernelState, never>` (no required services in R — access `ContextSynthesizerService` via `Effect.serviceOption`).

- [ ] **Step 3: Update `kernel-runner.ts` to use the extracted coordinator**

```typescript
import { coordinateICS } from "./utils/ics-coordinator.js";
```

Replace the inline ICS block with `yield* coordinateICS(state, agentId, sessionId)`.

- [ ] **Step 4: Verify `kernel-runner.ts` line count**

```bash
wc -l packages/reasoning/src/strategies/kernel/kernel-runner.ts
```

Expected: under 350 lines (down from 612).

- [ ] **Step 5: Run tests**

```bash
bun test packages/reasoning --timeout 15000
```

Expected: all green, including ICS-related tests in `context-synthesizer.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/utils/ics-coordinator.ts \
        packages/reasoning/src/strategies/kernel/kernel-runner.ts
git commit -m "refactor(reasoning): extract ICS coordination to utils/ics-coordinator.ts — kernel-runner.ts 612→~350 lines"
```

---

## Task 10: Final Cleanup — Type Safety Pass, Docs Update, Full Verification

**Files:**
- Modify: `AGENTS.md` — update debugging entry points
- Modify: `packages/reasoning/src/strategies/kernel/kernel-state.ts` — remove any remaining `as any` that can be typed
- Run: full build + typecheck + test suite

- [ ] **Step 1: Update `AGENTS.md` debugging entry points**

Find and replace `strategies/shared` → `strategies/kernel` in `AGENTS.md`:

```bash
sed -i 's|strategies/shared/|strategies/kernel/|g' AGENTS.md
sed -i 's|shared/kernel-runner|kernel/kernel-runner|g' AGENTS.md
sed -i 's|shared/react-kernel|kernel/react-kernel|g' AGENTS.md
```

Verify:
```bash
grep -n "strategies/shared" AGENTS.md
```

Expected: no output.

- [ ] **Step 2: Type safety pass — scan for new `as any` introduced during extraction**

```bash
grep -n "as any" packages/reasoning/src/strategies/kernel/phases/*.ts \
  packages/reasoning/src/strategies/kernel/utils/ics-coordinator.ts
```

For each `as any` found: determine if a proper type is available. The `metadata` access pattern on `ReasoningStep` (e.g. `step.metadata?.toolCall as { name: string }`) is pre-existing and acceptable per `CODING_STANDARDS.md` (accessing untyped meta bags). Do not introduce new ones.

- [ ] **Step 3: Verify final directory structure matches the spec**

```bash
find packages/reasoning/src/strategies/kernel -type f | sort
```

Expected output:
```
packages/reasoning/src/strategies/kernel/kernel-hooks.ts
packages/reasoning/src/strategies/kernel/kernel-runner.ts
packages/reasoning/src/strategies/kernel/kernel-state.ts
packages/reasoning/src/strategies/kernel/react-kernel.ts
packages/reasoning/src/strategies/kernel/phases/act.ts
packages/reasoning/src/strategies/kernel/phases/context-builder.ts
packages/reasoning/src/strategies/kernel/phases/guard.ts
packages/reasoning/src/strategies/kernel/phases/think.ts
packages/reasoning/src/strategies/kernel/utils/context-utils.ts
packages/reasoning/src/strategies/kernel/utils/ics-coordinator.ts
packages/reasoning/src/strategies/kernel/utils/quality-utils.ts
packages/reasoning/src/strategies/kernel/utils/service-utils.ts
packages/reasoning/src/strategies/kernel/utils/step-utils.ts
packages/reasoning/src/strategies/kernel/utils/stream-parser.ts
packages/reasoning/src/strategies/kernel/utils/strategy-evaluator.ts
packages/reasoning/src/strategies/kernel/utils/termination-oracle.ts
packages/reasoning/src/strategies/kernel/utils/tool-execution.ts
packages/reasoning/src/strategies/kernel/utils/tool-utils.ts
```

- [ ] **Step 4: TypeScript workspace typecheck**

```bash
bun run typecheck 2>&1 | head -50
```

Expected: zero errors.

- [ ] **Step 5: Full test suite**

```bash
bun test --timeout 15000
```

Expected: same pass count as before refactor (3,036 tests, 350 files, 0 failing).

- [ ] **Step 6: Build all packages**

```bash
bun run build 2>&1 | tail -20
```

Expected: clean build, no errors.

- [ ] **Step 7: Final commit**

```bash
git add AGENTS.md
git commit -m "refactor(reasoning): final cleanup — update AGENTS.md debugging paths, type safety pass"
```

---

## Verification Checklist

Before declaring complete:

- [ ] `wc -l packages/reasoning/src/strategies/kernel/react-kernel.ts` → under 200
- [ ] `wc -l packages/reasoning/src/strategies/kernel/kernel-runner.ts` → under 350
- [ ] `wc -l packages/reasoning/src/strategies/kernel/phases/*.ts` → each under 500
- [ ] `grep -r "strategies/shared" packages/reasoning/` → zero results
- [ ] `bun run typecheck` → zero errors
- [ ] `bun test --timeout 15000` → 0 failing, same total count as before
- [ ] `bun run build` → clean
- [ ] `find packages/reasoning/src/strategies/kernel -name "*.ts" | sort` → matches expected structure above
