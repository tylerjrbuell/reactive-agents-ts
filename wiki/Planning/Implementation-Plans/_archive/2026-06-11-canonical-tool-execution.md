# Canonical Tool-Execution-and-Observe Primitive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the kernel act-phase tool handling and plan-execute's hand-rolled `tool_call` direct dispatch into ONE shared primitive `executeToolAndObserve`, so `observation.tool-result` (and siblings) fire identically regardless of dispatch path — fixing the reported dead-`.on()`-hook bug (#195/FM-I) while preserving each path's legitimate data flow.

**Architecture:** A new pure-ish primitive in `kernel/capabilities/act/tool-observe.ts` wraps the existing `executeNativeToolCall` core plus: optional healing, deterministic + optional-LLM fact extraction, compression (scratchpad/strip-hints parameterized), observation-step construction with guaranteed metadata, and Compose-tag + ToolCall*-event emission — every cross-cutting capability gated by config so each caller opts into exactly what it needs. Two callers adopt it: the kernel `act.ts` single-call path (byte-identical migration) and plan-execute `step-executor.ts` `tool_call` branch (gains parity-cheap capabilities). A later, separate Phase E unifies a pre-existing kernel single/batch asymmetry (batch tool-results are invisible to `.on()` today) — kept out of the byte-identical migration on purpose.

**Tech Stack:** TypeScript, Effect-TS, Bun test runner. Packages: `@reactive-agents/reasoning`, `@reactive-agents/tools`, `@reactive-agents/core`, `@reactive-agents/observability`.

**Source spec:** `wiki/Architecture/Design-Specs/2026-06-11-canonical-tool-execution-spec.md` + analysis `…-canonical-tool-execution-analysis.md`.

**Refinements over the spec (deliberate, honest):**
- Spec listed `verifier` + `memoryService` in the primitive's day-1 config. This plan **defers both to Phase E**. The kernel **single** path (the canonical compose-emitting path) uses neither today, so Phase A/B don't need them and Phase B stays a pure dedup.
- Spec didn't capture that the kernel's **batch** path emits NO compose tags and the **single** path attaches NO `verification` / stores NO semantic memory. That three-axis asymmetry is a latent instance of the *same* reported bug (parallel tool-results invisible to `.on()`). Fixing it is a behavior change → isolated in Phase E, NOT smuggled into the "equivalence" migration.
- Added three parameterizations the spec implied but didn't name: `heal` config (heal-internally vs pre-healed), `emitToolCallEvents` (kernel uses hooks; plan-execute emits manually), and a `preprocess` hook on `executeNativeToolCall` (plan-execute's `sanitizeToolOutput`).

**Strategy coverage (why only plan-execute gets a strategy-specific task):**
Reflexion and Tree-of-Thought hand-roll **no** tool execution — verified: zero `toolService.execute`/`executeNativeToolCall` in either file. They dispatch tools **only** through the kernel:
- reflexion → `runPass(reactKernel, buildKernelInput(crossCutting, …))` (`reflexion.ts:184,477`)
- ToT → `runKernel(reactKernel, buildKernelInput(crossCutting, …))` (`tree-of-thought.ts:216,665`)

So their tool path is `buildKernelInput → runPass/runKernel → react-kernel → act.ts → tool execution` — they live **downstream** of the act phase. Two consequences:
1. They were never broken the way plan-execute's `tool_call` was — the earlier FM-I `buildKernelInput` fix already threads `harnessPipeline` into their `crossCutting`, so `observation.tool-result` already fires for their tool calls today.
2. **Phase B covers them transitively.** Once `act.ts` routes through `executeToolAndObserve`, reflexion / ToT / adaptive / composite plan-execute steps inherit healing + compose tags + guaranteed metadata with **zero per-strategy edits**.

Therefore: **adaptive, reflexion, ToT, and plan-execute *composite* steps = transitive via Phase B. Only plan-execute's `tool_call` direct-dispatch branch (Phase C) needs a strategy-specific task.** Do NOT add per-strategy tasks for reflexion/ToT — none should exist. (ToT runs each branch as a separate sub-kernel via `runKernel`; each still passes through `act.ts`, so still covered. ToT's `dispatcher-early-stop` outer-loop debt is orchestration, orthogonal, untouched.)

**Ownership / warden routing (pilot active until 2026-06-15):**
- Phases A, B, E touch `packages/reasoning/src/kernel/**` → route through **kernel-warden** (MissionBrief in, UpwardReport out).
- Phases C, D touch `packages/reasoning/src/strategies/**` + docs → **main-thread** (strategies/ unmapped).

---

## File Structure

| File | Responsibility | Phase |
|---|---|---|
| `packages/reasoning/src/kernel/capabilities/act/tool-observe.ts` | **NEW.** The `executeToolAndObserve` primitive + its `ToolObserveContext`/`ToolObserveConfig`/`ToolObserveResult` types. | A |
| `packages/reasoning/src/kernel/capabilities/act/tool-execution.ts` | MODIFY. Add optional `preprocess?: (raw: string) => string` to `executeNativeToolCall` config (applied after stringify, before `normalizeObservation`). Additive; kernel call sites unaffected. | A |
| `packages/reasoning/tests/kernel/act/tool-observe.test.ts` | **NEW.** Unit tests for the primitive (each config branch). | A |
| `packages/reasoning/src/kernel/capabilities/act/act.ts` | MODIFY. Single-call execute-and-observe block (`:697-814`) replaced by a `executeToolAndObserve` call; healing/guards/hooks/scratchpad-sync stay. | B |
| `packages/reasoning/tests/kernel/act/act-single-equivalence.test.ts` | **NEW.** Golden-master: obsStep + emitted compose tags for a fixed single-tool execution. Authored against current act.ts, kept green through migration. | B |
| `packages/reasoning/src/strategies/plan-execute/step-executor.ts` | MODIFY. `tool_call` branch (`:123-257`) replaced by `resolveStepReferences` → `executeToolAndObserve` → map to `StepExecResult`. | C |
| `packages/reasoning/src/strategies/plan-execute.ts` | MODIFY. The caller-side obs-step build at `:763` (the line that constructs a step for the tool_call result) uses `result.obsStep` from `StepExecResult` instead of rebuilding. | C |
| `packages/reasoning/tests/strategies/plan-execute-tool-observe.test.ts` | **NEW.** Integration: `.on('observation.tool-result')` fires on a `tool_call` step; healing applies; opt-outs hold. | C |
| `wiki/Failure-Modes/FM-I Strategy Kernel-Input Divergence.md` | MODIFY. Close the tool_call sub-gap; status → resolved. | D |
| (Phase E) `tool-observe.ts`, `act.ts` batch path `:510-630`, single path | MODIFY. Add verifier+memory params; make both kernel sites symmetric (compose+verifier+memory). | E |

---

## Reference: current behavior the primitive must reproduce

