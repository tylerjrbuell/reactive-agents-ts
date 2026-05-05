# Kernel Refactor: Composable Phase Architecture

**Date:** 2026-03-30
**Status:** Approved
**Scope:** `packages/reasoning/src/strategies/shared/` → `packages/reasoning/src/strategies/kernel/`

---

## Problem

`react-kernel.ts` has grown to 1,700 lines handling seven distinct concerns in one file. The `shared/` directory has 16 files with inconsistent naming conventions — a mix of phase logic, utility bags, and infrastructure with no clear narrative. The result:

- Hard to navigate for humans and agents
- Custom kernel authors must understand 1,700 lines to override one behavior
- Guards, meta-tools, and phases cannot be tested in isolation
- The directory listing tells no story about how the kernel works

---

## Goals

1. **Navigability** — directory listing reads as a coherent narrative at every level
2. **Composability** — phases, guards, and meta-tools are independently replaceable
3. **Testability** — each phase is independently testable with minimal mocks
4. **Future-proofing** — new phases, guards, and meta-tools slot in without rewriting orchestration
5. **Zero behavior change** — all existing tests pass before and after; public API surface unchanged

---

## Final Directory Structure

```
packages/reasoning/src/strategies/
  kernel/                          ← renamed from shared/
    kernel-state.ts                ← unchanged: KernelState, KernelMessage, ThoughtKernel, Phase
    kernel-runner.ts               ← slimmed: loop only (~300 lines, ICS extracted)
    kernel-hooks.ts                ← unchanged
    react-kernel.ts                ← thin orchestrator: Phase[] pipeline, public API (~150 lines)
    phases/
      context-builder.ts           ← what the LLM sees this turn
      think.ts                     ← what the LLM decides to do
      guard.ts                     ← which tool calls are allowed
      act.ts                       ← what happens when tools run
    utils/
      tool-utils.ts                ← (moved, unchanged)
      tool-execution.ts            ← (moved, unchanged)
      termination-oracle.ts        ← (moved, unchanged)
      strategy-evaluator.ts        ← (moved, unchanged)
      stream-parser.ts             ← renamed from thinking-utils.ts
      context-utils.ts             ← (moved, unchanged)
      quality-utils.ts             ← (moved, unchanged)
      service-utils.ts             ← (moved, unchanged)
      ics-coordinator.ts           ← extracted from kernel-runner.ts
  adaptive.ts
  plan-execute.ts
  plan-prompts.ts                  ← moved from kernel/utils — only plan-execute needs it
  reactive.ts
  reflexion.ts
  tree-of-thought.ts
```

**Two files absorbed (too small to justify standalone):**
- `step-utils.ts` (78 lines) → absorbed into `phases/act.ts`
- `output-assembly.ts` (83 lines) → absorbed into `react-kernel.ts`

**One file relocated:**
- `plan-prompts.ts` → `strategies/` root — it is a strategy file, not kernel infrastructure

---

## Type Moves

`ReActKernelInput` and `ReActKernelResult` move from `react-kernel.ts` → `kernel-state.ts`.

**Why:** `PhaseContext` (also in `kernel-state.ts`) references `ReActKernelInput`. Keeping it in `react-kernel.ts` creates a circular import: `kernel-state.ts` → `react-kernel.ts` → `kernel-state.ts`. These are kernel-level types that belong in the kernel state module.

`react-kernel.ts` re-exports both for full backward compatibility — no consumers change.

```typescript
// kernel-state.ts — adds these exports
export interface ReActKernelInput { ... }   // moved from react-kernel.ts
export interface ReActKernelResult { ... }  // moved from react-kernel.ts

// react-kernel.ts — re-exports for backward compat
export type { ReActKernelInput, ReActKernelResult } from "./kernel-state.js";
```

---

## The Phase Type

Added to `kernel-state.ts`:

