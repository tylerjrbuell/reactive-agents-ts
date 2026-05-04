# Effect Abstraction Follow-Through — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove high-friction duplication and untyped boundaries called out in the Effect abstraction audit: shared output-quality gate, optional `maxTokens` on `ContextProfile`, structured kernel `meta`, precise `ReasoningServiceLive` layer typing, and a documented decision for `buildDynamicContext` — while keeping `bun run build` and scoped `bun test --timeout 15000` green after each task.

**Architecture:** Prefer **small shared modules** under `packages/reasoning/src/strategies/kernel/utils/` over new packages. Prefer **typed interfaces** (`KernelMeta`, schema fields) over `as any`. Do **not** wrap the `think.ts` streaming loop in new Effect combinators; only extract pure helpers and types.

**Tech Stack:** TypeScript, Effect-TS (`Effect`, `Layer`, `Schema`), Bun test runner, existing `stripThinking` / `output-synthesis` utilities.

**Related:** `.agents/skills/effect-abstraction-audit/SKILL.md` (updated 2026-04-10 for accurate debt list).

---

## File Map

### Create

- `packages/reasoning/src/strategies/kernel/utils/output-quality-gate.ts` — shared `enforceOutputQualityGate`
- `packages/reasoning/tests/strategies/kernel/utils/output-quality-gate.test.ts` — unit tests (mock `LLMService` or use testing package patterns from sibling tests)

### Modify

- `packages/reasoning/src/strategies/plan-execute.ts` — delete local `enforceOutputQualityGate`, import shared
- `packages/reasoning/src/strategies/reflexion.ts` — same
- `packages/reasoning/src/context/context-profile.ts` — optional `maxTokens` in schema + defaults if needed
- `packages/reasoning/src/strategies/kernel/kernel-state.ts` — `KernelMeta` / `KernelMetaBag` and `meta` type
- `packages/reasoning/src/strategies/kernel/phases/think.ts` — replace `(state.meta as any)` entropy access with typed access where applicable
- `packages/reasoning/src/strategies/kernel/phases/act.ts` — replace `contextProfile as any` for `maxTokens`; typed `meta` reads
- `packages/reasoning/src/strategies/kernel/kernel-runner.ts` — typed `meta` / `maxTokens`
- `packages/reasoning/src/strategies/kernel/utils/reactive-observer.ts` — typed `meta` for entropy / drift events
- `packages/reasoning/src/services/reasoning-service.ts` — replace `Layer.Layer<any, never>` with merged service union type
- `packages/runtime/src/builder.ts` (and/or `packages/runtime/src/agent-config.ts`) — if the builder constructs `Partial<ContextProfile>`, ensure `maxTokens` is documented and passed through when set
- `packages/reasoning/src/context/index.ts` — JSDoc `@deprecated` on `buildDynamicContext` export **or** no change if wiring instead (Task 6)

### Optional / decision branch (Task 6 only)

- `packages/reasoning/src/strategies/kernel/phases/think.ts` — wire `buildDynamicContext` into message construction **or** remove export from `context/index.ts` and adjust any external imports (grep workspace)

---

## Task 1: Shared `enforceOutputQualityGate`

**Files:**

- Create: `packages/reasoning/src/strategies/kernel/utils/output-quality-gate.ts`
- Modify: `packages/reasoning/src/strategies/plan-execute.ts` (remove duplicate function, add import)
- Modify: `packages/reasoning/src/strategies/reflexion.ts` (same)
- Test: `packages/reasoning/tests/strategies/kernel/utils/output-quality-gate.test.ts`

- [ ] **Step 1: Add the shared module**

Create `packages/reasoning/src/strategies/kernel/utils/output-quality-gate.ts`:

```typescript
import { Effect } from "effect";
import type { LLMService } from "@reactive-agents/llm-provider";
import { stripThinking } from "./stream-parser.js";
import { extractOutputFormat } from "./task-intent.js";
import { validateOutputFormat, buildSynthesisPrompt } from "./output-synthesis.js";

export interface OutputQualityGateInput {
  readonly llm: LLMService["Type"];
  readonly taskDescription: string;
  readonly output: string;
}

/**
 * When the task implies a structured output format and the current output
 * fails validation, asks the LLM once to rewrite via `buildSynthesisPrompt`.
 * Always strips thinking tags from the candidate (aligned with plan-execute).
 */
export const enforceOutputQualityGate = (
  input: OutputQualityGateInput,
): Effect.Effect<
  { output: string; tokens: number; cost: number },
  never,
  never
> => {
  const intent = extractOutputFormat(input.taskDescription);
  if (!intent.format) {
    return Effect.succeed({ output: input.output, tokens: 0, cost: 0 });
  }

  const validation = validateOutputFormat(input.output, intent.format);
  if (validation.valid) {
    return Effect.succeed({ output: input.output, tokens: 0, cost: 0 });
  }

  const synthesisPrompt = buildSynthesisPrompt(
    input.output,
    intent.format,
    input.taskDescription,
  );

  return input.llm
    .complete({
      messages: [{ role: "user", content: synthesisPrompt }],
      maxTokens: 1500,
      temperature: 0.2,
    })
    .pipe(
      Effect.map((response) => {
        const candidate = stripThinking(response.content).trim();
        if (!candidate) {
          return {
            output: input.output,
            tokens: response.usage.totalTokens,
            cost: response.usage.estimatedCost,
          };
        }

        const revalidation = validateOutputFormat(candidate, intent.format);
        return {
          output: revalidation.valid ? candidate : input.output,
          tokens: response.usage.totalTokens,
          cost: response.usage.estimatedCost,
        };
      }),
      Effect.catchAll(() =>
        Effect.succeed({ output: input.output, tokens: 0, cost: 0 }),
      ),
    );
};
```

- [ ] **Step 2: Rewire plan-execute**

In `packages/reasoning/src/strategies/plan-execute.ts`, add:

```typescript
import { enforceOutputQualityGate } from "./kernel/utils/output-quality-gate.js";
```

Delete the entire local `function enforceOutputQualityGate(...)` block (lines ~644–697). Call sites stay `yield* enforceOutputQualityGate({ ... })`.

- [ ] **Step 3: Rewire reflexion**

In `packages/reasoning/src/strategies/reflexion.ts`, add the same import and delete the local duplicate function (~407–458). Remove now-unused imports if `stripThinking` is only used by the removed function (keep `extractThinking` etc. as needed elsewhere).

- [ ] **Step 4: Write unit tests**

Add `packages/reasoning/tests/strategies/kernel/utils/output-quality-gate.test.ts` that:

1. When `extractOutputFormat` yields no format, gate returns original output with zero tokens (no LLM call) — use a task string with no structured intent.
2. When format is required and output already valid, no LLM call.
3. When format invalid, mock `llm.complete` to return content that passes `validateOutputFormat` after `stripThinking`, and assert gated output updates.

Follow patterns from `packages/reasoning/tests/strategies/plan-execute.test.ts` or `reflexion.test.ts` for mocking `LLMService` (or use `@reactive-agents/testing` if already used in reasoning tests).

- [ ] **Step 5: Run scoped tests**

Run:

```bash
bun test packages/reasoning/tests/strategies/kernel/utils/output-quality-gate.test.ts --timeout 15000
bun test packages/reasoning/tests/strategies/plan-execute.test.ts --timeout 15000
bun test packages/reasoning/tests/strategies/reflexion.test.ts --timeout 15000
```

Expected: all pass.

- [ ] **Step 6: Build**

```bash
bun run build:packages
```

Expected: success (or full `bun run build` if your workflow requires it).

- [ ] **Step 7: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/utils/output-quality-gate.ts \
  packages/reasoning/src/strategies/plan-execute.ts \
  packages/reasoning/src/strategies/reflexion.ts \
  packages/reasoning/tests/strategies/kernel/utils/output-quality-gate.test.ts