**Kernel single path** (`act.ts:697-814`, per-call, the canonical compose-emitting path) does, in order:
1. `emitLog({_tag:"tool_call", tool, iteration, timestamp})`
2. `execResult = executeNativeToolCall(toolService.value, tc, agentId, sessionId, { compression, scratchpad: sharedScratchpad, profile })` — note: **no `memoryService`**.
3. `emitLog({_tag:"tool_result", tool, duration, status, error?, timestamp})`
4. (act.ts, stays) update action-step `metadata.duration`.
5. (act.ts, stays) merge `execResult.delegatedToolsUsed` into `newToolsUsed`.
6. On failure: `obsContent = execResult.content + "\n\n[Recovery guidance: " + adapter.errorRecovery({toolName, errorContent, missingTools, tier}) + "]"` (only if a recovery string is returned).
7. On success + `shouldExtract`: `extracted = extractObservationFacts(...)`; if non-empty, `obsContent = "[" + tc.name + " result — key facts]\n" + extracted`.
8. `obsStep = makeStep("observation", obsContent, { toolCallId: tc.id, storedKey: execResult.storedKey, extractedFact: execResult.extractedFact, observationResult: makeObservationResult(tc.name, execResult.success, obsContent, { delegatedToolsUsed }) })` — note: **no `verification`**.
9. (act.ts, stays) `hooks.onObservation(state', obsContent, execResult.success)`.
10. `emitToCompose(pipeline, "observation.tool-result", obsStep, { iteration, phase:"act", state: asKernelStateLike(state), strategy, toolName: tc.name, callId: tc.id, healed, durationMs })`.
11. On failure: `emitToCompose(pipeline, "lifecycle.failure", { reason:"tool-error", errorMessage: execResult.content, attemptNumber: iteration, failureStreak: 1, currentStrategy }, { iteration, phase:"act", state: asKernelStateLike(state), strategy })`.

Steps 1–3, 6–8, 10–11 move INTO the primitive. Steps 4, 5, 9 stay in act.ts (operate on kernel `allSteps`/`newToolsUsed`/`hooks`). Healing (act.ts `:221`) stays upstream; act.ts passes the precomputed `ctx.healed` flag.

**`shouldExtract`** (act.ts `:143`): `obsMode === true || (obsMode !== false && (tier === "local" || tier === "mid"))` where `obsMode = input.observationSummary`. The kernel computes this and passes it as `config.extractFactsLLM`.

---

## Task A1: Add `preprocess` hook to `executeNativeToolCall`

**Files:**
- Modify: `packages/reasoning/src/kernel/capabilities/act/tool-execution.ts:642-720`
- Test: `packages/reasoning/tests/kernel/act/tool-observe.test.ts` (covered in A3)

- [ ] **Step 1: Add the optional `preprocess` config field and apply it**

In `executeNativeToolCall`, extend the `config` parameter type and apply the hook to the stringified result before `normalizeObservation`. Change the config object type (currently `:646-659`) to add:

```ts
    /**
     * Optional caller-supplied transform applied to the raw stringified tool
     * result BEFORE normalizeObservation/compression. plan-execute binds its
     * `sanitizeToolOutput` here so action-tool args/recipients are stripped
     * from the compressed preview that feeds its tool-less downstream prompts.
     * Kernel callers omit it (normalizeObservation already covers their needs).
     */
    preprocess?: (raw: string) => string;
```

Then inside the `Effect.map((r) => { ... })` block, change (`:671`):

```ts
        let content = typeof r.result === "string" ? r.result : JSON.stringify(r.result);
```
to:
```ts
        let content = typeof r.result === "string" ? r.result : JSON.stringify(r.result);
        if (config?.preprocess) content = config.preprocess(content);
```

- [ ] **Step 2: Verify it compiles**

Run: `bunx turbo run build --filter=@reactive-agents/reasoning`
Expected: build PASS (additive optional field; no existing caller passes `preprocess`).

- [ ] **Step 3: Commit**

```bash
git add packages/reasoning/src/kernel/capabilities/act/tool-execution.ts
git commit -m "feat(reasoning): add optional preprocess hook to executeNativeToolCall"
```

---

## Task A2: Build the `executeToolAndObserve` primitive

**Files:**
- Create: `packages/reasoning/src/kernel/capabilities/act/tool-observe.ts`

- [ ] **Step 1: Write the primitive**

