# Intelligent Context Synthesis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **CRITICAL — READ FIRST:**
> - Read `CODING_STANDARDS.md` before writing any code. Effect-TS patterns are mandatory.
> - Read `AGENTS.md` for architecture overview and dependency tree.
> - No `@ts-ignore`. No raw `throw`. No `await`. All effects via `Effect.Effect<A, E>`.
> - All data shapes use `Schema.Struct`. All services use `Context.Tag` + `Layer.effect`.
> - All fields `readonly`. Mutable state only through `Ref`.
> - Tests use `bun:test`. Run `bun test packages/reasoning/tests` after each task.
> - Read existing files before editing. Follow patterns you find.

**Goal:** Replace raw conversation thread delivery to the LLM with phase-aware, signal-driven context synthesis — making agents more reliable across all model tiers, especially local models.

**Architecture:** `state.messages[]` becomes an immutable transcript (never sent raw to the LLM). A new `ContextSynthesizerService` constructs a `SynthesizedContext` per iteration from transcript + framework signals, using a fast deterministic path or an LLM-assisted deep path based on entropy signals. `KernelState` gains a single-use `synthesizedContext?` field consumed by `handleThinking`. The synthesized context is always published to the EventBus for full observability.

**Tech Stack:** Effect-TS (Context.Tag, Layer.effect, Schema.Struct, Effect.gen), bun:test, existing KernelState/KernelHooks/EventBus patterns, `@reactive-agents/reasoning` package.

**Spec:** `docs/superpowers/specs/2026-03-28-intelligent-context-synthesis-design.md`

---

## File Map

### New files
| File | Responsibility |
|------|---------------|
| `packages/reasoning/src/context/task-phase.ts` | `TaskPhase` type + `classifyTaskPhase()` pure function |
| `packages/reasoning/src/context/synthesis-templates.ts` | `fastSynthesis()` + phase×tier template functions, exported |
| `packages/reasoning/src/context/context-synthesizer.ts` | `ContextSynthesizerService` tag + `ContextSynthesizerLive` + `deepSynthesis()` + types |
| `packages/reasoning/tests/context/task-phase.test.ts` | Tests for `classifyTaskPhase()` |
| `packages/reasoning/tests/context/synthesis-templates.test.ts` | Tests for `fastSynthesis()` per phase |
| `packages/reasoning/tests/context/context-synthesizer.test.ts` | Tests for the service |

### Modified files
| File | Change |
|------|--------|
| `packages/core/src/services/event-bus.ts` | Add `ContextSynthesized` variant to `AgentEvent` union |
| `packages/reasoning/src/strategies/shared/kernel-state.ts` | Add `synthesizedContext?` to `KernelState`, `synthesisConfig?` to `KernelInput` |
| `packages/reasoning/src/strategies/shared/kernel-hooks.ts` | Add `onContextSynthesized` hook to `KernelHooks` interface + `noopHooks` |
| `packages/reasoning/src/strategies/shared/kernel-runner.ts` | Inject synthesis after acting, before next thinking |
| `packages/reasoning/src/strategies/shared/react-kernel.ts` | `handleThinking`: consume `synthesizedContext` instead of `applyMessageWindow` |
| `packages/reasoning/src/index.ts` | Export new public types and functions |
| `packages/runtime/src/builder.ts` | Add `synthesis`, `synthesisModel`, `synthesisProvider`, `synthesisStrategy` to `ReasoningOptions` |
| `packages/runtime/src/runtime.ts` | Thread `synthesisConfig` into kernel options; add `ContextSynthesizerLive` to reasoning layer |

---

## Task 1: TaskPhase type + classifyTaskPhase()

**Files:**
- Create: `packages/reasoning/src/context/task-phase.ts`
- Create: `packages/reasoning/tests/context/task-phase.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/reasoning/tests/context/task-phase.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { classifyTaskPhase } from "../../src/context/task-phase.js";

describe("classifyTaskPhase", () => {
  it("returns 'orient' on iteration 0 with no tools used", () => {
    expect(classifyTaskPhase({
      iteration: 0,
      toolsUsed: new Set(),
      requiredTools: ["web-search", "file-write"],
      steps: [],
    })).toBe("orient");
  });

  it("returns 'orient' on iteration 1 with no tools used", () => {
    expect(classifyTaskPhase({
      iteration: 1,
      toolsUsed: new Set(),
      requiredTools: ["web-search"],
      steps: [],
    })).toBe("orient");
  });

  it("returns 'gather' when required tools remain and no write yet", () => {
    expect(classifyTaskPhase({
      iteration: 2,
      toolsUsed: new Set(["web-search"]),
      requiredTools: ["web-search", "file-write"],
      steps: [],
    })).toBe("gather");
  });

  it("returns 'synthesize' when all required tools called but no output written", () => {
    expect(classifyTaskPhase({
      iteration: 3,
      toolsUsed: new Set(["web-search", "file-write"]),
      requiredTools: ["web-search", "file-write"],
      steps: [],
    })).toBe("synthesize");
  });

  it("returns 'verify' when output has been written", () => {
    const stepsWithWrite: any[] = [{
      type: "observation",
      content: "✓ Written to ./report.md",
      metadata: {
        observationResult: { success: true },
        toolCall: { name: "file-write" },
      },
    }];
    expect(classifyTaskPhase({
      iteration: 4,
      toolsUsed: new Set(["web-search", "file-write"]),
      requiredTools: ["web-search", "file-write"],
      steps: stepsWithWrite,
    })).toBe("verify");
  });

  it("returns 'produce' when no required tools and no write", () => {
    expect(classifyTaskPhase({
      iteration: 2,
      toolsUsed: new Set(["web-search"]),
      requiredTools: [],
      steps: [],
    })).toBe("produce");
  });

  it("returns 'gather' when iteration > 1 but tools not started yet with requireds", () => {
    expect(classifyTaskPhase({
      iteration: 3,
      toolsUsed: new Set(),
      requiredTools: ["web-search"],
      steps: [],
    })).toBe("gather");
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
bun test packages/reasoning/tests/context/task-phase.test.ts
```
Expected: `Error: Cannot find module '../../src/context/task-phase.js'`

- [ ] **Step 3: Create task-phase.ts**

Create `packages/reasoning/src/context/task-phase.ts`:

```typescript
import type { ReasoningStep } from "../types/index.js";

// ─── TaskPhase ───────────────────────────────────────────────────────────────

/**
 * The current phase of a task execution.
 * Classified deterministically from kernel signals — no LLM call required.
 * Drives which synthesis template is applied by the ContextSynthesizer.
 */
export type TaskPhase =
  | "orient"     // iteration 0-1, no tools used — introduce task and available tools
  | "gather"     // tools in use, required tools still outstanding — focus on next tool
  | "synthesize" // all required tools called, output not yet produced — synthesize data
  | "produce"    // actively generating output (no required tools) — support production
  | "verify";    // output has been written — confirm completeness

// ─── classifyTaskPhase ───────────────────────────────────────────────────────

/**
 * Classify the current task phase from kernel signals.
 * Pure function — deterministic, no side effects.
 *
 * @param signals - Current iteration, tools used, required tools, and step history
 * @returns The classified TaskPhase
 */
export function classifyTaskPhase(signals: {
  readonly iteration: number;
  readonly toolsUsed: ReadonlySet<string>;
  readonly requiredTools: readonly string[];
  readonly steps: readonly ReasoningStep[];
}): TaskPhase {
  const { iteration, toolsUsed, requiredTools, steps } = signals;

  const missingRequired = requiredTools.filter((t) => !toolsUsed.has(t));

  const hasWrittenOutput = steps.some(
    (s) =>
      s.type === "observation" &&
      s.metadata?.observationResult?.success === true &&
      (
        (s.metadata?.toolCall as { name?: string } | undefined)?.name?.includes("write") ||
        (s.metadata?.toolCall as { name?: string } | undefined)?.name?.includes("file")
      ),
  );

  if (iteration <= 1 && toolsUsed.size === 0) return "orient";
  if (hasWrittenOutput) return "verify";
  if (missingRequired.length > 0) return "gather";
  if (requiredTools.length > 0 && missingRequired.length === 0) return "synthesize";
  return "produce";
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/reasoning/tests/context/task-phase.test.ts
```
Expected: 7 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/context/task-phase.ts packages/reasoning/tests/context/task-phase.test.ts
git commit -m "feat(reasoning): add TaskPhase type and classifyTaskPhase() pure function"
```

---

## Task 2: SynthesisInput / SynthesizedContext / SynthesisConfig types

**Files:**
- Create: `packages/reasoning/src/context/context-synthesizer.ts` (types only, service added in Task 5)

- [ ] **Step 1: Create the types file with types only**

Create `packages/reasoning/src/context/context-synthesizer.ts`:

```typescript
import { Context, Effect } from "effect";
import type { LLMMessage } from "@reactive-agents/llm-provider";
import type { LLMService } from "@reactive-agents/llm-provider";
import type { ToolSchema } from "../strategies/shared/tool-utils.js";
import type { KernelMessage } from "../strategies/shared/kernel-state.js";
import type { EntropyScore } from "../../reactive-intelligence/sensor/composite.js";
import type { ModelTier } from "../context/context-profile.js";
import type { TaskPhase } from "./task-phase.js";

// ─── SynthesisStrategy ───────────────────────────────────────────────────────

/**
 * A synthesis strategy function — the primary extension point for ICS.
 * Takes all framework signals and returns the exact messages the model will receive.
 * When provided via SynthesisConfig.synthesisStrategy, completely replaces built-in logic.
 */
export type SynthesisStrategy = (
  input: SynthesisInput,
) => Effect.Effect<readonly LLMMessage[], never, LLMService>;

// ─── SynthesisConfig ─────────────────────────────────────────────────────────

/**
 * Configuration for context synthesis behavior.
 * Configured via .withReasoning({ synthesis: "auto" }).
 * Resolution order: strategy-level → builder-level → framework default ("auto").
 */
export interface SynthesisConfig {
  /** Synthesis mode:
   * - "auto": fast path by default, escalates to deep when signals justify it (default)
   * - "fast": deterministic templates only, zero latency overhead
   * - "deep": always LLM-assisted synthesis
   * - "custom": user-provided synthesisStrategy function
   * - "off": disable synthesis entirely, use raw applyMessageWindow
   */
  readonly mode: "auto" | "fast" | "deep" | "custom" | "off";
  /** Alternative model for deep synthesis. Defaults to the executing model. */
  readonly model?: string;
  /** Alternative provider for deep synthesis. */
  readonly provider?: string;
  /** Temperature for deep synthesis LLM call. Default: 0.0 (deterministic) */
  readonly temperature?: number;
  /** Custom synthesis strategy function. Required when mode is "custom". */
  readonly synthesisStrategy?: SynthesisStrategy;
}

// ─── SynthesisSignalsSnapshot ────────────────────────────────────────────────

/** Snapshot of signals used for synthesis — included in EventBus event for observability */
export interface SynthesisSignalsSnapshot {
  readonly entropy: number | undefined;
  readonly trajectoryShape: string | undefined;
  readonly tier: ModelTier;
  readonly requiredTools: readonly string[];
  readonly toolsUsed: readonly string[];
  readonly iteration: number;
  readonly lastErrors: readonly string[];
}

// ─── SynthesisInput ──────────────────────────────────────────────────────────

/** All inputs required to synthesize context for the next LLM call */
export interface SynthesisInput {
  /** The full immutable transcript — source material, never sent raw to the model */
  readonly transcript: readonly KernelMessage[];
  /** Original task description */
  readonly task: string;
  /** Current task phase, classified from signals */
  readonly taskPhase: TaskPhase;
  /** Tools that must be called before task completion */
  readonly requiredTools: readonly string[];
  /** Tools called so far this run */
  readonly toolsUsed: ReadonlySet<string>;
  /** Available tool schemas */
  readonly availableTools: readonly ToolSchema[];
  /** Current entropy score from the reactive intelligence sensor */
  readonly entropy: EntropyScore | undefined;
  /** Current kernel iteration (0-indexed) */
  readonly iteration: number;
  /** Maximum allowed iterations */
  readonly maxIterations: number;
  /** Error messages from failed tool calls this run */
  readonly lastErrors: readonly string[];
  /** Model tier for budget and template adaptation */
  readonly tier: ModelTier;
  /** Available token budget for synthesized context */
  readonly tokenBudget: number;
  /** Synthesis configuration */
  readonly synthesisConfig: SynthesisConfig;
}

// ─── SynthesizedContext ──────────────────────────────────────────────────────

/** The output of context synthesis — what the model will actually receive */
export interface SynthesizedContext {
  /** The messages array sent to the LLM — optimized for this specific iteration */
  readonly messages: readonly LLMMessage[];
  /** Which synthesis path was used */
  readonly synthesisPath: "fast" | "deep" | "custom";
  /** Human-readable reason for synthesis path choice */
  readonly synthesisReason: string;
  /** Task phase at time of synthesis */
  readonly taskPhase: TaskPhase;
  /** Estimated token count of synthesized messages */
  readonly estimatedTokens: number;
  /** Signals snapshot for EventBus observability */
  readonly signalsSnapshot: SynthesisSignalsSnapshot;
}

// ─── ContextSynthesizerService ───────────────────────────────────────────────

/**
 * Service that synthesizes optimal LLM context from kernel signals.
 * Auto-loaded when .withReasoning() is called.
 * Override with your own implementation via Effect-TS service substitution.
 */
export class ContextSynthesizerService extends Context.Tag("ContextSynthesizer")<
  ContextSynthesizerService,
  {
    /**
     * Synthesize optimal context for the next LLM call.
     * Runs after handleActing completes, before handleThinking begins.
     *
     * @param input - All kernel signals needed for synthesis
     * @returns SynthesizedContext containing optimized messages for the LLM
     */
    readonly synthesize: (
      input: SynthesisInput,
    ) => Effect.Effect<SynthesizedContext, never, LLMService>;
  }
