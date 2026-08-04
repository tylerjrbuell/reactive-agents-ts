---
type: design-spec
status: implemented (Phases A–D, 2026-06-11)
created: 2026-06-11
tags: [canonical-path, tool-execution, plan-execute, kernel, spec, FM-I]
supersedes-analysis: 2026-06-11-canonical-tool-execution-analysis.md
---

# Spec: Canonical Tool-Execution-and-Observe Primitive

> **Implementation status (2026-06-11):** Phases A–D shipped to `main`. Primitive `executeToolAndObserve` built (`kernel/capabilities/act/tool-observe.ts`); kernel act single path migrated byte-identical (golden-master gated); plan-execute `tool_call` migrated (#195 fixed, live-verified). Full reasoning suite 1625/0. Verifier + semantic-memory were deferred out of the day-1 primitive into **Phase E** (optional, separately-reviewed): unifying the pre-existing kernel single/batch asymmetry — the batch path emits no Compose tags today and the single path attaches no verification / stores no memory. Plan: `wiki/Planning/Implementation-Plans/2026-06-11-canonical-tool-execution.md`.

> Design spec for collapsing the kernel act-phase tool handling and plan-execute's hand-rolled direct dispatch into ONE primitive. Analysis + scope rationale: [[2026-06-11-canonical-tool-execution-analysis]]. User decisions (2026-06-11): plan-execute adopts the **parity-cheap** capability set (verifier + semantic-memory stay off); execute via full-spec → plan → phased TDD.

## 1. Goal & non-goals

**Goal:** A single primitive `executeToolAndObserve` is the only way a single tool call is executed-and-observed in the reasoning package. Both the kernel act phase and plan-execute's `tool_call` direct dispatch call it. `observation.tool-result` (and siblings) fire identically regardless of dispatch path; healing and guaranteed observation metadata apply everywhere.

**Non-goals (anti-creep, from analysis §7):**
- No change to any strategy's **orchestration** (outer loops are legitimately divergent).
- No change to **code-action** (separate sandbox domain).
- `analysis` steps stay a direct `llm.complete` (no tool to observe).
- No forced LLM round-trips: `tool_call` stays direct dispatch.
- direct/reactive inline-literal tidy and `invokeRIDispatcher` are out of scope.

## 2. The primitive

Location: `packages/reasoning/src/kernel/capabilities/act/tool-observe.ts` (new). Kernel-warden territory.

```ts
export interface ToolObserveContext {
  readonly iteration: number;
  readonly phase: "act";
  readonly strategy: string;
  readonly state: KernelStateLike;   // kernel: real state; plan-execute: synthetic minimal view
  readonly callId: string;
}

export interface ToolObserveConfig {
  readonly compression?: ResultCompressionConfig;
  readonly profile?: ContextProfile;
  /** scratchpad present ⇒ auto-store compressed result; absent ⇒ no store. */
  readonly scratchpad?: Map<string, string>;
  /** Strip [STORED:]/recall() pointers from compressed content (plan-execute's
   *  tool-less downstream prompts). Default false (kernel keeps them). */
  readonly stripDeadStorageHints?: boolean;
  /** Opt-in heavy enrichments — OFF for plan-execute tool_call per decision. */
  readonly verifier?: Verifier;
  readonly memoryService?: MaybeService<MemoryServiceInstance>;
  /** Pipeline for compose-tag emission. Absent ⇒ tags no-op (still builds obs step + events). */
  readonly pipeline?: HarnessPipeline;
  readonly eventBus?: MaybeService<EventBusInstance>;
  /** Adapter error-recovery hook (kernel passes adapter; plan-execute may pass undefined). */
  readonly errorRecovery?: (toolName: string, error: string) => Effect.Effect<string | undefined>;
  readonly agentId?: string;
  readonly sessionId?: string;
}

export interface ToolObserveResult {
  readonly obsStep: ReasoningStep;          // observation step, metadata guaranteed
  readonly content: string;                  // compressed (+ optionally hint-stripped) display text
  readonly fullResult: string;               // sanitized, uncompressed (for synthesis)
  readonly success: boolean;
  readonly storedKey?: string;
  readonly observationResult: ObservationResult;
  readonly healed: boolean;
}

export function executeToolAndObserve(
  toolService: MaybeService<ToolServiceInstance>,
  call: { toolName: string; args: Record<string, unknown>; rationale?: { why: string; confidence?: number } },
  ctx: ToolObserveContext,
  config: ToolObserveConfig,
): Effect.Effect<ToolObserveResult, never, ...>
```

**Pipeline inside the primitive (single ordered flow):**
1. **Heal** the call (tool-name/param/path/type) via the healing pipeline. On unrecoverable → emit `nudge.healing-failure`, proceed with a failed observation.
2. **Execute** via the existing `executeNativeToolCall` core (pre-parsed args path).
3. **Fact-extract** deterministically (existing `extractFactDeterministic`).
4. **Compress** (existing `compressToolResult`) honoring `scratchpad` (store) + `stripDeadStorageHints`.
5. **Build observation step** via `makeStep("observation", …, { observationResult: makeObservationResult(…) })` — metadata guaranteed (closes gap #9).
6. **Emit events**: `ToolCallStarted` (with rationale) + `ToolCallCompleted` (duration, success, args, result) to `eventBus`.
7. **Emit compose tags**: `observation.tool-result` (always), `lifecycle.failure` (on error), via `emitToCompose(pipeline, …, ctx)`.
8. **Error-recovery guidance** (if `errorRecovery` provided + failure): enrich obs content.
9. **Optional**: verifier (if provided) → attach to obs metadata; semantic-memory daemon store (if `memoryService` provided).

Steps 1–7 + (8 when an `errorRecovery` hook is supplied) are the parity-cheap core; step 9 enrichments (verifier, semantic-memory) are opt-in and OFF for plan-execute tool_call. Scratchpad store within step 4 is itself config-gated (`scratchpad` present) — plan-execute leaves it absent to preserve its fullResult-string data flow.

## 3. Caller migrations

### 3a. Kernel act phase (`act.ts`) — equivalence-preserving

Replace the inline block (`~act.ts:673-815` single + `510-630` batch) that calls `executeNativeToolCall` then builds obsStep + emits tags, with a call to `executeToolAndObserve`. Config: `scratchpad` = kernel scratchpad (store ON), `stripDeadStorageHints: false`, `verifier` = kernel's, `memoryService` = kernel's, `pipeline` = harnessPipeline, `errorRecovery` = adapter hook. **Behavior must be byte-identical** — guarded by equivalence test (§4). Conversation-thread assembly + scratchpad sync stay in act.ts (kernel-specific, post-primitive).

### 3b. plan-execute `step-executor.ts` tool_call branch — gains parity-cheap

Replace the hand-rolled `123-257` (toolService.execute + manual events + compressToolResult + sanitize) with: `resolveStepReferences` (plan-specific, stays) → `executeToolAndObserve(...)`. Config: `scratchpad` absent (no store — keep fullResult string flow), `stripDeadStorageHints: true`, `verifier`/`memoryService` **undefined** (off per decision), `pipeline` = `input.harnessPipeline`, `eventBus` = services.eventBus. `errorRecovery`: adopted **if an adapter is resolvable in step-executor**, else `undefined` → graceful no-op (error-recovery guidance is adapter-driven, `act.ts:566-575`; plan-execute's tool_call has no adapter today). The parity-cheap wins that are unconditional for plan-execute are healing + compose tags + guaranteed obs-metadata + fact-extraction; error-recovery is best-effort pending adapter availability. Synthetic ctx: `{ iteration: stepIndex, phase: "act", strategy: "plan-execute", state: <minimal KernelStateLike from plan.id/stepIndex>, callId: \`${plan.id}_${step.id}\` }`. Map `ToolObserveResult` → existing `StepExecResult` (`output: content`, `fullResult`, `success`). `sanitizeToolOutput` stays as caller post-processing on `fullResult` (plan-specific). The caller-side obs-step construction in `plan-execute.ts:763` is replaced by `result.obsStep`.

## 4. Testing (gates)

1. **Kernel equivalence (hot-path guard):** snapshot the obsStep (content + all metadata fields) + the emitted compose-tag payloads for a fixed tool execution through `act.ts`, before and after the migration; assert deep-equal. Covers single + parallel-batch paths.
2. **plan-execute tool_call integration:** register `.on('observation.tool-result')`; run a plan with a `tool_call` step on the test provider; assert the hook fires ≥1 (currently 0). Assert healing applies (feed a misspelled tool name → recovered). Assert obs-step metadata (`observationResult.success`, `toolName`) populated.
3. **Parity-cheap-only assertion:** assert plan-execute tool_call does NOT run the verifier and does NOT call the memory daemon (the opt-out holds).
4. **Regression floor:** full reasoning suite (currently 1617) + the FM-I threading tests stay green.

## 5. Phasing

| Phase | Scope | Owner | Gate |
|---|---|---|---|
| **A** | Build `executeToolAndObserve` primitive + unit tests (heal→execute→observe→emit, each config branch) | kernel-warden | unit tests green; pure-where-possible |
| **B** | Migrate `act.ts` to the primitive (equivalence-preserving) | kernel-warden | equivalence test deep-equal; reasoning suite 1617/0 |
| **C** | Migrate plan-execute `step-executor.ts` tool_call branch | main-thread (strategies/ unmapped) | integration test: observation.tool-result fires; healing applies; opt-outs hold |
| **D** | Live verification (ollama plan-execute-reflect + `.on()` hook) + docs (FM-I status, close #195) | main-thread | live hook fires > 0 |

Phase A+B are the risky hot-path work (kernel-warden, equivalence-gated). C+D restore the user-reported behavior.

## 6. Risks & mitigations

- **Hot-path regression (act.ts):** equivalence test pins obsStep+tags byte-identical; full suite as floor. If equivalence can't be made exact (e.g. ordering), the migration is rejected, not forced.
- **Effect requirement creep:** the primitive's `R` channel must not pull new services into act.ts's signature. Mitigation: services passed as `MaybeService` params, not `Effect.service` requirements.
- **Synthetic KernelStateLike for plan-execute:** must satisfy what `message.tool-result`/`observation.tool-result` transforms read from ctx.state. Mitigation: audit transform consumers; provide the minimal real fields, never a cast-to-any.
- **plan-execute data-flow change:** `stripDeadStorageHints` + no-store preserved via config — equivalence with current plan-execute output validated by existing plan-execute tests (35KB test file).