```ts
/**
 * tool-observe.ts — Canonical "execute one tool, observe the result" primitive.
 *
 * THE single way a single tool call is executed-and-observed in the reasoning
 * package. Wraps the existing `executeNativeToolCall` core plus every
 * cross-cutting observation capability (compress, fact-extract, build obs step,
 * emit ToolCall* events, emit Compose tags), each config-gated so callers opt
 * into exactly what they need:
 *   - kernel act single path: pipeline (compose) + errorRecovery + LLM-facts,
 *     pre-healed upstream, hooks emit ToolCall* events (NOT this primitive).
 *   - plan-execute tool_call: pipeline (compose) + heal-internally + preprocess
 *     (sanitize) + emitToolCallEvents; no LLM-facts, no verifier/memory.
 *
 * Verifier + semantic-memory are intentionally NOT here yet — see Phase E of
 * the canonical-tool-execution plan (they unify a pre-existing kernel
 * single/batch asymmetry as a separate, visible behavior change).
 */
import { Effect } from "effect";
import { ObservableLogger } from "@reactive-agents/observability";
import type { LogEvent } from "@reactive-agents/observability";
import { runHealingPipeline, type ToolCallSpec } from "@reactive-agents/tools";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import {
  emitToCompose,
  emitErrorSwallowed,
  errorTag,
  type HarnessPipeline,
} from "@reactive-agents/core";
import { executeNativeToolCall, extractObservationFacts } from "./tool-execution.js";
import { makeStep } from "../sense/step-utils.js";
import { makeObservationResult } from "../../utils/observation-helpers.js";
import { publishReasoningStep } from "../../utils/service-utils.js";
import type { StrategyServices } from "../../utils/service-utils.js";
import type { KernelStateLike } from "../../utils/diagnostics.js";
import type { ContextProfile } from "../../../context/context-profile.js";
import type { ReasoningStep } from "../../../types/index.js";
import type {
  MaybeService,
  ToolServiceInstance,
} from "../../../kernel/state/kernel-state.js";

/** Lightweight tool-schema shape accepted by the internal healing step. */
export interface ToolSchemaLite {
  readonly name: string;
  readonly description: string;
  readonly parameters: readonly {
    readonly name: string;
    readonly type: string;
    readonly description?: string;
    readonly required?: boolean;
  }[];
}

export interface ToolObserveContext {
  readonly iteration: number;
  readonly phase: "act";
  readonly strategy: string;
  /** kernel: asKernelStateLike(state); plan-execute: synthetic minimal view. */
  readonly state: KernelStateLike;
  readonly callId: string;
  /** Set by callers that pre-heal upstream (kernel). When a `heal` config is
   *  supplied instead, the primitive computes this itself. */
  readonly healed?: boolean;
}

export interface ToolObserveHealConfig {
  readonly schemas: readonly ToolSchemaLite[];
  readonly fileToolNames: ReadonlySet<string>;
  readonly cwd: string;
}

export interface ToolObserveConfig {
  readonly compression?: ResultCompressionConfig;
  readonly profile?: ContextProfile;
  /** Present ⇒ compressed result auto-stored under its key; absent ⇒ no store. */
  readonly scratchpad?: Map<string, string>;
  /** plan-execute's sanitizeToolOutput, applied pre-normalize/compress. */
  readonly preprocess?: (raw: string) => string;
  /** Strip [STORED:]/recall() dead pointers from compressed display content. */
  readonly stripDeadStorageHints?: (content: string, toolName: string) => string;
  /** Run the LLM fact-extraction pass (kernel shouldExtract); off for plan-execute. */
  readonly extractFactsLLM?: boolean;
  /** Compose pipeline. Absent ⇒ tag emission is a no-op (obs step still built). */
  readonly pipeline?: HarnessPipeline;
  /** Adapter error-recovery (kernel binds adapter+missingTools; plan-execute omits). */
  readonly errorRecovery?: (toolName: string, errorContent: string) => string | undefined;
  /** Present ⇒ primitive heals internally + computes ctx.healed (plan-execute). */
  readonly heal?: ToolObserveHealConfig;
  /** Emit ToolCallStarted/Completed (plan-execute has no hooks; kernel keeps false). */
  readonly emitToolCallEvents?: boolean;
  readonly eventBus?: StrategyServices["eventBus"];
  readonly taskId?: string;
  readonly kernelPass?: string;
  readonly agentId?: string;
  readonly sessionId?: string;
  /** Caller's own emitLog (kernel + plan-execute share the same shape). When
   *  omitted the primitive resolves ObservableLogger itself. */
  readonly emitLog?: (event: LogEvent) => Effect.Effect<void, never>;
}

export interface ToolObserveResult {
  readonly obsStep: ReasoningStep;
  readonly content: string;
  readonly success: boolean;
  readonly storedKey?: string;
  readonly delegatedToolsUsed?: readonly string[];
  readonly extractedFact?: string;
  readonly durationMs: number;
  readonly healed: boolean;
}

const defaultEmitLog = (event: LogEvent): Effect.Effect<void, never> =>
  Effect.serviceOption(ObservableLogger).pipe(
    Effect.flatMap((opt) =>
      opt._tag === "Some"
        ? opt.value
            .emit(event)
            .pipe(
              Effect.catchAll((err) =>
                emitErrorSwallowed({
                  site: "reasoning/src/kernel/capabilities/act/tool-observe.ts:emitLog",
                  tag: errorTag(err),
                }),
              ),
            )
        : Effect.void,
    ),
  );

export function executeToolAndObserve(
  toolService: MaybeService<ToolServiceInstance>,
  call: {
    readonly toolName: string;
    readonly args: Record<string, unknown>;
    readonly rationale?: { readonly why: string; readonly confidence?: number };
  },
  ctx: ToolObserveContext,
  config: ToolObserveConfig,
): Effect.Effect<ToolObserveResult, never, import("@reactive-agents/llm-provider").LLMService> {
  const emitLog = config.emitLog ?? defaultEmitLog;

  return Effect.gen(function* () {
    // ── 1. Heal (only when caller asked for internal healing) ────────────────
    let toolName = call.toolName;
    let args = call.args;
    let healed = ctx.healed ?? false;
    if (config.heal) {
      const rawTc: ToolCallSpec = { id: ctx.callId, name: call.toolName, arguments: call.args };
      const healResult = runHealingPipeline(
        rawTc,
        config.heal.schemas.map((s) => ({
          name: s.name,
          description: s.description,
          parameters: s.parameters.map((p) => ({
            name: p.name,
            type: p.type,
            description: p.description,
            required: p.required,
          })),
        })),
        config.heal.fileToolNames,
        config.heal.cwd,
        {},
        {},
      );
      if (healResult.succeeded) {
        const healedCall = healResult.call;
        healed = healedCall.name !== rawTc.name || healedCall.arguments !== rawTc.arguments;
        toolName = healedCall.name;
        args = (healedCall.arguments as Record<string, unknown>) ?? {};
      } else {
        // Unrepairable — surface the cause before the tool fails.
        yield* emitToCompose(config.pipeline, "nudge.healing-failure",
          `healing-pipeline could not repair call to "${call.toolName}" — no schema match in registry`,
          {
            iteration: ctx.iteration,
            phase: "act",
            state: ctx.state,
            strategy: ctx.strategy,
            trigger: "healing-failure",
            severity: "warn",
          },
        );
      }
    }

    // ── 2. ToolService unavailable → failed observation (parity with act.ts) ─
    if (toolService._tag === "None") {
      const content = `[Tool "${toolName}" requested but ToolService is not available]`;
      const obsStep = makeStep("observation", content, {
        toolCallId: ctx.callId,
        observationResult: makeObservationResult(toolName, false, content),
      });
      return { obsStep, content, success: false, durationMs: 0, healed } satisfies ToolObserveResult;
    }

    // ── 3. Emit ToolCallStarted (plan-execute path only) ─────────────────────
    if (config.emitToolCallEvents && config.eventBus) {
      yield* publishReasoningStep(config.eventBus, {
        _tag: "ToolCallStarted",
        taskId: config.taskId ?? "reasoning",
        toolName,
        callId: ctx.callId,
        ...(call.rationale && call.rationale.why
          ? {
              rationale: {
                why: call.rationale.why,
                ...(typeof call.rationale.confidence === "number"
                  ? { confidence: call.rationale.confidence }
                  : {}),
              },
            }
          : {}),
        ...(config.kernelPass ? { kernelPass: config.kernelPass } : {}),
      });
    }

    // ── 4. Execute + observe (shared core) ───────────────────────────────────
    yield* emitLog({ _tag: "tool_call", tool: toolName, iteration: ctx.iteration, timestamp: new Date() });
    const startMs = Date.now();
    const exec = yield* executeNativeToolCall(
      toolService.value,
      { id: ctx.callId, name: toolName, arguments: args },
      config.agentId ?? "reasoning-agent",
      config.sessionId ?? "reasoning-session",
      {
        ...(config.compression ? { compression: config.compression } : {}),
        ...(config.scratchpad ? { scratchpad: config.scratchpad } : {}),
        ...(config.profile ? { profile: config.profile } : {}),
        ...(config.preprocess ? { preprocess: config.preprocess } : {}),
      },
    );
    const durationMs = Date.now() - startMs;
    yield* emitLog({
      _tag: "tool_result",
      tool: toolName,
      duration: durationMs,
      status: exec.success ? "success" : "error",
      ...(exec.success ? {} : { error: exec.content.slice(0, 120) }),
      timestamp: new Date(),
    });

    // ── 5. Emit ToolCallCompleted (plan-execute path only) ───────────────────
    if (config.emitToolCallEvents && config.eventBus) {
      yield* publishReasoningStep(config.eventBus, {
        _tag: "ToolCallCompleted",
        taskId: config.taskId ?? "reasoning",
        toolName,
        callId: ctx.callId,
        durationMs,
        success: exec.success,
        ...(config.kernelPass ? { kernelPass: config.kernelPass } : {}),
        args,
        ...(exec.success ? { result: exec.content } : { error: exec.content }),
      });
    }

    // ── 6. Error-recovery guidance (config-bound) ────────────────────────────
    let obsContent = exec.content;
    if (!exec.success && config.errorRecovery) {
      const recovery = config.errorRecovery(toolName, exec.content);
      if (recovery) obsContent = `${exec.content}\n\n[Recovery guidance: ${recovery}]`;
    }

    // ── 7. LLM fact extraction (kernel shouldExtract path) ───────────────────
    if (exec.success && config.extractFactsLLM) {
      const extracted = yield* extractObservationFacts(
        toolName,
        exec.content,
        args,
        config.compression?.budget ?? 800,
      );
      if (extracted) obsContent = `[${toolName} result — key facts]\n${extracted}`;
    }

    // ── 8. strip dead storage hints (plan-execute display path) ──────────────
    const displayContent = config.stripDeadStorageHints
      ? config.stripDeadStorageHints(obsContent, toolName)
      : obsContent;

    // ── 9. Build the observation step — metadata guaranteed ──────────────────
    const obsStep = makeStep("observation", displayContent, {
      toolCallId: ctx.callId,
      ...(exec.storedKey ? { storedKey: exec.storedKey } : {}),
      ...(exec.extractedFact ? { extractedFact: exec.extractedFact } : {}),
      observationResult: makeObservationResult(toolName, exec.success, displayContent, {
        ...(exec.delegatedToolsUsed ? { delegatedToolsUsed: exec.delegatedToolsUsed } : {}),
      }),
    });

    // ── 10. Compose tags ─────────────────────────────────────────────────────
    yield* emitToCompose(config.pipeline, "observation.tool-result", obsStep, {
      iteration: ctx.iteration,
      phase: "act",
      state: ctx.state,
      strategy: ctx.strategy,
      toolName,
      callId: ctx.callId,
      healed,
      durationMs,
    });
    if (!exec.success) {
      yield* emitToCompose(config.pipeline, "lifecycle.failure", {
        reason: "tool-error",
        errorMessage: exec.content,
        attemptNumber: ctx.iteration,
        failureStreak: 1,
        currentStrategy: ctx.strategy,
      }, {
        iteration: ctx.iteration,
        phase: "act",
        state: ctx.state,
        strategy: ctx.strategy,
      });
    }

    return {
      obsStep,
      content: displayContent,
      success: exec.success,
      ...(exec.storedKey ? { storedKey: exec.storedKey } : {}),
      ...(exec.delegatedToolsUsed ? { delegatedToolsUsed: exec.delegatedToolsUsed } : {}),
      ...(exec.extractedFact ? { extractedFact: exec.extractedFact } : {}),
      durationMs,
      healed,
    } satisfies ToolObserveResult;
  });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `bunx turbo run build --filter=@reactive-agents/reasoning`
Expected: build PASS. If `publishReasoningStep`'s event union rejects the `args`/`result` fields on `ToolCallCompleted`, copy the exact spread shape used in `step-executor.ts:206-216` (it already emits these fields). If `StrategyServices["eventBus"]` is not exported, import `StrategyServices` from `../../utils/service-utils.js` (it is — `step-executor.ts:36`).

- [ ] **Step 3: Commit**

```bash
git add packages/reasoning/src/kernel/capabilities/act/tool-observe.ts
git commit -m "feat(reasoning): add executeToolAndObserve canonical tool-execution primitive"
```

---

## Task A3: Unit tests for the primitive

**Files:**
- Create: `packages/reasoning/tests/kernel/act/tool-observe.test.ts`

Use a stub `ToolService` and a recording `HarnessPipeline` (`new HarnessPipeline()` from `@reactive-agents/core` with a registered `.on`/`.tap`). Follow `agent-tdd` skill: every `bun test` invocation needs an explicit `--timeout`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "bun:test";
import { Effect, Option } from "effect";
import { HarnessPipeline } from "@reactive-agents/core";
import { executeToolAndObserve } from "../../../src/kernel/capabilities/act/tool-observe.js";
import type { KernelStateLike } from "../../../src/kernel/utils/diagnostics.js";

const syntheticState: KernelStateLike = {
  status: "acting",
  steps: [],
  toolsUsed: new Set<string>(),
};

// Minimal ToolService stub: echoes args, success=true unless toolName === "boom".
function stubToolService(): any {
  return {
    _tag: "Some",
    value: {
      execute: (req: { toolName: string }) =>
        req.toolName === "boom"
          ? Effect.fail(new Error("kaboom"))
          : Effect.succeed({ success: true, result: { ok: req.toolName } }),
      getTool: () => Effect.fail(new Error("no schema")),
    },
  };
}

// Run an Effect that requires LLMService — provide a no-op since extractFactsLLM is off.
const runNoLLM = <A>(eff: Effect.Effect<A, never, any>): Promise<A> =>
  Effect.runPromise(eff as Effect.Effect<A, never, never>);

describe("executeToolAndObserve", () => {
  it("fires observation.tool-result through the pipeline", async () => {
    const pipeline = new HarnessPipeline();
    const seen: string[] = [];
    pipeline.tap("observation.tool-result", (step: any) => {
      seen.push(step.observationResult?.toolName ?? "?");
    });

    const result = await runNoLLM(
      executeToolAndObserve(
        stubToolService(),
        { toolName: "web-search", args: { query: "x" } },
        { iteration: 1, phase: "act", strategy: "react", state: syntheticState, callId: "c1" },
        { pipeline, extractFactsLLM: false },
      ),
    );

    expect(result.success).toBe(true);
    expect(seen).toEqual(["web-search"]);
    expect(result.obsStep.metadata?.observationResult?.toolName).toBe("web-search");
    expect(result.obsStep.metadata?.toolCallId).toBe("c1");
  });

  it("fires lifecycle.failure on tool error", async () => {
    const pipeline = new HarnessPipeline();
    let failurePayload: any;
    pipeline.tap("lifecycle.failure", (p: any) => { failurePayload = p; });

    const result = await runNoLLM(
      executeToolAndObserve(
        stubToolService(),
        { toolName: "boom", args: {} },
        { iteration: 2, phase: "act", strategy: "react", state: syntheticState, callId: "c2" },
        { pipeline, extractFactsLLM: false },
      ),
    );

    expect(result.success).toBe(false);
    expect(failurePayload?.reason).toBe("tool-error");
  });

  it("no-ops tag emission when pipeline is absent (still builds obsStep)", async () => {
    const result = await runNoLLM(
      executeToolAndObserve(
        stubToolService(),
        { toolName: "web-search", args: { query: "x" } },
        { iteration: 1, phase: "act", strategy: "react", state: syntheticState, callId: "c3" },
        { extractFactsLLM: false },
      ),
    );
    expect(result.obsStep.type).toBe("observation");
    expect(result.success).toBe(true);
  });

  it("returns a failed observation when ToolService is None", async () => {
    const result = await runNoLLM(
      executeToolAndObserve(
        { _tag: "None" } as any,
        { toolName: "web-search", args: {} },
        { iteration: 1, phase: "act", strategy: "react", state: syntheticState, callId: "c4" },
        { extractFactsLLM: false },
      ),
    );
    expect(result.success).toBe(false);
    expect(result.content).toContain("ToolService is not available");
  });
});
```