>() {}
```

- [ ] **Step 2: Run existing tests to confirm no breakage**

```bash
bun test packages/reasoning/tests
```
Expected: all pass (types-only file, no runtime change)

- [ ] **Step 3: Commit**

```bash
git add packages/reasoning/src/context/context-synthesizer.ts
git commit -m "feat(reasoning): add ICS types — SynthesisInput, SynthesizedContext, SynthesisConfig, ContextSynthesizerService tag"
```

---

## Task 3: Add ContextSynthesized to AgentEvent

**Files:**
- Modify: `packages/core/src/services/event-bus.ts`
- Test: `packages/core/tests/event-bus.test.ts` (if it exists, check first)

- [ ] **Step 1: Find the AgentEvent union in event-bus.ts**

```bash
grep -n "_tag.*Agent\|export type AgentEvent" packages/core/src/services/event-bus.ts | head -5
```

Look for the last event in the union. Add `ContextSynthesized` before the closing `;` of the `AgentEvent` type:

- [ ] **Step 2: Add ContextSynthesized event variant**

In `packages/core/src/services/event-bus.ts`, import `LLMMessage` from llm-provider and add to the `AgentEvent` union. Find the end of the union (last `| { readonly _tag: "..."... }`) and add:

```typescript
  | {
      /**
       * Published before each LLM call when context synthesis is active.
       * Contains the exact messages the model received — enables full synthesis observability.
       */
      readonly _tag: "ContextSynthesized";
      readonly taskId: string;
      readonly agentId: string;
      readonly iteration: number;
      readonly synthesisPath: "fast" | "deep" | "custom";
      readonly synthesisReason: string;
      readonly taskPhase: string;
      readonly estimatedTokens: number;
      readonly messages: readonly {
        readonly role: string;
        readonly content: string | null;
      }[];
      readonly signalsSnapshot: {
        readonly entropy: number | undefined;
        readonly trajectoryShape: string | undefined;
        readonly tier: string;
        readonly requiredTools: readonly string[];
        readonly toolsUsed: readonly string[];
        readonly iteration: number;
        readonly lastErrors: readonly string[];
      };
    }
```

Note: use `readonly { role: string; content: string | null }[]` to avoid importing LLMMessage into core (core must not depend on llm-provider per the dependency tree in AGENTS.md).

- [ ] **Step 3: Run core tests**

```bash
bun test packages/core/tests
```
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/services/event-bus.ts
git commit -m "feat(core): add ContextSynthesized to AgentEvent union for ICS observability"
```

---

## Task 4: Add synthesizedContext and synthesisConfig to kernel types

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/kernel-state.ts`
- Modify: `packages/reasoning/src/strategies/shared/kernel-hooks.ts`

- [ ] **Step 1: Add synthesizedContext to KernelState**

In `packages/reasoning/src/strategies/shared/kernel-state.ts`, after the `messages` field (around line 67), add:

```typescript
  /**
   * Synthesized context for the next handleThinking call.
   * Set by kernel-runner after handleActing completes.
   * Consumed and cleared (set to null) by handleThinking — never accumulated.
   * undefined before first synthesis; null after being consumed.
   */
  readonly synthesizedContext?: import("../../context/context-synthesizer.js").SynthesizedContext | null;
```

- [ ] **Step 2: Add synthesisConfig to KernelInput**

In the same file, after `initialMessages` in `KernelInput` (around line 106), add:

```typescript
  /**
   * Context synthesis configuration.
   * Threaded from .withReasoning({ synthesis: ... }) through the kernel.
   * Defaults to { mode: "auto" } when not provided.
   */
  readonly synthesisConfig?: import("../../context/context-synthesizer.js").SynthesisConfig;
```

- [ ] **Step 3: Update initialKernelState to include synthesizedContext**

Find `initialKernelState` function and ensure it includes `synthesizedContext: undefined` in the returned object:

```typescript
// Add to the initialKernelState return:
synthesizedContext: undefined,
```

- [ ] **Step 4: Add onContextSynthesized to KernelHooks**

In `packages/reasoning/src/strategies/shared/kernel-hooks.ts`, in the `KernelHooks` interface after `onIterationProgress`, add:

```typescript
  /**
   * Called after synthesis completes, before the LLM call.
   * Publishes the synthesized context to the EventBus for full observability.
   */
  readonly onContextSynthesized?: (
    synthesized: import("../../context/context-synthesizer.js").SynthesizedContext,
    taskId: string,
    agentId: string,
  ) => Effect.Effect<void, never>;
```

Also add the no-op to `noopHooks`:

```typescript
onContextSynthesized: () => Effect.void,
```

- [ ] **Step 5: Update buildKernelHooks to wire the EventBus hook**

In `packages/reasoning/src/strategies/shared/kernel-hooks.ts`, in `buildKernelHooks()`, add the `onContextSynthesized` implementation after existing hooks:

```typescript
onContextSynthesized: (synthesized, taskId, agentId) =>
  eventBus._tag === "Some"
    ? eventBus.value.publish({
        _tag: "ContextSynthesized",
        taskId,
        agentId,
        iteration: synthesized.taskPhase === synthesized.taskPhase ? synthesized.signalsSnapshot.iteration : 0,
        synthesisPath: synthesized.synthesisPath,
        synthesisReason: synthesized.synthesisReason,
        taskPhase: synthesized.taskPhase,
        estimatedTokens: synthesized.estimatedTokens,
        messages: synthesized.messages.map((m) => ({
          role: (m as any).role as string,
          content: typeof (m as any).content === "string" ? (m as any).content : null,
        })),
        signalsSnapshot: synthesized.signalsSnapshot,
      }).pipe(Effect.catchAll(() => Effect.void))
    : Effect.void,
```

- [ ] **Step 6: Run tests**

```bash
bun test packages/reasoning/tests
```
Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add packages/reasoning/src/strategies/shared/kernel-state.ts packages/reasoning/src/strategies/shared/kernel-hooks.ts
git commit -m "feat(reasoning): add synthesizedContext/synthesisConfig to KernelState/KernelInput, onContextSynthesized hook"
```

---

## Task 5: Fast path synthesis templates

**Files:**
- Create: `packages/reasoning/src/context/synthesis-templates.ts`
- Create: `packages/reasoning/tests/context/synthesis-templates.test.ts`

- [ ] **Step 1: Write tests for the fast path**

Create `packages/reasoning/tests/context/synthesis-templates.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { fastSynthesis } from "../../src/context/synthesis-templates.js";
import type { SynthesisInput } from "../../src/context/context-synthesizer.js";

const baseMid: SynthesisInput = {
  transcript: [
    { role: "user", content: "Research AI trends and write to ./report.md" },
  ],
  task: "Research AI trends and write to ./report.md",
  taskPhase: "gather",
  requiredTools: ["web-search", "file-write"],
  toolsUsed: new Set(["web-search"]),
  availableTools: [],
  entropy: undefined,
  iteration: 2,
  maxIterations: 10,
  lastErrors: [],
  tier: "mid",
  tokenBudget: 3000,
  synthesisConfig: { mode: "fast" },
};

describe("fastSynthesis", () => {
  it("returns an array of LLMMessages", async () => {
    const messages = await Effect.runPromise(fastSynthesis(baseMid) as any);
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBeGreaterThan(0);
  });

  it("always includes the task as the first user message", async () => {
    const messages: any[] = await Effect.runPromise(fastSynthesis(baseMid) as any);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toContain("Research AI trends");
  });

  it("gather phase includes a situation status message directing next action", async () => {
    const messages: any[] = await Effect.runPromise(fastSynthesis(baseMid) as any);
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg.role).toBe("user");
    expect(lastMsg.content).toContain("file-write");
  });

  it("gather phase with errors mentions the failure", async () => {
    const withError: SynthesisInput = {
      ...baseMid,
      lastErrors: ["http-get: 404 Not Found"],
    };
    const messages: any[] = await Effect.runPromise(fastSynthesis(withError) as any);
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg.content).toContain("404");
  });

  it("orient phase produces minimal context", async () => {
    const orient: SynthesisInput = {
      ...baseMid,
      taskPhase: "orient",
      toolsUsed: new Set(),
      iteration: 0,
    };
    const messages: any[] = await Effect.runPromise(fastSynthesis(orient) as any);
    expect(messages.length).toBeLessThanOrEqual(2);
  });

  it("synthesize phase tells model to synthesize", async () => {
    const synth: SynthesisInput = {
      ...baseMid,
      taskPhase: "synthesize",
      toolsUsed: new Set(["web-search", "file-write"]),
    };
    const messages: any[] = await Effect.runPromise(fastSynthesis(synth) as any);
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg.content.toLowerCase()).toMatch(/synth|compose|write|report/);
  });

  it("returns synthesisPath: fast", async () => {
    // fastSynthesis returns LLMMessage[] not SynthesizedContext — tested separately
    const messages: any[] = await Effect.runPromise(fastSynthesis(baseMid) as any);
    expect(messages).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
bun test packages/reasoning/tests/context/synthesis-templates.test.ts
```
Expected: `Cannot find module '../../src/context/synthesis-templates.js'`