```typescript
/**
 * A single step in the kernel turn pipeline.
 * Pure state transition: takes immutable state, returns next state.
 * Composable: phases can be substituted, extended, or reordered by custom kernels.
 */
export type Phase = (
  state: KernelState,
  ctx: PhaseContext,
) => Effect.Effect<KernelState, never, LLMService>;

/**
 * Context passed to every phase — immutable inputs for the current turn.
 * Phases read from ctx, write to state.
 */
export interface PhaseContext {
  readonly input: ReActKernelInput;
  readonly profile: ContextProfile;
  readonly hooks: KernelHooks;
}
```

---

## Phase Responsibilities

### `phases/context-builder.ts`
**Question this file answers: What will the LLM see this turn?**

Pure data transformation. No LLM calls. Fully testable without mocks.

```typescript
/** Builds the static system prompt from task description, custom system prompt, and model tier. */
export function buildSystemPrompt(task: string, systemPrompt: string | undefined, tier: string): string

/** Converts a kernel-internal KernelMessage to the LLM provider's LLMMessage format. */
export function toProviderMessage(msg: KernelMessage): LLMMessage

/**
 * Applies the sliding message window, injects ICS synthesized context when present,
 * and injects the auto-forward scratchpad section for compressed tool results.
 */
export function buildConversationMessages(
  state: KernelState,
  input: ReActKernelInput,
  profile: ContextProfile,
): readonly KernelMessage[]

/**
 * Filters tool schemas for this turn:
 * - Removes gate-blocked tools when required tools are still unmet
 * - Injects meta-tools (final-answer, brief, pulse, recall, find) when enabled
 */
export function buildToolSchemas(
  state: KernelState,
  input: ReActKernelInput,
  profile: ContextProfile,
): readonly ToolSchema[]
```

---

### `phases/think.ts`
**Question this file answers: What did the LLM decide to do?**

Calls the LLM, accumulates the stream, parses native FC tool_use blocks, detects loops, handles the trivial-task fast-path. Returns state with `pendingNativeToolCalls` set in `meta`, or `status: "done"` on fast-path.

```typescript
/**
 * Primary entry point for the thinking phase.
 * Uses context-builder to prepare the LLM call, then streams the response.
 * Sets state.meta.pendingNativeToolCalls on tool response,
 * or sets state.status = "done" on fast-path / direct answer.
 */
export function handleThinking(
  state: KernelState,
  ctx: PhaseContext,
): Effect.Effect<KernelState, never, LLMService>
```

**Internal responsibilities:**
- Calls `buildConversationMessages` + `buildToolSchemas` from context-builder
- Sets up LLM stream via `LLMService.stream()`
- Accumulates text deltas via `FiberRef` callback (streaming output)
- Parses native FC `tool_use_start`/`tool_use_delta` stream events
- Detects consecutive identical thoughts → injects nudge observation
- Trivial task fast-path: exits after 1 iteration for simple Q&A
- Calls `evaluateTermination` (termination oracle) when appropriate

---

### `phases/guard.ts`
**Question this file answers: Is this tool call allowed to run?**

All gate logic. `act.ts` calls `checkToolCall` for every pending tool call before dispatch. Strategies pass a custom guard chain to override default behavior.

```typescript
export type GuardOutcome =
  | { readonly pass: true }
  | { readonly pass: false; readonly observation: string };

/** Blocks a tool already successfully executed in a prior pass. */
export const blockedGuard: Guard;

/** Blocks the exact same tool+arguments pair seen in a prior step. */
export const duplicateGuard: Guard;

/** Blocks a side-effect tool (file-write, api-call) from executing twice. */
export const sideEffectGuard: Guard;

/** Blocks a tool called more times than the repetition budget allows. */
export const repetitionGuard: Guard;

/** Default guard chain used by the standard ReAct kernel. */
export const defaultGuards: Guard[] = [
  blockedGuard,
  duplicateGuard,
  sideEffectGuard,
  repetitionGuard,
];

/**
 * Runs a tool call through a guard chain.
 * Checks guards in order; first failure short-circuits with an observation
 * injected back into the LLM's context on the next turn.
 * Accepts a custom chain so strategies can configure their own rules.
 */
export function checkToolCall(
  guards: Guard[],
): (tc: ToolCallSpec, state: KernelState, input: ReActKernelInput) => GuardOutcome;
```