- [ ] **Step 2: Run to verify they fail (then pass)**

Run: `cd packages/reasoning && bun test tests/kernel/act/tool-observe.test.ts --timeout 20000`
Expected: PASS (the primitive already exists from A2). If `HarnessPipeline` lacks a public `.tap`/`.on` with this arity, mirror the exact registration used in `packages/reasoning/tests/strategies/strategy-threading.test.ts` (it constructs a real `HarnessPipeline` and registers hooks — copy that pattern).

- [ ] **Step 3: Commit**

```bash
git add packages/reasoning/tests/kernel/act/tool-observe.test.ts
git commit -m "test(reasoning): unit tests for executeToolAndObserve primitive"
```

> **End of Phase A (kernel-warden).** Gate: `bun test tests/kernel/act/tool-observe.test.ts --timeout 20000` green; `bunx turbo run build --filter=@reactive-agents/reasoning` green. UpwardReport.

---

## Task B1: Golden-master equivalence test for the kernel single path

**Files:**
- Create: `packages/reasoning/tests/kernel/act/act-single-equivalence.test.ts`

Authored BEFORE the migration, asserting current `handleActing` single-call output (obsStep fields + emitted `observation.tool-result` payload). Kept green through B2 → proves byte-identical.

- [ ] **Step 1: Write the golden-master test**

Drive `handleActing` with a `KernelState` carrying one pending native tool call and a recording `HarnessPipeline`, then assert the captured obsStep + tag payload. Construct state/context via the same fixtures the existing kernel tests use — locate them first:

Run: `rg -l "handleActing" packages/reasoning/tests`
Then model the new test on the closest existing `handleActing` harness. Assertions to lock:

```ts
// Capture the observation.tool-result payload + the obsStep on the returned state.
expect(captured.length).toBe(1);
const step = capturedStep; // the obsStep passed to observation.tool-result
expect(step.type).toBe("observation");
expect(step.metadata?.toolCallId).toBe(/* the tc.id used */);
expect(step.metadata?.observationResult?.toolName).toBe(/* tool name */);
expect(step.metadata?.observationResult?.success).toBe(true);
// Single path attaches NO verification today — pin that so Phase E is a visible change:
expect(step.metadata?.verification).toBeUndefined();
// ctx fields:
expect(capturedCtx.healed).toBe(false);
expect(typeof capturedCtx.durationMs).toBe("number");
```

If standing up a full `handleActing` fixture is heavy, the minimum viable golden-master is: register `tap("observation.tool-result")` on the pipeline, run one tool call end-to-end, snapshot `step.metadata` (minus the ulid `id` and `timestamp`) with `expect(...).toMatchObject({...})`.

- [ ] **Step 2: Run to verify it passes against CURRENT act.ts**

Run: `cd packages/reasoning && bun test tests/kernel/act/act-single-equivalence.test.ts --timeout 30000`
Expected: PASS (it codifies present behavior). This is the baseline.

- [ ] **Step 3: Commit**

```bash
git add packages/reasoning/tests/kernel/act/act-single-equivalence.test.ts
git commit -m "test(reasoning): golden-master for kernel act single-call observation"
```

---

## Task B2: Migrate the kernel single path to the primitive

**Files:**
- Modify: `packages/reasoning/src/kernel/capabilities/act/act.ts:697-814`

- [ ] **Step 1: Add the import**

At the top of `act.ts`, beside the existing `executeNativeToolCall` import (`:23`):

```ts
import { executeToolAndObserve } from "./tool-observe.js";
```

- [ ] **Step 2: Replace the single-call execute-and-observe block**

Replace the block from `:697` (`yield* emitLog({ _tag: "tool_call", tool: tc.name, ... })`) through `:810` (the closing of the `lifecycle.failure` `emitToCompose`) — i.e. everything between the `toolService._tag === "None"` early-continue (`:695`) and `allSteps = [...allSteps, obsStep];` (`:812`) — with:

```ts
        // Pre-computed missing-required-tools for the adapter's error-recovery.
        const missingRequiredTools = getEffectiveMissingRequiredTools(
          allSteps,
          input.requiredTools ?? [],
          input.requiredToolQuantities,
        );

        const observe = yield* executeToolAndObserve(
          toolService,
          {
            toolName: tc.name,
            arguments: tc.arguments as Record<string, unknown>,
          } as never as { toolName: string; args: Record<string, unknown>; rationale?: { why: string; confidence?: number } },
          {
            iteration: state.iteration,
            phase: "act",
            strategy: state.strategy ?? "react",
            state: asKernelStateLike(state),
            callId: tc.id,
            // Healing already ran upstream (act.ts:221). Pass the precomputed flag.
            healed: healResult.succeeded && healResult.call !== rawTc,
          },
          {
            compression,
            profile,
            scratchpad: sharedScratchpad,
            extractFactsLLM: shouldExtract,
            pipeline,
            errorRecovery: (toolName, errorContent) =>
              adapter.errorRecovery?.({
                toolName,
                errorContent,
                missingTools: missingRequiredTools,
                tier: profile.tier ?? "mid",
              }),
            agentId: input.agentId,
            sessionId: input.sessionId,
            emitLog,
            // emitToolCallEvents stays FALSE — hooks.onObservation emits them.
          },
        );

        // Update action step with duration (kernel orchestration, stays here).
        const lastActionIdx = allSteps.length - 1;
        const lastAction = allSteps[lastActionIdx];
        if (lastAction) {
          allSteps[lastActionIdx] = {
            ...lastAction,
            metadata: { ...(lastAction.metadata ?? {}), duration: observe.durationMs },
          };
        }

        if (observe.success) {
          for (const delegatedTool of observe.delegatedToolsUsed ?? []) {
            newToolsUsed.add(delegatedTool);
          }
        }

        const obsStep = observe.obsStep;

        yield* hooks.onObservation(
          transitionState(state, { steps: allSteps }),
          observe.content,
          observe.success,
        );
```

> **Important — fix the `args` field name.** The primitive's `call` param uses `args`, not `arguments`. Write it cleanly (drop the `as never` cast shown above — that was only to flag the rename):
> ```ts
> { toolName: tc.name, args: tc.arguments as Record<string, unknown> },
> ```
> The `as never` line above is a deliberate placeholder so this step's reviewer notices the rename; the engineer MUST replace it with the clean form. No `as never`/`as any` may survive (project rule: clean types).

The trailing `allSteps = [...allSteps, obsStep];` and the `lastMetaToolCall = undefined; consecutiveMetaToolCount = 0;` lines (`:812-814`) stay unchanged after this block.

- [ ] **Step 3: Verify the golden-master still passes (byte-identical)**

Run: `cd packages/reasoning && bun test tests/kernel/act/act-single-equivalence.test.ts --timeout 30000`
Expected: PASS unchanged. If it fails, the migration diverged — fix the config until identical (do NOT relax the test). Per spec §6: if exact equivalence can't be reached, the migration is rejected, not forced.

- [ ] **Step 4: Verify the build + dead-code check**

Run: `bunx turbo run build --filter=@reactive-agents/reasoning`
Expected: PASS. If `extractObservationFacts` / `defaultVerifier` imports in act.ts are now unused by the single path but still used by the batch path (`:582`, `:600`), leave them. If genuinely unused, remove the import to keep the build clean.

- [ ] **Step 5: Run the full reasoning suite (regression floor)**