- [ ] **Step 3: Create synthesis-templates.ts**

Create `packages/reasoning/src/context/synthesis-templates.ts`:

```typescript
import { Effect } from "effect";
import type { LLMService, LLMMessage } from "@reactive-agents/llm-provider";
import type { SynthesisInput } from "./context-synthesizer.js";

// ─── Token estimation ────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Last tool result extraction ────────────────────────────────────────────

function extractLastToolResults(
  input: SynthesisInput,
  maxChars: number,
): string {
  const toolResults = input.transcript
    .filter((m) => m.role === "tool_result")
    .slice(-2); // last 2 results

  if (toolResults.length === 0) return "";

  return toolResults
    .map((m) => {
      const name = (m as any).toolName ?? "tool";
      const content = m.content.slice(0, maxChars);
      const truncated = m.content.length > maxChars ? `\n  [... ${m.content.length - maxChars} chars truncated]` : "";
      return `[${name} result]\n${content}${truncated}`;
    })
    .join("\n\n");
}

// ─── Situation status message ────────────────────────────────────────────────

function buildSituationStatus(input: SynthesisInput): string {
  const { requiredTools, toolsUsed, lastErrors, taskPhase, iteration, maxIterations } = input;
  const missingTools = requiredTools.filter((t) => !toolsUsed.has(t));
  const completedRequired = requiredTools.filter((t) => toolsUsed.has(t));
  const urgency = iteration >= maxIterations - 2 ? ` (${maxIterations - iteration} iterations remaining)` : "";

  const lines: string[] = [];

  if (completedRequired.length > 0) {
    lines.push(`Completed: ${completedRequired.map((t) => `${t} ✓`).join(", ")}`);
  }

  if (lastErrors.length > 0) {
    for (const err of lastErrors) {
      lines.push(`Failed: ${err} — skip this, use data from other calls`);
    }
  }

  switch (taskPhase) {
    case "orient":
      lines.push("Start by calling your first required tool to gather information.");
      break;
    case "gather":
      if (missingTools.length > 0) {
        lines.push(`Required next: ${missingTools[0]}${urgency}`);
        lines.push(`Action: Call ${missingTools[0]} now with appropriate arguments.`);
      }
      break;
    case "synthesize":
      lines.push("All required tools have been called.");
      lines.push("Action: Synthesize the gathered data and produce the requested output now.");
      break;
    case "produce":
      lines.push(`Action: Produce the output now${urgency}.`);
      break;
    case "verify":
      lines.push("Output has been written. Verify it meets the task requirements.");
      lines.push("If complete, call final-answer. If not, fix the issues.");
      break;
  }

  return lines.join("\n");
}

// ─── Phase templates ─────────────────────────────────────────────────────────

function buildOrientMessages(input: SynthesisInput): readonly LLMMessage[] {
  const taskMsg: LLMMessage = { role: "user", content: input.task };
  const status = buildSituationStatus(input);
  const statusMsg: LLMMessage = {
    role: "user",
    content: `Phase: orient\n${status}`,
  };
  return [taskMsg, statusMsg];
}

function buildGatherMessages(input: SynthesisInput): readonly LLMMessage[] {
  const resultBudget = input.tier === "local" ? 300 : input.tier === "mid" ? 500 : 800;
  const toolResults = extractLastToolResults(input, resultBudget);
  const status = buildSituationStatus(input);

  const messages: LLMMessage[] = [
    { role: "user", content: input.task },
  ];

  if (toolResults) {
    messages.push({ role: "user", content: toolResults });
  }

  messages.push({ role: "user", content: `Phase: gather\n${status}` });

  return messages;
}

function buildSynthesizeMessages(input: SynthesisInput): readonly LLMMessage[] {
  const resultBudget = input.tier === "local" ? 400 : input.tier === "mid" ? 700 : 1200;
  const allResults = input.transcript
    .filter((m) => m.role === "tool_result")
    .map((m) => {
      const name = (m as any).toolName ?? "tool";
      return `[${name}]\n${m.content.slice(0, resultBudget)}`;
    })
    .join("\n\n");

  const messages: LLMMessage[] = [
    { role: "user", content: input.task },
  ];

  if (allResults) {
    messages.push({
      role: "user",
      content: `Gathered data:\n${allResults}`,
    });
  }

  messages.push({
    role: "user",
    content: `Phase: synthesize\n${buildSituationStatus(input)}`,
  });

  return messages;
}

function buildProduceMessages(input: SynthesisInput): readonly LLMMessage[] {
  const status = buildSituationStatus(input);
  return [
    { role: "user", content: input.task },
    { role: "user", content: `Phase: produce\n${status}` },
  ];
}

function buildVerifyMessages(input: SynthesisInput): readonly LLMMessage[] {
  const lastWrite = [...input.transcript]
    .reverse()
    .find((m) => m.role === "tool_result" && (m as any).toolName?.includes("write"));

  const messages: LLMMessage[] = [
    { role: "user", content: input.task },
  ];

  if (lastWrite) {
    messages.push({
      role: "user",
      content: `Output written:\n${lastWrite.content.slice(0, 400)}`,
    });
  }

  messages.push({
    role: "user",
    content: `Phase: verify\n${buildSituationStatus(input)}`,
  });

  return messages;
}

// ─── fastSynthesis ───────────────────────────────────────────────────────────

/**
 * Fast deterministic synthesis — no LLM call, <1ms.
 * Produces optimized context messages using phase-keyed templates.
 * Exported for user composition: use as a building block in custom strategies.
 *
 * @param input - All synthesis signals
 * @returns Effect resolving to optimized LLMMessage[]
 */
export function fastSynthesis(
  input: SynthesisInput,
): Effect.Effect<readonly LLMMessage[], never, LLMService> {
  return Effect.sync(() => {
    switch (input.taskPhase) {
      case "orient":
        return buildOrientMessages(input);
      case "gather":
        return buildGatherMessages(input);
      case "synthesize":
        return buildSynthesizeMessages(input);
      case "produce":
        return buildProduceMessages(input);
      case "verify":
        return buildVerifyMessages(input);
      default:
        return buildGatherMessages(input);
    }
  });
}
```

- [ ] **Step 4: Run tests**

```bash
bun test packages/reasoning/tests/context/synthesis-templates.test.ts
```
Expected: all pass

- [ ] **Step 5: Run full reasoning tests**