---

### `phases/act.ts`
**Question this file answers: What happened when we ran the tools?**

Dispatches approved tool calls via a meta-tool registry (inline) or `ToolService` (external). Runs the final-answer hard gate. Builds the FC message thread entries (assistant turn + tool results). Absorbs `step-utils.ts`.

```typescript
/**
 * Primary entry point for the acting phase.
 * Runs guards, dispatches tool calls, updates state.messages and state.steps.
 */
export function handleActing(
  state: KernelState,
  ctx: PhaseContext,
): Effect.Effect<KernelState, never, LLMService>
```

**Meta-tool registry (open for extension):**

```typescript
type MetaToolHandler = (
  args: unknown,
  state: KernelState,
  ctx: PhaseContext,
) => Effect.Effect<MetaToolResult, never>;

// Internal registry — new meta-tools are one-line additions
const metaToolRegistry = new Map<string, MetaToolHandler>([
  ["brief",  handleBrief],
  ["pulse",  handlePulse],
  ["recall", handleRecall],
  ["find",   handleFind],
]);
```

`final-answer` runs outside the registry because it has unique gate semantics (completion gap detection, capture, rejection with re-injection).

---

## `react-kernel.ts` — The Orchestrator (~150 lines)

Composes the Phase pipeline. Public API surface is identical to today.

```typescript
// Public API — unchanged for all consumers
export interface ReActKernelInput { ... }
export interface ReActKernelResult { ... }
export { detectCompletionGaps } from "@reactive-agents/tools"; // backward compat re-export

/**
 * Default phase pipeline for the ReAct kernel.
 * Strategies and custom kernels substitute phases here.
 */
const defaultPipeline: Phase[] = [think, act];

/**
 * Factory for creating a kernel with a custom phase pipeline.
 * Enables the Kernel SDK: swap individual phases without rewriting the orchestrator.
 */
export function makeKernel(options?: { phases?: Phase[] }): ThoughtKernel;

/** The standard ReAct kernel using the default phase pipeline. */
export const reactKernel: ThoughtKernel = makeKernel();

/** Backwards-compatible entry point. Unchanged signature. */
export const executeReActKernel: (input: ReActKernelInput) => Effect.Effect<ReActKernelResult, ...>;
```

Note: `context-builder` is not in the top-level pipeline because `think.ts` calls it internally — context building is part of the thinking phase, not a separate pipeline step. This keeps the pipeline's semantic grain consistent: `think` (decide) → `act` (execute).

---

## `kernel-runner.ts` Cleanup (~300 lines, down from 612)

The loop logic stays. What moves out:

**Extracted to `utils/ics-coordinator.ts`:**
ICS (Intelligent Context Synthesis) coordination — prepares `synthesizedContext` between iterations by calling `ContextSynthesizerService`. Self-contained, ~150 lines, independently testable.

```typescript
/** Runs ICS synthesis between kernel iterations when enabled. Sets state.synthesizedContext. */
export function coordinateICS(
  state: KernelState,
  agentId: string,
  sessionId: string,
): Effect.Effect<KernelState, never, ContextSynthesizerService | ...>
```

---

## `utils/stream-parser.ts` (renamed from `thinking-utils.ts`)

The current name implies it helps with "thinking" conceptually. It actually parses LLM stream events — a technical parsing concern, not a reasoning concern.

```typescript
export function extractThinking(content: string): { thinking: string; response: string }
export function rescueFromThinking(content: string): string
```

---

## `plan-prompts.ts` Relocation