Run: `cd packages/reasoning && bun test --timeout 60000`
Expected: same pass count as baseline (~1617/0). Investigate ANY new failure before proceeding.

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/kernel/capabilities/act/act.ts
git commit -m "refactor(reasoning): route kernel act single path through executeToolAndObserve"
```

> **End of Phase B (kernel-warden).** Gate: golden-master green + full reasoning suite at baseline. UpwardReport.

---

## Task C1: Integration test for plan-execute `tool_call` observation

**Files:**
- Create: `packages/reasoning/tests/strategies/plan-execute-tool-observe.test.ts`

RED first — written against the CURRENT step-executor (where `.on('observation.tool-result')` fires 0×), so it fails until C2 lands.

- [ ] **Step 1: Write the failing integration test**

Use the deterministic `test` provider + a planner forced to emit a `tool_call` step. Model the harness on the existing `packages/reasoning/tests/strategies/strategy-threading.test.ts` (it already wires a real `HarnessPipeline` + plan-execute). Assertions:

```ts
// 1. observation.tool-result fires at least once on a tool_call step.
expect(observationTagFireCount).toBeGreaterThanOrEqual(1);
// 2. healing applies: feed a misspelled tool name → recovered + executed.
expect(executedToolName).toBe("web-search"); // from e.g. "websearch"
// 3. obs-step metadata populated.
expect(lastObsStep.metadata?.observationResult?.success).toBe(true);
expect(lastObsStep.metadata?.observationResult?.toolName).toBe("web-search");
// 4. opt-outs hold: no verifier metadata, no semantic-memory write.
expect(lastObsStep.metadata?.verification).toBeUndefined();
```

For assertion 4's "no semantic-memory write": provide NO `MemoryService` layer to the run, and assert the run resolves without requiring it (a memory write would change the `R` channel / fail to provide).

- [ ] **Step 2: Run to verify it FAILS against current step-executor**

Run: `cd packages/reasoning && bun test tests/strategies/plan-execute-tool-observe.test.ts --timeout 30000`
Expected: FAIL on assertion 1 (`observationTagFireCount` is 0) — confirms the bug.

- [ ] **Step 3: Commit the failing test**

```bash
git add packages/reasoning/tests/strategies/plan-execute-tool-observe.test.ts
git commit -m "test(reasoning): RED — plan-execute tool_call must fire observation.tool-result"
```

---

## Task C2: Migrate the plan-execute `tool_call` branch to the primitive

**Files:**
- Modify: `packages/reasoning/src/strategies/plan-execute/step-executor.ts:121-258`
- Modify: `packages/reasoning/src/strategies/plan-execute.ts` (the `:763` obs-step build for tool_call results — locate exact line in step 4)

- [ ] **Step 1: Add imports to step-executor.ts**

Beside the existing imports (`:25-46`):

```ts
import { executeToolAndObserve } from "../../kernel/capabilities/act/tool-observe.js";
// ⚠️ PHASE-A FINDING: the primitive's ctx.state is typed against the CORE
// KernelStateLike (emitToCompose's ContextFor<T> demands the fuller shape).
// Import the core type, NOT kernel/utils/diagnostics.js.
import type { KernelStateLike } from "@reactive-agents/core";
```

Add the file-tool-names set used for healing (mirror `act.ts:58`) near the top of the module:

```ts
/** File tools whose relative paths the healing pipeline resolves. */
const FILE_TOOL_NAMES = new Set(["file-read", "file-write", "code-execute", "shell-execute"]);
```

- [ ] **Step 2: Replace the `tool_call` branch body**

Replace the entire `Effect.gen` body of the `if (step.type === "tool_call" && step.toolName && toolService._tag === "Some")` block (`:125-257`) with:

```ts
    return Effect.gen(function* () {
      const rawArgs = step.toolArgs ?? {};
      const resolvedArgs = resolveStepReferences(rawArgs, completedSteps);

      // Strip remaining unresolved {{from_step:sN}} refs (self-ref/missing step)
      // so circular references don't trigger infinite retry loops.
      for (const [key, value] of Object.entries(resolvedArgs)) {
        if (typeof value === "string" && /\{\{from_step:s\d+\}\}/.test(value)) {
          resolvedArgs[key] = value.replace(/\{\{from_step:s\d+(?::summary)?\}\}/g, "");
        }
      }

      // Synthetic KernelStateLike (CORE shape — emitToCompose's ContextFor<T>
      // requires all 11 fields; the diagnostics narrow shape TS-errors). plan-
      // execute has no KernelState, so build the minimal real fields — no cast.
      const syntheticState: KernelStateLike = {
        taskId: input.taskId ?? "plan-execute",
        strategy: "plan-execute",
        kernelType: "react",
        steps: completedSteps.map(() => ({ type: "observation" })),
        toolsUsed: new Set(
          completedSteps.map((s) => s.toolName).filter((n): n is string => !!n),
        ),
        iteration: stepIndex,
        tokens: 0,
        status: "acting",
        output: null,
        error: null,
        meta: {},
      };

      const observe = yield* executeToolAndObserve(
        toolService,
        {
          toolName: step.toolName!,
          args: resolvedArgs,
          ...(step.rationale && step.rationale.why
            ? {
                rationale: {
                  why: step.rationale.why,
                  ...(typeof step.rationale.confidence === "number"
                    ? { confidence: step.rationale.confidence }
                    : {}),
                },
              }
            : {}),
        },
        {
          iteration: stepIndex,
          phase: "act",
          strategy: "plan-execute",
          state: syntheticState,
          callId: `${plan.id}_${step.id}`,
        },
        {
          ...(input.resultCompression ? { compression: input.resultCompression } : {}),
          // Sanitize action-tool args/recipients out of the compressed preview
          // that feeds tool-less downstream prompts.
          preprocess: (raw) => sanitizeToolOutput(step.toolName!, raw, resolvedArgs),
          // Strip dead [STORED:]/recall() pointers — downstream prompts can't recall.
          stripDeadStorageHints,
          // Heal internally (kernel pre-heals; plan-execute didn't heal at all → gain it).
          heal: {
            schemas: input.availableToolSchemas ?? [],
            fileToolNames: FILE_TOOL_NAMES,
            cwd: process.cwd(),
          },
          pipeline: input.harnessPipeline,
          eventBus: services.eventBus,
          emitToolCallEvents: true,
          taskId: input.taskId ?? "plan-execute",
          kernelPass: `plan-execute:step-${stepIndex + 1}`,
          agentId: input.agentId,
          sessionId: input.sessionId,
          emitLog,
          // extractFactsLLM omitted (false) — parity-cheap; no LLM fact pass.
          // verifier / memoryService omitted — opt-out holds (Phase E only).
        },
      );

      return {
        output: observe.content,
        // Full sanitized data for the tool-less SYNTHESIS step. The primitive's
        // `content` is the compressed preview for intermediate prompts; synthesis
        // needs the complete data. Re-derive from the raw result via the same
        // sanitizer (see note below).
        fullResult: observe.fullResult ?? observe.content,
        tokens: 0,
        cost: 0,
        success: observe.success,
      } satisfies StepExecResult;
    });
```

> **Decision needed — `fullResult` plumbing.** Today plan-execute sets `fullResult: sanitized` (the FULL sanitized, uncompressed result) so synthesis renders every item. The primitive returns only the compressed `content`. To preserve the full-data synthesis path, add `fullResult` to `ToolObserveResult` and have the primitive surface the pre-compression sanitized content. **Implement this as step 3 below** (small additive change to the primitive). The `observe.fullResult ?? observe.content` fallback above is the safety net.

- [ ] **Step 3: Surface `fullResult` from the primitive**

In `tool-observe.ts` (Task A2 output), `executeNativeToolCall` already compresses internally and does not return the pre-compression content. Two options — pick the lower-risk:

**Option A (preferred, additive):** have `executeNativeToolCall` optionally return the pre-compression normalized content. It currently returns `{ content, success, storedKey, delegatedToolsUsed, extractedFact }`. Add `fullContent?: string` = the normalized (post-preprocess, pre-compress) string. Then in `executeToolAndObserve`, set `result.fullResult = exec.fullContent`. Update `ToolObserveResult` to include `readonly fullResult?: string`.

Concretely in `tool-execution.ts` `executeNativeToolCall`, capture before compression (`:688`):
```ts
        const fullContent = content; // post-normalize/preprocess, pre-compress