git commit -m "refactor(reasoning): share enforceOutputQualityGate between plan-execute and reflexion"
```

---

## Task 2: Optional `maxTokens` on `ContextProfile`

**Files:**

- Modify: `packages/reasoning/src/context/context-profile.ts`
- Modify: `packages/reasoning/src/strategies/kernel/phases/think.ts` (read `maxTokens` without `as any`)
- Modify: `packages/reasoning/src/strategies/kernel/kernel-runner.ts`
- Modify: `packages/reasoning/src/strategies/kernel/phases/act.ts`
- Test: extend `packages/reasoning/tests/context/tier-tool-compression.test.ts` or add `context-profile.test.ts` asserting Schema encodes optional `maxTokens`

- [ ] **Step 1: Extend schema**

In `packages/reasoning/src/context/context-profile.ts`, add to `ContextProfileSchema`:

```typescript
maxTokens: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.positive())),
```

Do **not** add to every `CONTEXT_PROFILES` tier entry unless product wants defaults; optional means “unset = use call-site fallback.”

- [ ] **Step 2: Replace casts**

Replace patterns like:

```typescript
(input.contextProfile as any)?.maxTokens ?? Number.MAX_SAFE_INTEGER
```

with:

```typescript
input.contextProfile?.maxTokens ?? Number.MAX_SAFE_INTEGER
```

after ensuring `contextProfile` type is `Partial<ContextProfile>` or full `ContextProfile` so `maxTokens` is visible. Files: `think.ts` (~120), `kernel-runner.ts` (~347), `act.ts` (~71, ~101).

- [ ] **Step 3: Builder pass-through (if applicable)**

Search:

```bash
rg "contextProfile" packages/runtime/src -g '*.ts'
```

If the runtime builder merges user config into `ContextProfile`, document `maxTokens` in `agent-config.ts` / builder JSDoc and map the field through so kernel receives it.

- [ ] **Step 4: Test and build**

```bash
bun test packages/reasoning/tests/context --timeout 15000
bun run build:packages
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(reasoning): optional maxTokens on ContextProfile"
```

---

## Task 3: Structured `KernelState.meta` (`KernelMetaBag`)

**Files:**

- Modify: `packages/reasoning/src/strategies/kernel/kernel-state.ts` (types + any initial state factories if they type `meta`)
- Modify: `think.ts`, `act.ts`, `kernel-runner.ts`, `reactive-observer.ts`, and any file `rg "meta as any" packages/reasoning/src` lists
- Test: existing kernel / reasoning tests should compile; add narrow test only if a pure helper is extracted

- [ ] **Step 1: Define types in `kernel-state.ts`**

Add interfaces for fields that are actually read/written today (discover with `rg "meta\\." packages/reasoning/src/strategies/kernel` and `rg "state\\.meta"`). Minimal starter shape (extend as needed during compile fixes):

```typescript
export interface KernelEntropyMeta {
  readonly modelId?: string;
  readonly taskDescription?: string;
  readonly temperature?: number;
  readonly lastLogprobs?: readonly number[];
  readonly entropyHistory?: readonly number[];
  readonly latestScore?: number;
  readonly latestTrajectory?: unknown;
  readonly latest?: {
    readonly composite: number;
    readonly shape: string;
    readonly momentum: number;
    readonly history?: readonly number[];
  };
  readonly taskCategory?: string;
}

export interface KernelMeta {
  readonly entropy?: KernelEntropyMeta;
  readonly qualityCheckDone?: boolean;
  readonly controllerDecisions?: readonly string[];
}

/** Allows strategy-specific keys while typing known slots. */
export type KernelMetaBag = KernelMeta & Record<string, unknown>;
```

Change `KernelState`:

```typescript
readonly meta: Readonly<KernelMetaBag>;
```

- [ ] **Step 2: Fix compilation errors iteratively**

Run `bun run typecheck` or `bun run build:packages` and fix each error by:

- Using `state.meta.entropy` instead of `(state.meta as any).entropy` where the field exists
- For spreads like `{ ...state.meta, qualityCheckDone: true }`, ensure the result satisfies `KernelMetaBag` (TypeScript may need `as const` or explicit annotation on the new object)

- [ ] **Step 3: Remove redundant `as any` on entropy**

Target files from audit: `think.ts`, `act.ts`, `kernel-runner.ts`, `reactive-observer.ts`, `reflexion.ts` (if any `meta` access).

- [ ] **Step 4: Run reasoning tests**

```bash
bun test packages/reasoning/tests/strategies/kernel --timeout 15000
bun test packages/reasoning/tests/strategies/plan-execute.test.ts --timeout 15000
bun test packages/reasoning/tests/strategies/reflexion.test.ts --timeout 15000
```

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(reasoning): type KernelState.meta as KernelMetaBag"
```