Moves from `kernel/utils/plan-prompts.ts` → `strategies/plan-prompts.ts`.

It contains prompts only used by `plan-execute.ts`. It was in `shared/` historically because `shared/` was the dumping ground. In the new structure it lives alongside its only consumer.

---

## Testing Approach

### Phase-level unit tests (new, enabled by this refactor)

```typescript
// guard.ts — pure functions, zero mocks needed
describe("blockedGuard", () => {
  it("blocks a tool already in state.toolsUsed", () => {
    const outcome = blockedGuard(tc, stateWithTool, input);
    expect(outcome.pass).toBe(false);
  });
});

// context-builder.ts — pure data transformation, zero mocks needed
describe("buildToolSchemas", () => {
  it("removes gate-blocked tools when required tools unmet", () => {
    const schemas = buildToolSchemas(stateWithBlockedTools, input, profile);
    expect(schemas.find(s => s.name === "blocked-tool")).toBeUndefined();
  });
});
```

### Phase substitution in integration tests

```typescript
// Isolate act.ts behavior without a real LLM
const testKernel = makeKernel({ phases: [mockThink, act] });
```

### Existing tests — zero changes

All existing tests use `executeReActKernel` or `runKernel`. Public API surface is unchanged. No test rewrites required.

---

## Migration Notes

### Import paths that change

All imports of `shared/` utilities in strategy files update to `kernel/`:

```typescript
// Before
import { executeReActKernel } from "../shared/react-kernel.js";
import { buildKernelHooks } from "../shared/kernel-hooks.js";

// After
import { executeReActKernel } from "../kernel/react-kernel.js";
import { buildKernelHooks } from "../kernel/kernel-hooks.js";
```

`plan-prompts.ts` import in `plan-execute.ts`:

```typescript
// Before
import { ... } from "./shared/plan-prompts.js";

// After
import { ... } from "./plan-prompts.js";
```

### No API surface changes

- `ReActKernelInput` — unchanged
- `ReActKernelResult` — unchanged
- `executeReActKernel` — unchanged signature
- `reactKernel` — unchanged
- `buildKernelHooks` — unchanged
- `KernelState`, `KernelHooks`, `ThoughtKernel` — unchanged

---

## Alignment with Coding Standards

| Standard | How this refactor satisfies it |
|---|---|
| Files 100–300 lines target | Each phase file: ~300 lines. react-kernel.ts: ~150 lines. |
| Split at 500-line seam | react-kernel.ts (1,700) → 6 focused files |
| Composable and testable | Phase type enables independent substitution and testing |
| Explicit over implicit | `Phase[]` pipeline makes execution sequence explicit |
| Observable by design | Hooks wiring unchanged; phases call hooks at existing points |
| No behavior changes | Zero logic changes; structural reorganization only |

---

## Alignment with Vision

| Vision Principle | How this delivers it |
|---|---|
| Composable Over Monolithic | Phases are composable primitives; custom kernels swap phases |
| Testable Over Clever | Each phase independently testable; guard functions are pure |
| Kernel SDK (shipped differentiator) | `makeKernel({ phases })` makes the SDK promise real |
| Navigability for agents | Directory listing at every level tells a coherent story |

---

## Scalability

| Future capability | How the architecture handles it |
|---|---|
| New phase (e.g., reflect, interrupt) | Add `phases/reflect.ts`, insert into `defaultPipeline` |
| New guard rule | Add `Guard` function to `guard.ts`, add to `defaultGuards[]` |
| Strategy-specific guard rules | Pass custom `Guard[]` to `checkToolCall` |
| New meta-tool | Add one entry to `metaToolRegistry` in `act.ts` |
| Long-running async tools | New `phases/await-tools.ts` inserted after `act` |
| Extended thinking (o1-style) | Swap `think.ts` in custom pipeline |
| Parallel tool execution | `act.ts` dispatches guards + execution concurrently |

---

_Authors: Tyler Buell_
_License: MIT_