```
and add `fullContent` to the returned object (`:720`). This is kernel-warden territory — bundle it with the Phase A primitive work OR file a follow-up; until then the `?? observe.content` fallback keeps plan-execute functional (synthesis sees the compressed preview, a mild regression on very large results only).

> **For the executing agent:** if Phase A is already committed, fold this `fullContent` addition into a small kernel-warden follow-up commit before C2, so plan-execute synthesis keeps full-fidelity data. Do not ship C2 with the fallback as the permanent state if existing plan-execute large-result tests regress.

- [ ] **Step 4: Update the caller-side obs-step build in plan-execute.ts**

Locate where plan-execute.ts constructs an observation step from a `tool_call` `StepExecResult` (the spec cites `:763`):

Run: `rg -n "makeStep\\(\"observation\"|StepExecResult|executeStep\\(" packages/reasoning/src/strategies/plan-execute.ts`

If plan-execute.ts rebuilds an observation step for the tool result, replace that construction to consume the step produced inside the primitive. **If `StepExecResult` does not currently carry the obsStep**, the cleanest path is: the outer loop already records `step.result = output`; the canonical obsStep now lives inside the primitive and is already emitted via Compose, so the outer loop needs NO obsStep rebuild for observation purposes. Confirm by reading the call site; if it only uses `output`/`fullResult`/`success`, this step is a no-op and the migration is complete at the executor boundary. Document the finding inline in the commit message.

- [ ] **Step 5: Run the integration test (now GREEN)**

Run: `cd packages/reasoning && bun test tests/strategies/plan-execute-tool-observe.test.ts --timeout 30000`
Expected: PASS — `observation.tool-result` fires ≥1, healing applies, opt-outs hold.

- [ ] **Step 6: Run the full plan-execute + reasoning suite (regression floor)**

Run: `cd packages/reasoning && bun test --timeout 60000`
Expected: baseline pass count. Pay special attention to existing plan-execute tests (the 35KB suite) — large-result rendering, sanitization, and `fullResult` synthesis paths.

- [ ] **Step 7: Commit**

```bash
git add packages/reasoning/src/strategies/plan-execute/step-executor.ts packages/reasoning/src/strategies/plan-execute.ts
git commit -m "fix(reasoning): route plan-execute tool_call through executeToolAndObserve (#195)"
```

---

## Task D1: Live verification

**Files:** none (manual probe)

- [ ] **Step 1: Run a live plan-execute-reflect probe with a registered `.on()` hook**

Construct a tiny script (or reuse an existing probe harness under `packages/reasoning` examples) that builds a plan-execute-reflect agent against a local Ollama model, registers `.withHarness(h => h.on('observation.tool-result', s => { fired++; return s; }))`, gives it a task that forces a `tool_call` step (e.g. web-search), and runs it.

Run it and confirm `fired > 0` (was 0 before this work).

- [ ] **Step 2: Capture the evidence**

Record the before (0) / after (>0) fire count + token counts in the debrief. If the local model is unavailable, document that and fall back to the deterministic `test`-provider integration test from C1 as the proof of behavior.

---

## Task D2: Close FM-I and update docs

**Files:**
- Modify: `wiki/Failure-Modes/FM-I Strategy Kernel-Input Divergence.md`

- [ ] **Step 1: Mark the tool_call sub-gap resolved**

Update the FM-I status section: the `tool_call` direct-dispatch path now routes through `executeToolAndObserve`, so Compose hooks (`observation.tool-result`/`lifecycle.failure`), healing, and guaranteed observation metadata apply. Reference the integration test + live evidence. Note the remaining `analysis`-step path is intentionally out of scope (no tool to observe).

- [ ] **Step 2: Spec status → implemented**

In `wiki/Architecture/Design-Specs/2026-06-11-canonical-tool-execution-spec.md`, change frontmatter `status: proposed` → `status: implemented (Phases A–D)`, and add a one-line note that verifier/memory unification is tracked as Phase E.

- [ ] **Step 3: Commit**

```bash
git add "wiki/Failure-Modes/FM-I Strategy Kernel-Input Divergence.md" wiki/Architecture/Design-Specs/2026-06-11-canonical-tool-execution-spec.md
git commit -m "docs(reasoning): close FM-I tool_call sub-gap; canonical tool-observe shipped"
```

> **End of Phases C+D (main-thread).** The user-reported bug is fixed. Phase E is an optional, separately-reviewable follow-up.

---

## Phase E — SHIPPED (E1 default-on) + BENCHED (E2 opt-in, default-off) — 2026-06-11

**Implemented as a safer split than the original Task E1 below:**
- **E1 (default-on, shipped `b0219b50`):** kernel batch act path now emits `observation.tool-result` + `lifecycle.failure` per parallel call (surgical inline emit, mirrors single path). Parallel tool-results were invisible to `.on()`/`.tap()` — same bug class as #195. Pure win.
- **E2 (opt-in, default-off, shipped `b0219b50`):** `executeToolAndObserve` extended with optional `verifier`/`verifierContext`/`memoryService`; the single act path opts in only under `RA_TOOL_OBSERVE_SYMMETRY=1`. Default-off is byte-identical (Phase B golden-master green). Suite 1628/0.

**Live ablation bench (gemma4:12b, reactive, crypto-price, 3 runs/arm, interleaved):**

| arm | quality /4 | tokens | duration | ok-rate |
|---|---|---|---|---|
| baseline (off) | 4.00 | 6260 | 29.9s | 0/3 |
| treatment (sym=1) | 4.00 | 6293 (+0.5%) | 17.3s (noise) | 0/3 |

Δ quality +0.00, Δ tokens +0.5% (≤15% cap), duration neutral (baseline run1 cold-start skewed it). `ok=false` both arms = pre-existing evidence-grounding verifier rejecting an ungrounded paraphrased price, NOT an E2 effect.

**Decision (project lift rule):** parity on quality + tokens, **no measured single-run lift → E2 stays OPT-IN (default-off)**. Its real gains (cross-session tool-memory recall, per-tool arbitration signal) are latent and not capturable in a single run.

**Follow-up #2 — multi-model local ablation (2026-06-11):** extended the bench to 3 local models. **E2 = parity on all three**, no regression:

| model | Δ quality | Δ tokens | verdict |
|---|---|---|---|
| gemma4:12b (n=3) | +0.00 | +0.5% | parity |
| qwen3.5:latest (n=4) | ~0 (3/4 strict both arms, identical outputs) | ~0 | parity |
| cogito:8b (n=2) | +0.00 | −27% | parity |

A first-pass n=2 run flagged qwen3.5 at −2.00 quality; an n=4 deep-dive proved it a **witness artifact** (bare-number outputs like `$62,578` scored 0 by a btc-word-AND-price regex) + small-n noise — both arms produced identical answers. No E2 regression.

**Full CROSS-TIER ablation (2026-06-11) — RAN, E2 = parity on every tier, OPT-IN confirmed.** (Keys are present in `.env`, auto-loaded by bun; an earlier `echo $VAR` check looked at the shell env, not `.env` — corrected.) reactive, crypto-price, 3 runs/arm:

| tier | model | success lift | priceOk (real answer) | tokens |
|---|---|---|---|---|
| local | gemma4:12b | +0pp (0→0) | 100% → 100% | −7.8% |
| frontier | claude-sonnet-4-6 | +0pp (0→0) | 100% → 100% | −11.5% |
| frontier | gpt-4o | +0pp (0→0) | 100% → 100% | +5.5% |

**Lift rule (≥3pp success lift AND ≤15% tokens → default-on): no tier clears ≥3pp → E2 stays OPT-IN.** Parity everywhere (real-answer correctness 100% both arms; tokens within ±12%). Side-finding (NOT E2, identical off/on): framework `metadata.success` is `0%` on ALL tiers incl. frontier — the evidence-grounding verifier uniformly rejects this crypto task's terminal answer (stated price not byte-matching the compressed tool obs). Floors the success metric but doesn't affect the E2 comparison. Worth a separate look as a possible over-strict evidence-grounding case on numeric tool results.

**Follow-up #1 (route batch fully through the primitive) — EVALUATED, DELIBERATELY NOT DONE (2026-06-11).** The batch path processes results in a **sequential** post-loop (`act.ts:541-630`) where `verification` (`:604` `priorSteps: allSteps, toolsUsed: newToolsUsed`) and `errorRecovery` (`:572` `missingTools` from `allSteps`) read state that is **mutated mid-loop** (each obsStep append grows `allSteps`; `newToolsUsed` accumulates). Moving these into the parallel per-call primitive (inside `Effect.all`) would snapshot the context at parallel-time → **different verification/error-recovery inputs = a behavior change**, not a byte-identical dedup. The execute-core is already shared (both call `executeNativeToolCall`); the batch's parallel-execute→sequential-observe orchestration is legitimately divergent (same "orchestration divergence is legitimate" principle, one level down). Per the no-metric-gaming / cohesion-over-LOC doctrine, forcing one-path here trades a real semantic hazard for cosmetic LOC. **Left intentionally.** The compose-emit gain already landed via E1.

**Follow-up: strategy compose-hook confirmation (2026-06-11) — ALL PASS.** Every strategy that runs a tool fires `observation.tool-result`:
- reactive — deterministic test `tests/strategies/strategy-compose-tags.test.ts` (TestLLM `toolCall` turn → kernel act → tap fires).
- plan-execute `tool_call` — Phase C deterministic + Phase D live.
- reflexion / tree-of-thought / adaptive — live probe (gemma4:12b, crypto-price): fired 1× each (`strat=reflexion` / `tree-of-thought` / `reactive`-via-adaptive). They route tools through the same kernel act phase (zero `toolService.execute` in those files), so Phase B's migration covers them; the live probe confirms end-to-end through real orchestration.

---

## Task E1 (ORIGINAL spec — superseded by the split above): Unify the kernel single/batch asymmetry

> This is a **behavior change**, deliberately isolated from the byte-identical migration. Today: the kernel **batch** path attaches `verification` + stores semantic memory but emits **no** Compose tags; the **single** path emits Compose tags but attaches **no** `verification` and stores **no** memory. After E, both kernel sites are symmetric: heal-aware, compose-emitting, verifier-attaching, memory-storing. **kernel-warden territory. Do NOT start without explicit user approval** (it changes externally-observable behavior — batch tool-results begin firing `.on('observation.tool-result')`).

**Files:**
- Modify: `packages/reasoning/src/kernel/capabilities/act/tool-observe.ts` (add `verifier` + `memoryService` config)
- Modify: `packages/reasoning/src/kernel/capabilities/act/act.ts:510-630` (batch path → primitive)
- Modify: `packages/reasoning/src/kernel/capabilities/act/act.ts` single-path call (add verifier+memory config)
- Create: `packages/reasoning/tests/kernel/act/act-symmetry.test.ts`

- [ ] **Step 1: Add verifier + memory to the primitive**

Extend `ToolObserveConfig` with:
```ts
  readonly verifier?: { verify: (ctx: unknown) => unknown };
  readonly verifierContext?: {
    readonly task: string;
    readonly priorSteps: readonly ReasoningStep[];
    readonly requiredTools?: readonly string[];
    readonly toolsUsed: ReadonlySet<string>;
  };
  readonly memoryService?: MaybeService<import("../../../kernel/state/kernel-state.js").MemoryServiceInstance>;