---

## Task 4: `ReasoningServiceLive` layer typing

**Files:**

- Modify: `packages/reasoning/src/services/reasoning-service.ts`

- [ ] **Step 1: Replace `any`**

Change:

```typescript
let strategyLayer: Layer.Layer<any, never> = llmLayer;
```

to a concrete merged services type. In Effect 3, after merging `LLMService` and optionally `ToolService`, use:

```typescript
let strategyLayer: Layer.Layer<LLMService | ToolService, never, never> = llmLayer;
```

If TypeScript complains that `llmLayer` is only `LLMService`, use:

```typescript
let strategyLayer = llmLayer as Layer.Layer<LLMService | ToolService, never, never>;
```

only if necessary — prefer inference from `Layer.merge` without assertion; adjust until `strategyFn(...).pipe(Effect.provide(strategyLayer))` type-checks.

- [ ] **Step 2: Verify**

```bash
bun run build:packages
```

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(reasoning): type ReasoningServiceLive strategy layer without any"
```

---

## Task 5: Documentation and changeset (user-facing typing)

**Files:**

- Modify: `apps/docs/src/content/docs/` only if public `ContextProfile` / builder docs mention profile fields
- Add: `.changeset/*.md` via `bun run changeset` if `maxTokens` or export changes are user-visible

- [ ] **Step 1: Docs**

If `ContextProfile` is documented on the docs site, add optional `maxTokens` with one sentence: caps LLM `maxTokens` for kernel calls when set.

- [ ] **Step 2: Changeset**

```bash
bun run changeset
```

Select `@reactive-agents/reasoning` (and runtime if builder changed). Patch for typings + shared util; minor only if new public API surface is intentional.

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: context profile maxTokens; chore: changeset"
```

---

## Task 6: Decision — `buildDynamicContext`

**Pick one branch; do not ship both without a feature flag.**

### Branch A — Deprecate unused export

**Files:**

- Modify: `packages/reasoning/src/context/index.ts` — `@deprecated` on `buildDynamicContext` re-export with pointer to `buildStaticContext` + issue link
- Grep: `rg "buildDynamicContext"` across repo; update tests that only assert non-use in `think.ts`
- Optional: move function to `context-engine-internal.ts` if you want it test-only

- [ ] **Step 1: Grep and update consumers**

```bash
rg "buildDynamicContext" -g '*.ts'
```

- [ ] **Step 2: Commit**

```bash
git commit -m "chore(reasoning): deprecate unused buildDynamicContext export"
```

### Branch B — Wire into kernel (behavior change)

**Files:**

- Modify: `packages/reasoning/src/strategies/kernel/phases/think.ts` (or `context-builder.ts`) to append dynamic sections from `buildDynamicContext` where step history belongs
- Modify: `packages/reasoning/tests/strategies/kernel/phases/think-system-prompt.test.ts` expectations
- Docs + changeset **required** (token/behavior change)

- [ ] **Step 1: Design note in PR**

Explain interaction with sliding-window / `messages[]` compaction to avoid double-counting history.

- [ ] **Step 2: Integration tests**

Extend kernel or think-phase tests to assert dynamic section appears when steps exist.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(reasoning): wire buildDynamicContext into kernel context"
```

---

## Self-Review (completed while authoring)

| Check | Result |
|-------|--------|
| Spec coverage | Tasks map to audit items H1–H5 + skill maintenance |
| Placeholders | No TBD steps; Task 6 is explicit branch |
| Type consistency | `enforceOutputQualityGate` name and `OutputQualityGateInput` used uniformly; `KernelMetaBag` is the single meta alias |

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-10-effect-abstraction-follow-through.md`. Two execution options:**

1. **Subagent-driven (recommended)** — Fresh subagent per task, review between tasks; REQUIRED SUB-SKILL: superpowers `subagent-driven-development`.

2. **Inline execution** — Batch tasks in one session with checkpoints; REQUIRED SUB-SKILL: superpowers `executing-plans`.

**Which approach do you want?**