```bash
bun test packages/reasoning/tests
```
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/context/synthesis-templates.ts packages/reasoning/tests/context/synthesis-templates.test.ts
git commit -m "feat(reasoning): add fastSynthesis() with phase×tier templates"
```

---

## Task 6: ContextSynthesizerLive + deepSynthesis()

**Files:**
- Modify: `packages/reasoning/src/context/context-synthesizer.ts` (add Live implementation)
- Create: `packages/reasoning/tests/context/context-synthesizer.test.ts`

- [ ] **Step 1: Write tests for the service**

Create `packages/reasoning/tests/context/context-synthesizer.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { ContextSynthesizerService, ContextSynthesizerLive } from "../../src/context/context-synthesizer.js";
import { LLMService, DEFAULT_CAPABILITIES } from "@reactive-agents/llm-provider";
import type { SynthesisInput } from "../../src/context/context-synthesizer.js";

// Mock LLMService for testing
const mockLLMLayer = Layer.succeed(LLMService, {
  complete: () => Effect.succeed({
    content: JSON.stringify({
      accomplished: "Searched for AI trends",
      failed: "",
      remaining: "Write results to file",
      nextAction: "Call file-write with path='./report.md' and synthesized content",
    }),
    stopReason: "end_turn" as const,
    usage: { inputTokens: 50, outputTokens: 100, totalTokens: 150, estimatedCost: 0 },
    model: "test",
    toolCalls: undefined,
  }),
  stream: () => Effect.fail(new Error("stream not used in synthesis")),
  completeStructured: () => Effect.fail(new Error("not used")),
  embed: () => Effect.fail(new Error("not used")),
  countTokens: () => Effect.succeed(100),
  getModelConfig: () => Effect.succeed({ model: "test", provider: "test", tier: "mid" as const }),
  getStructuredOutputCapabilities: () => Effect.succeed({ jsonMode: false }),
  capabilities: () => Effect.succeed({ ...DEFAULT_CAPABILITIES, supportsToolCalling: false }),
} as any);

const baseInput: SynthesisInput = {
  transcript: [
    { role: "user", content: "Research AI trends and write to ./report.md" },
    {
      role: "assistant",
      content: "I'll search for AI trends.",
      toolCalls: [{ id: "tc1", name: "web-search", arguments: { query: "AI trends" } }],
    },
    { role: "tool_result", toolCallId: "tc1", toolName: "web-search", content: "Results: LangChain, AutoGen..." },
  ],
  task: "Research AI trends and write to ./report.md",
  taskPhase: "gather",
  requiredTools: ["web-search", "file-write"],
  toolsUsed: new Set(["web-search"]),
  availableTools: [],
  entropy: undefined,
  iteration: 2,
  maxIterations: 10,
  lastErrors: [],
  tier: "mid",
  tokenBudget: 3000,
  synthesisConfig: { mode: "auto" },
};