```
In the primitive, after building `obsStep` (step 9), if `config.verifier` + `config.verifierContext` are present, compute `verification = defaultVerifier.verify(contextFromObservation({ observation: obsResult, ... }))` and attach it to the obsStep metadata (mirror `act.ts:600-615`). Pass `config.memoryService` straight through to `executeNativeToolCall`'s `memoryService` (it already forks the daemon store).

- [ ] **Step 2: Write the symmetry test (RED)**

Assert that BOTH a single tool call and a 2-call batch, run through `handleActing`, fire `observation.tool-result` once per executed tool AND carry `verification` on every resulting obsStep. Against current code this fails for batch (no tag) and for single (no verification).

- [ ] **Step 3: Migrate the batch path** (`act.ts:510-630`) to call `executeToolAndObserve` per `executableCall`, passing `pipeline`, `verifier`+`verifierContext`, `memoryService`. Keep the parallel `Effect.all({ concurrency })` shape and the action-step duration/`actionIdx` bookkeeping in act.ts.

- [ ] **Step 4: Add verifier+memory to the single-path call** (the Task B2 config) so the single path also attaches verification + stores memory.

- [ ] **Step 5: Update the golden-master.** The Phase B `act-single-equivalence.test.ts` asserted `verification` is `undefined`. Update that assertion to expect a populated `verification` and document the intentional change in the commit. The symmetry test (E2) becomes the new gate.

- [ ] **Step 6: Full suite + commit**

Run: `cd packages/reasoning && bun test --timeout 60000`
```bash
git add packages/reasoning/src/kernel/capabilities/act/tool-observe.ts packages/reasoning/src/kernel/capabilities/act/act.ts packages/reasoning/tests/kernel/act/act-symmetry.test.ts
git commit -m "feat(reasoning): unify kernel single/batch tool-observation (verifier + memory + compose on both)"
```

---

## Self-Review

**Spec coverage:**
- Primitive `executeToolAndObserve` (spec §2) → Task A2. ✓
- Kernel act migration, equivalence-preserving (spec §3a) → Tasks B1+B2 (single path); batch path moved to E with rationale (spec under-specified the asymmetry). ✓ + documented refinement.
- plan-execute `tool_call` migration (spec §3b): `resolveStepReferences` retained, `scratchpad` absent (no store — `executeNativeToolCall` only stores when `scratchpad` passed; C2 omits it), `stripDeadStorageHints` ✓, `verifier`/`memory` off ✓, `pipeline`=`input.harnessPipeline` ✓, `eventBus` ✓, synthetic ctx ✓, `sanitizeToolOutput` via `preprocess` ✓ → Task C2. ✓
- Testing gates (spec §4): kernel equivalence (B1), plan-execute integration + healing + opt-out (C1), regression floor (B2/C2 step 6). ✓ Parallel-batch equivalence deferred to E (where the batch path actually changes).
- Phasing (spec §5): A/B kernel-warden, C/D main-thread; E added. ✓
- Risks (spec §6): hot-path regression (golden-master), Effect requirement creep (`MaybeService` params, `R = LLMService` only), synthetic state (minimal `KernelStateLike`, no `any`), plan-execute data-flow (`preprocess` + `fullResult` plumbing + full plan-execute suite). ✓

**Placeholder scan:** The single intentional placeholder is the `as never` cast in B2 step 2 — explicitly flagged as a rename marker the engineer MUST replace with the clean `{ toolName, args }` form (no `as never`/`as any` may survive). The `fullResult` plumbing (C2 step 3) is fully specified with a concrete `fullContent` capture line, not a TODO.

**Type consistency:** `executeToolAndObserve(toolService, call, ctx, config)` — `call` uses `args` (not `arguments`) consistently across A2, B2, C2. `ToolObserveResult` fields (`obsStep`, `content`, `success`, `storedKey`, `delegatedToolsUsed`, `durationMs`, `healed`, +`fullResult` from C2/E) are referenced consistently. `KernelStateLike` imported from `kernel/utils/diagnostics.js` in both A2 and C2. `emitToolCallEvents` false in kernel (B2), true in plan-execute (C2). `extractFactsLLM` = `shouldExtract` (kernel), omitted/false (plan-execute).

**Open decision carried to execution:** C2 step 3 `fullResult` — preferred Option A (additive `fullContent` from `executeNativeToolCall`). Confirm existing plan-execute large-result tests don't regress before accepting the `?? observe.content` fallback as permanent.

---

**Plan complete and saved to `wiki/Planning/Implementation-Plans/2026-06-11-canonical-tool-execution.md`.**