describe("ContextSynthesizerLive", () => {
  it("synthesize with fast path returns messages and metadata", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* ContextSynthesizerService;
      return yield* svc.synthesize({ ...baseInput, synthesisConfig: { mode: "fast" } });
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(ContextSynthesizerLive.pipe(Layer.provide(mockLLMLayer)))),
    );

    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.synthesisPath).toBe("fast");
    expect(result.taskPhase).toBe("gather");
    expect(result.estimatedTokens).toBeGreaterThan(0);
    expect(result.signalsSnapshot.tier).toBe("mid");
    expect(result.signalsSnapshot.requiredTools).toEqual(["web-search", "file-write"]);
  });

  it("synthesize with mode:off falls back to sliding window (returns full transcript)", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* ContextSynthesizerService;
      return yield* svc.synthesize({ ...baseInput, synthesisConfig: { mode: "off" } });
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(ContextSynthesizerLive.pipe(Layer.provide(mockLLMLayer)))),
    );

    expect(result.synthesisPath).toBe("fast"); // off mode still goes through fast (no LLM), signals this via synthesisReason
    expect(result.synthesisReason).toContain("off");
  });

  it("synthesize with deep path calls LLM and enriches status message", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* ContextSynthesizerService;
      return yield* svc.synthesize({ ...baseInput, synthesisConfig: { mode: "deep" } });
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(ContextSynthesizerLive.pipe(Layer.provide(mockLLMLayer)))),
    );

    expect(result.synthesisPath).toBe("deep");
    // Deep path should include the LLM-generated brief
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.content).toBeTruthy();
  });

  it("synthesize with custom strategy calls the provided function", async () => {
    let called = false;
    const customStrategy = (input: SynthesisInput) =>
      Effect.sync(() => {
        called = true;
        return [{ role: "user" as const, content: `Custom: ${input.task}` }];
      });

    const program = Effect.gen(function* () {
      const svc = yield* ContextSynthesizerService;
      return yield* svc.synthesize({
        ...baseInput,
        synthesisConfig: { mode: "custom", synthesisStrategy: customStrategy as any },
      });
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(ContextSynthesizerLive.pipe(Layer.provide(mockLLMLayer)))),
    );

    expect(called).toBe(true);
    expect(result.synthesisPath).toBe("custom");
    expect(result.messages[0].content).toBe(`Custom: ${baseInput.task}`);
  });

  it("local tier with mode:auto falls back to fast even when deep would trigger", async () => {
    const program = Effect.gen(function* () {
      const svc = yield* ContextSynthesizerService;
      return yield* svc.synthesize({
        ...baseInput,
        tier: "local",
        entropy: { composite: 0.8, sources: {} as any, trajectory: { shape: "stalled" } as any, confidence: "low", modelTier: "local", iteration: 5, iterationWeight: 1, timestamp: Date.now() },
        synthesisConfig: { mode: "auto" }, // no synthesisModel configured → fallback to fast
      });
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(ContextSynthesizerLive.pipe(Layer.provide(mockLLMLayer)))),
    );

    expect(result.synthesisPath).toBe("fast");
    expect(result.synthesisReason).toContain("local");
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
bun test packages/reasoning/tests/context/context-synthesizer.test.ts
```
Expected: fails with import errors

- [ ] **Step 3: Add ContextSynthesizerLive and deepSynthesis to context-synthesizer.ts**

Append to `packages/reasoning/src/context/context-synthesizer.ts`:

```typescript
import { Layer, Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { fastSynthesis } from "./synthesis-templates.js";
import { applyMessageWindow } from "./message-window.js";

// ─── Escalation decision ─────────────────────────────────────────────────────

function shouldUseDeepSynthesis(input: SynthesisInput): boolean {
  if (input.synthesisConfig.mode === "fast") return false;
  if (input.synthesisConfig.mode === "deep") return true;
  if (input.synthesisConfig.mode !== "auto") return false;

  // Local tier without a separate synthesis model → always fast
  if (input.tier === "local" && !input.synthesisConfig.model) return false;

  const entropy = input.entropy?.composite ?? 0;
  const trajectory = input.entropy?.trajectory.shape;
  const iterationRatio = input.iteration / Math.max(1, input.maxIterations);
  const missingRequired = input.requiredTools.filter((t) => !input.toolsUsed.has(t));

  return (
    entropy > 0.6 ||
    trajectory === "stalled" ||
    trajectory === "oscillating" ||
    input.lastErrors.length > 0 ||
    (iterationRatio > 0.6 && missingRequired.length > 0)
  );
}

function buildEscalationReason(input: SynthesisInput): string {
  const reasons: string[] = [];
  const entropy = input.entropy?.composite ?? 0;
  const trajectory = input.entropy?.trajectory.shape;

  if (input.tier === "local" && !input.synthesisConfig.model) {
    return `local tier without synthesisModel — using fast path`;
  }
  if (entropy > 0.6) reasons.push(`high entropy (${entropy.toFixed(2)})`);
  if (trajectory === "stalled" || trajectory === "oscillating") reasons.push(`${trajectory} trajectory`);
  if (input.lastErrors.length > 0) reasons.push(`${input.lastErrors.length} tool error(s)`);
  const missingRequired = input.requiredTools.filter((t) => !input.toolsUsed.has(t));
  const iterationRatio = input.iteration / Math.max(1, input.maxIterations);
  if (iterationRatio > 0.6 && missingRequired.length > 0) {
    reasons.push(`late iteration (${input.iteration}/${input.maxIterations}) with missing required tools`);
  }

  return reasons.length > 0 ? reasons.join(" + ") : "mode:deep configured";
}

// ─── Token estimation ────────────────────────────────────────────────────────

function estimateMessagesTokens(messages: readonly LLMMessage[]): number {
  return messages.reduce((sum, m) => {
    const content = typeof (m as any).content === "string" ? (m as any).content as string : "";
    return sum + Math.ceil(content.length / 4) + 4; // +4 for role overhead
  }, 0);
}

// ─── deepSynthesis ───────────────────────────────────────────────────────────

const DEEP_SYNTHESIS_PROMPT = (input: SynthesisInput): string => {
  const missingTools = input.requiredTools.filter((t) => !input.toolsUsed.has(t));
  const completedTools = [...input.toolsUsed].join(", ") || "none";
  const failedStr = input.lastErrors.join(", ") || "none";
  const missingStr = missingTools.join(", ") || "none";

  return `You are a task progress synthesizer. Produce a brief situation summary.

Task: ${input.task}
Completed tools: ${completedTools}
Failed: ${failedStr}
Required but not yet called: ${missingStr}
Iteration: ${input.iteration}/${input.maxIterations}

Respond ONLY with valid JSON (no markdown, no explanation):
{"accomplished":"one sentence","failed":"what failed and why or empty string","remaining":"what still needs to happen","nextAction":"single most important next call with specific arguments"}`;
};

/**
 * Deep LLM-assisted synthesis — makes a bounded structured call (~200 tokens in, ~150 out).
 * Exported for user composition.
 *
 * @param input - All synthesis signals
 * @returns Effect resolving to optimized LLMMessage[]
 */
export function deepSynthesis(
  input: SynthesisInput,
): Effect.Effect<readonly LLMMessage[], never, LLMService> {
  return Effect.gen(function* () {
    const llm = yield* LLMService;

    const synthesisModel = input.synthesisConfig.model;
    const temperature = input.synthesisConfig.temperature ?? 0.0;

    const response = yield* llm.complete({
      messages: [{ role: "user", content: DEEP_SYNTHESIS_PROMPT(input) }],
      maxTokens: 150,
      temperature,
      ...(synthesisModel ? { model: synthesisModel as any } : {}),
    }).pipe(
      Effect.catchAll(() =>
        // If deep synthesis fails, fall back to fast path gracefully
        fastSynthesis(input),
      ),
    );

    // If catchAll fired (response is LLMMessage[]), return directly
    if (Array.isArray(response)) return response;

    const content = (response as any).content as string | null ?? "";

    // Parse JSON brief from LLM response
    let brief: { accomplished?: string; failed?: string; remaining?: string; nextAction?: string } = {};
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) brief = JSON.parse(jsonMatch[0]);
    } catch {
      // JSON parse failed — fall back to fast synthesis
      return yield* fastSynthesis(input);
    }

    // Build messages from the brief
    const messages: LLMMessage[] = [
      { role: "user", content: input.task },
    ];

    const lines: string[] = [];
    if (brief.accomplished) lines.push(`Done: ${brief.accomplished}`);
    if (brief.failed) lines.push(`Failed: ${brief.failed}`);
    if (brief.remaining) lines.push(`Remaining: ${brief.remaining}`);
    if (brief.nextAction) lines.push(`Next action: ${brief.nextAction}`);

    if (lines.length > 0) {
      messages.push({ role: "user", content: lines.join("\n") });
    }

    return messages;
  });
}

// ─── ContextSynthesizerLive ───────────────────────────────────────────────────

/**
 * Default implementation of ContextSynthesizerService.
 * Auto-composed into the reasoning layer when .withReasoning() is called.
 * Uses fast path by default, escalates to deep when signals justify it.
 */
export const ContextSynthesizerLive = Layer.effect(
  ContextSynthesizerService,
  Effect.gen(function* () {
    return {
      synthesize: (input: SynthesisInput): Effect.Effect<SynthesizedContext, never, LLMService> =>
        Effect.gen(function* () {
          const { synthesisConfig } = input;

          // Custom strategy — full control for specialized agents
          if (synthesisConfig.mode === "custom" && synthesisConfig.synthesisStrategy) {
            const messages = yield* synthesisConfig.synthesisStrategy(input);
            return {
              messages,
              synthesisPath: "custom" as const,
              synthesisReason: "custom synthesisStrategy provided",
              taskPhase: input.taskPhase,
              estimatedTokens: estimateMessagesTokens(messages),
              signalsSnapshot: buildSignalsSnapshot(input),
            } satisfies SynthesizedContext;
          }

          // Off mode — return a simple pass-through using the transcript
          if (synthesisConfig.mode === "off") {
            const messages = yield* fastSynthesis(input);
            return {
              messages,
              synthesisPath: "fast" as const,
              synthesisReason: "synthesis:off — using fast path (no LLM call)",
              taskPhase: input.taskPhase,
              estimatedTokens: estimateMessagesTokens(messages),
              signalsSnapshot: buildSignalsSnapshot(input),
            } satisfies SynthesizedContext;
          }

          // Escalation decision for auto/fast/deep
          const useDeep = shouldUseDeepSynthesis(input);
          const reason = useDeep ? buildEscalationReason(input) : buildFastReason(input);

          const messages = useDeep
            ? yield* deepSynthesis(input)
            : yield* fastSynthesis(input);

          return {
            messages,
            synthesisPath: useDeep ? ("deep" as const) : ("fast" as const),
            synthesisReason: reason,
            taskPhase: input.taskPhase,
            estimatedTokens: estimateMessagesTokens(messages),
            signalsSnapshot: buildSignalsSnapshot(input),
          } satisfies SynthesizedContext;
        }),
    };
  }),
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildSignalsSnapshot(input: SynthesisInput): SynthesisSignalsSnapshot {
  return {
    entropy: input.entropy?.composite,
    trajectoryShape: input.entropy?.trajectory.shape,
    tier: input.tier,
    requiredTools: input.requiredTools,
    toolsUsed: [...input.toolsUsed],
    iteration: input.iteration,
    lastErrors: input.lastErrors,
  };
}

function buildFastReason(input: SynthesisInput): string {
  if (input.synthesisConfig.mode === "fast") return "mode:fast — deterministic templates";
  if (input.tier === "local" && !input.synthesisConfig.model) {
    return "local tier without synthesisModel — fast path";
  }
  return "auto — signals within normal range, fast path sufficient";
}
```

- [ ] **Step 4: Run tests**

```bash
bun test packages/reasoning/tests/context/context-synthesizer.test.ts
```
Expected: all pass

- [ ] **Step 5: Run full reasoning suite**

```bash
bun test packages/reasoning/tests
```
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/context/context-synthesizer.ts packages/reasoning/tests/context/context-synthesizer.test.ts
git commit -m "feat(reasoning): add ContextSynthesizerLive + deepSynthesis() with escalation logic"
```

---

## Task 7: Wire synthesis into kernel-runner.ts

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/kernel-runner.ts`

The synthesis injection point is **after `handleActing` returns** and **before the next `handleThinking` is called**. In the existing loop structure, this means after `state = yield* kernel(state, currentContext)` when the resulting status is `"thinking"` (i.e., acting just completed).

- [ ] **Step 1: Add the `getLastErrors` helper and synthesis import**

At the top of `packages/reasoning/src/strategies/shared/kernel-runner.ts`, add imports:

```typescript
import { ContextSynthesizerService } from "../../context/context-synthesizer.js";
import { classifyTaskPhase } from "../../context/task-phase.js";
import type { SynthesisConfig, SynthesisInput } from "../../context/context-synthesizer.js";
```

Add the `getLastErrors` helper function (add near other helper functions):

```typescript
/** Extract error messages from the last N failed observation steps */
function getLastErrors(steps: readonly import("../../types/index.js").ReasoningStep[]): readonly string[] {
  return steps
    .filter(
      (s) =>
        s.type === "observation" &&
        s.metadata?.observationResult?.success === false,
    )
    .slice(-3)
    .map((s) => s.metadata?.observationResult?.displayText ?? s.content.slice(0, 100));
}
```

- [ ] **Step 2: Find the correct injection point**

In the kernel runner main loop (around line 160-200), find the section AFTER `state = yield* kernel(state, currentContext)`. The synthesis should run when the kernel just completed acting (state transitions from "acting" to "thinking"). Look for where `state.status` is checked after the kernel call.

Add the synthesis block AFTER the kernel call returns and entropy scoring, but BEFORE the loop continues:

```typescript
// ── Context Synthesis (after acting, before next thinking) ──────────
// Runs once per iteration when the kernel has just executed tools.
// Constructs optimized context for the next handleThinking call.
const synthesisCfg: SynthesisConfig = (effectiveInput.synthesisConfig as SynthesisConfig | undefined) ?? { mode: "auto" };
if (synthesisCfg.mode !== "off" && state.status === "thinking" && state.iteration > 0) {
  const synthesizerOpt = yield* Effect.serviceOption(ContextSynthesizerService);
  if (synthesizerOpt._tag === "Some") {
    const taskPhase = classifyTaskPhase({
      iteration: state.iteration,
      toolsUsed: state.toolsUsed,
      requiredTools: effectiveInput.requiredTools ?? [],
      steps: state.steps,
    });

    const synthesisInput: SynthesisInput = {
      transcript: state.messages,
      task: effectiveInput.task,
      taskPhase,
      requiredTools: effectiveInput.requiredTools ?? [],
      toolsUsed: state.toolsUsed,
      availableTools: effectiveInput.availableToolSchemas ?? [],
      entropy: (state.meta as Record<string, unknown>).entropy as import("../../..").EntropyScore | undefined,
      iteration: state.iteration,
      maxIterations: options.maxIterations,
      lastErrors: getLastErrors(state.steps),
      tier: (profile.tier ?? "mid") as import("../../../context/context-profile.js").ModelTier,
      tokenBudget: Math.floor(8192 * ((profile.contextBudgetPercent ?? 80) / 100)),
      synthesisConfig: synthesisCfg,
    };

    const synthesized = yield* synthesizerOpt.value
      .synthesize(synthesisInput)
      .pipe(Effect.catchAll(() => Effect.succeed(null)));

    if (synthesized !== null) {
      // Publish to EventBus for observability
      if (context.hooks.onContextSynthesized) {
        yield* context.hooks.onContextSynthesized(
          synthesized,
          state.taskId,
          effectiveInput.agentId ?? "unknown",
        ).pipe(Effect.catchAll(() => Effect.void));
      }

      // Inject into state for handleThinking to consume
      state = transitionState(state, { synthesizedContext: synthesized });
    }
  }
}
```

- [ ] **Step 3: Run tests**

```bash
bun test packages/reasoning/tests
```
Expected: all pass (synthesis runs but is optional — service not available in most tests)

- [ ] **Step 4: Commit**

```bash
git add packages/reasoning/src/strategies/shared/kernel-runner.ts
git commit -m "feat(reasoning): inject context synthesis into kernel loop after acting, before thinking"
```

---

## Task 8: Wire synthesis consumption into react-kernel.ts (handleThinking)

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts`

- [ ] **Step 1: Find the message construction block in handleThinking**

Search for line ~395 where `applyMessageWindow` is called:

```bash
grep -n "applyMessageWindow\|conversationMessages\|synthesizedContext" packages/reasoning/src/strategies/shared/react-kernel.ts | head -10
```

- [ ] **Step 2: Add synthesizedContext consumption**

Replace the current `applyMessageWindow` block (~lines 393-405):

```typescript
// BEFORE:
let compactedMessages = applyMessageWindow(state.messages, profile as import("../../context/context-profile.js").ContextProfile);
// ...
const conversationMessages: LLMMessage[] = (compactedMessages as readonly KernelMessage[]).map(toProviderMessage);
```

With:

```typescript
// Consume synthesized context if available (set by kernel-runner after acting)
// Otherwise fall back to sliding-window compaction (synthesis: "off" path)
let conversationMessages: LLMMessage[];
if (state.synthesizedContext) {
  // Use synthesizer-optimized context — phase-aware brief instead of raw thread
  conversationMessages = state.synthesizedContext.messages.map((m: any) => ({
    role: m.role,
    content: m.content,
    ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
  })) as LLMMessage[];
  // Clear after use — synthesizedContext is single-use per iteration
  state = transitionState(state, { synthesizedContext: null });
} else {
  // Fallback: sliding window compaction (used when synthesis is "off" or service unavailable)
  const compactedMessages = applyMessageWindow(state.messages, profile as import("../../context/context-profile.js").ContextProfile);
  conversationMessages = (compactedMessages as readonly KernelMessage[]).map(toProviderMessage);
}
```

- [ ] **Step 3: Run tests**

```bash
bun test packages/reasoning/tests
```
Expected: all pass

- [ ] **Step 4: Run full test suite**

```bash
bun test
```
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/strategies/shared/react-kernel.ts
git commit -m "feat(reasoning): handleThinking consumes synthesizedContext when available, falls back to applyMessageWindow"
```

---

## Task 9: Builder integration — SynthesisConfig in ReasoningOptions

**Files:**
- Modify: `packages/runtime/src/builder.ts`
- Modify: `packages/runtime/src/runtime.ts`

- [ ] **Step 1: Extend ReasoningOptions**

In `packages/runtime/src/builder.ts`, in the `ReasoningOptions` interface (around line 112), add:

```typescript
  /**
   * Context synthesis mode. Controls how the framework constructs the LLM's context
   * each iteration — replacing raw conversation thread delivery with phase-aware briefs.
   *
   * - "auto" (default): fast path normally, escalates to deep when entropy signals confusion
   * - "fast": deterministic templates only, zero latency overhead
   * - "deep": always uses LLM-assisted synthesis for maximum quality
   * - "custom": use the provided synthesisStrategy function
   * - "off": disable synthesis, use raw conversation thread (legacy behavior)
   *
   * @default "auto"
   */
  readonly synthesis?: "auto" | "fast" | "deep" | "custom" | "off";

  /**
   * Model to use for deep synthesis calls. Defaults to the executing model.
   * Specify a cheaper/faster model to reduce synthesis overhead.
   * @example "gpt-4o-mini" or "cogito:3b"
   */
  readonly synthesisModel?: string;

  /** Provider for the synthesis model. Only needed if different from the executing provider. */
  readonly synthesisProvider?: string;

  /**
   * Custom synthesis strategy function. Required when synthesis is "custom".
   * Receives all framework signals, returns exactly the messages the model will see.
   *
   * @example
   * ```typescript
   * import { fastSynthesis } from "@reactive-agents/reasoning";
   * .withReasoning({
   *   synthesis: "custom",
   *   synthesisStrategy: (input) =>
   *     input.taskPhase === "gather"
   *       ? myGatherBrief(input)
   *       : fastSynthesis(input),
   * })
   * ```
   */
  readonly synthesisStrategy?: import("@reactive-agents/reasoning").SynthesisStrategy;
```

- [ ] **Step 2: Thread synthesisConfig into the kernel options**

Find where `_reasoningOptions` is used to build kernel config (search for `reasoningOptions` in builder.ts). Add synthesis config threading:

```typescript
// When building the reasoning config, extract synthesis options:
const synthesisConfig = self._reasoningOptions?.synthesis !== undefined
  ? {
      mode: self._reasoningOptions.synthesis,
      model: self._reasoningOptions.synthesisModel,
      provider: self._reasoningOptions.synthesisProvider,
      synthesisStrategy: self._reasoningOptions.synthesisStrategy,
    }
  : { mode: "auto" as const };
```

Then pass `synthesisConfig` in the kernel input wherever `reasoningOptions` are threaded through to `kernelInput`.

- [ ] **Step 3: Add ContextSynthesizerLive to the reasoning runtime**

In `packages/runtime/src/runtime.ts`, find where `ReasoningServiceLive` is built. Add `ContextSynthesizerLive` to the layer composition:

```typescript
import { ContextSynthesizerLive } from "@reactive-agents/reasoning";

// In the reasoning layer composition, add:
Layer.provide(ContextSynthesizerLive)
```

The `ContextSynthesizerLive` layer depends on `LLMService` (for deep synthesis), which is already available in the reasoning layer context.

- [ ] **Step 4: Run tests**

```bash
bun test packages/runtime/tests
```
Expected: all pass

- [ ] **Step 5: Run full suite**

```bash
bun test
```
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/builder.ts packages/runtime/src/runtime.ts
git commit -m "feat(runtime): add synthesis config to ReasoningOptions, auto-compose ContextSynthesizerLive"
```

---

## Task 10: Export public types from reasoning package

**Files:**
- Modify: `packages/reasoning/src/index.ts`

- [ ] **Step 1: Add exports**

In `packages/reasoning/src/index.ts`, add under the context exports section:

```typescript
// ─── Intelligent Context Synthesis ───
export { classifyTaskPhase } from "./context/task-phase.js";
export type { TaskPhase } from "./context/task-phase.js";
export { fastSynthesis, deepSynthesis } from "./context/context-synthesizer.js";
export {
  ContextSynthesizerService,
  ContextSynthesizerLive,
} from "./context/context-synthesizer.js";
export type {
  SynthesisInput,
  SynthesizedContext,
  SynthesisConfig,
  SynthesisStrategy,
  SynthesisSignalsSnapshot,
} from "./context/context-synthesizer.js";
```

Wait — `fastSynthesis` is in `synthesis-templates.ts`, not `context-synthesizer.ts`. Fix:

```typescript
export { fastSynthesis } from "./context/synthesis-templates.js";
export {
  deepSynthesis,
  ContextSynthesizerService,
  ContextSynthesizerLive,
} from "./context/context-synthesizer.js";
```

- [ ] **Step 2: Build to verify exports**

```bash
bun run build 2>&1 | tail -5
```
Expected: clean build

- [ ] **Step 3: Run full suite**

```bash
bun test
```
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add packages/reasoning/src/index.ts
git commit -m "feat(reasoning): export ICS public API — ContextSynthesizerService, fastSynthesis, deepSynthesis, TaskPhase, SynthesisInput"
```

---

## Task 11: Integration verification

- [ ] **Step 1: Build everything**

```bash
bun run build
```
Expected: clean, 0 errors

- [ ] **Step 2: Run complete test suite**

```bash
bun test
```
Expected: all pass, 0 failures

- [ ] **Step 3: Run scratch.ts with cogito:14b (Ollama)**

```bash
bun run scratch.ts 2>&1 | grep -E "strategy|classify|synthesis|action|obs.*Written|complete|Result"
```
Expected:
- `[strategy] reactive`
- `[classify] required: web-search, file-write`
- Actions include `file-write` call
- `[obs] ✓ Written to ./agent-news.md`
- `Agent Result:` contains report content

If file-write is not called, check the ContextSynthesized EventBus events by setting verbosity to debug:
```bash
VERBOSITY=debug bun run scratch.ts 2>&1 | grep "ContextSynthesized\|Phase:"
```

- [ ] **Step 4: Verify synthesis:off preserves current behavior**

Temporarily edit scratch.ts to add `synthesis: "off"`:
```typescript
.withReasoning({ synthesis: "off" })
```
Run and confirm the agent behavior matches pre-ICS behavior (same patterns as before).
Then revert the change.

- [ ] **Step 5: Check token counts**

Compare token counts before and after synthesis by running the test suite:
```bash
PROVIDER=anthropic MODEL=claude-sonnet-4-20250514 bun run test.ts 2>&1 | grep "Total Tokens\|Avg Tokens"
```
Expected: equal or lower than baseline (target: 30-50% reduction on tasks ≥ 6 iterations).

- [ ] **Step 6: Final commit with CLAUDE.md update**

Update test count in CLAUDE.md if it changed. Then:
```bash
git add -A && git commit -m "docs: update test counts after ICS implementation"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Task phase classification (`task-phase.ts` — Task 1)
- ✅ Fast path templates (`synthesis-templates.ts` — Task 5)
- ✅ Deep path with LLM call (`deepSynthesis` in `context-synthesizer.ts` — Task 6)
- ✅ ContextSynthesizerService + Live (`context-synthesizer.ts` — Task 6)
- ✅ SynthesisConfig types (`context-synthesizer.ts` — Task 2)
- ✅ KernelState synthesizedContext field (`kernel-state.ts` — Task 4)
- ✅ KernelInput synthesisConfig field (`kernel-state.ts` — Task 4)
- ✅ KernelHooks onContextSynthesized (`kernel-hooks.ts` — Task 4)
- ✅ ContextSynthesized EventBus event (`event-bus.ts` — Task 3)
- ✅ kernel-runner synthesis injection (`kernel-runner.ts` — Task 7)
- ✅ handleThinking synthesis consumption (`react-kernel.ts` — Task 8)
- ✅ Builder ReasoningOptions extension (`builder.ts` — Task 9)
- ✅ ContextSynthesizerLive auto-composed (`runtime.ts` — Task 9)
- ✅ Public API exports (`index.ts` — Task 10)
- ✅ Local tier deep path fallback (inside `shouldUseDeepSynthesis` — Task 6)
- ✅ Custom SynthesisStrategy extension point (in service + config — Task 6)
- ✅ synthesis: "off" backwards compatibility (Task 6 + Task 8 fallback)

**Type consistency:**
- `SynthesisInput` defined in Task 2, used in Tasks 5, 6, 7
- `SynthesizedContext` defined in Task 2, returned in Task 6, stored in Task 4, consumed in Task 8
- `TaskPhase` defined in Task 1, used in Tasks 2, 5, 6, 7
- `SynthesisConfig` defined in Task 2, threaded in Tasks 7, 9
- `ContextSynthesizerService` defined in Task 2, Live in Task 6, wired in Tasks 7, 9
