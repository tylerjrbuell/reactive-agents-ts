# Intelligent Context Synthesis (ICS)

**Date:** 2026-03-28
**Status:** Draft
**Scope:** New synthesis layer sitting between kernel state and LLM calls — replaces raw conversation thread delivery with phase-aware, signal-driven context construction optimized per model tier and task phase.

---

## Problem Statement

The current kernel hands the LLM a conversation thread at every iteration. That thread is either the raw accumulated `state.messages[]` or a sliding-window compaction of it. Both approaches share the same fundamental flaw: they deliver **historical context** when what the model actually needs is **situational context**.

A model mid-task doesn't need to see every prior turn. It needs to know:
1. What the goal is
2. What has been accomplished
3. What failed and can be skipped
4. What the single most important next action is

Delivering a growing conversation thread forces every model — especially smaller local models — to extract this signal from noise. The result is confused reasoning, empty end_turn responses, iteration explosions, and inconsistent task completion that no amount of adapter hooks can reliably fix.

The adapter pattern (`continuationHint`, `systemPromptPatch`) compensates for bad context. ICS prevents bad context from reaching the model in the first place.

**Observed failures this directly addresses:**
- cogito:14b exits after http-get 404 without calling file-write — model lost in noisy thread
- m5-tool-search fails on 4/5 providers — model answers from knowledge before tools run
- Multi-step tasks hit max iterations on local/mid models — thread accumulation overwhelms signal

---

## Architecture: Two Records + Synthesis Layer

### The Core Invariant

```
state.messages[]    ← immutable append-only transcript (never sent to model directly)
state.steps[]       ← observability record (entropy, metrics, debrief — unchanged)
SynthesizedContext  ← ephemeral, constructed per-iteration, consumed by LLM call
```

`state.messages[]` is the ground truth of what happened. It is permanent, auditable, replayable. It serves as the **source material** for synthesis but is never handed raw to the LLM.

`state.steps[]` is the observability record. All downstream systems (entropy sensor, metrics dashboard, debrief, learning engine, ExperienceStore) read from here. This is completely unchanged.

`SynthesizedContext` is constructed fresh each iteration from the transcript + framework signals. It is not stored in state across iterations — it is used once by `handleThinking` then discarded.

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      KERNEL ITERATION                           │
│                                                                 │
│  state.messages[]  ──────────────────────────────────────────── │
│  (immutable transcript)               │                         │
│                                       ▼                         │
│  EntropyScore, tier, taskPhase,  ContextSynthesizer             │
│  requiredTools, toolsUsed,   ──► .synthesize()                  │
│  lastErrors, iteration              │                           │
│                                       │                         │
│                         ┌─────────────┴─────────────┐           │
│                         ▼                           ▼           │
│                   fast path                   deep path         │
│                 (<1ms, pure fn)          (~300-500ms, LLM call) │
│                         │                           │           │
│                         └─────────────┬─────────────┘           │
│                                       ▼                         │
│                              SynthesizedContext                 │
│                              {messages, phase, reason}          │
│                                       │                         │
│                         ┌─────────────┴─────────────┐           │
│                         ▼                           ▼           │
│                      LLM call               EventBus.publish    │
│                    (consumed)              (ContextSynthesized) │
│                                                                 │
│  state.steps[]  ◄──── observability only (unchanged)            │
└─────────────────────────────────────────────────────────────────┘
```

### Observability — Synthesized Context Is Always Visible

The synthesized context is published to the EventBus as a `ContextSynthesized` event before the LLM call. This makes synthesis fully transparent for debugging, auditing, and reasoning gap analysis without polluting `KernelState`.

```typescript
interface ContextSynthesizedEvent {
  type: "ContextSynthesized";
  taskId: string;
  agentId: string;
  iteration: number;
  synthesisPath: "fast" | "deep";
  synthesisReason: string;          // e.g. "high entropy (0.73) + stalled trajectory"
  taskPhase: TaskPhase;
  estimatedTokens: number;
  messages: readonly LLMMessage[];  // exactly what the model received
  signalsSnapshot: {
    entropy: number | undefined;
    trajectoryShape: string | undefined;
    tier: ModelTier;
    requiredTools: readonly string[];
    toolsUsed: readonly string[];
    iteration: number;
    lastErrors: readonly string[];
  };
}
```

This event is picked up by the existing observability infrastructure. Debug verbosity surfaces it inline. The metrics dashboard can show "what the model was given at iteration N."

---

## Task Phase Classification

Task phase is detected deterministically from signals — no LLM call. It drives which synthesis template is applied.

```typescript
type TaskPhase =
  | "orient"      // iteration 0-1, no tools used yet — introduce task and tools
  | "gather"      // tools in use, required tools still outstanding — focus on next tool
  | "synthesize"  // all required tools called, output not yet produced — synthesize data
  | "produce"     // actively generating/writing output — support production
  | "verify";     // output produced, checking completeness — confirm done
```

**Classification logic** (pure function, `packages/reasoning/src/context/task-phase.ts`):

```typescript
export function classifyTaskPhase(signals: {
  iteration: number;
  toolsUsed: ReadonlySet<string>;
  requiredTools: readonly string[];
  steps: readonly ReasoningStep[];
}): TaskPhase {
  const missingRequired = signals.requiredTools.filter(t => !signals.toolsUsed.has(t));
  const hasWrittenOutput = signals.steps.some(s =>
    s.type === "observation" &&
    s.metadata?.observationResult?.success === true &&
    (s.metadata?.toolCall?.name?.includes("write") ||
     s.metadata?.toolCall?.name?.includes("file"))
  );

  if (signals.iteration <= 1 && signals.toolsUsed.size === 0) return "orient";
  if (missingRequired.length > 0) return "gather";
  if (hasWrittenOutput) return "verify";
  if (signals.requiredTools.length > 0 && missingRequired.length === 0) return "synthesize";
  return "produce";
}
```

---

## The Two Synthesis Paths

### Escalation Decision

```typescript
function shouldUseDeepSynthesis(input: SynthesisInput): boolean {
  if (input.synthesisConfig.mode === "fast") return false;
  if (input.synthesisConfig.mode === "deep") return true;

  // "auto" — escalate when signals indicate confusion or complexity
  const entropy = input.entropy?.composite ?? 0;
  const trajectory = input.entropy?.trajectory.shape;
  const iterationRatio = input.iteration / input.maxIterations;

  return (
    entropy > 0.6 ||
    trajectory === "stalled" ||
    trajectory === "oscillating" ||
    input.lastErrors.length > 0 ||
    (iterationRatio > 0.6 && !allRequiredToolsCalled(input))
  );
}
```

### Fast Path (deterministic, <1ms)

Phase-keyed templates that select what matters from the transcript and format it as a focused brief. Located in `packages/reasoning/src/context/synthesis-templates.ts`.

**Example: `gather` phase, mid-tier model, after web-search success + http-get 404:**

```
[user] Research AI trends and write findings to ./report.md

[tool_result: web-search]
  1. AI Agents Market 2026...
  2. Top Frameworks...
  [up to 5 results, compressed to tier budget]

[user] Phase: gather → produce
       Completed: web-search ✓
       Failed: http-get → 404 (skip this source — you have sufficient data)
       Required next: file-write
       Action: Call file-write now with path="./report.md" and your synthesis of the search results above.
```

Three messages. No noise. The situation status message is the synthesizer's primary output. It replaces the accumulated conversation thread with a focused directive that changes per phase and per iteration.

**Template structure per phase:**

| Phase | Always includes | Conditionally includes | Situation message focus |
|-------|----------------|----------------------|------------------------|
| `orient` | Task goal, available tools | Memory context | "What to do first" |
| `gather` | Task goal, last tool results | Prior results summary, errors | "What to call next" |
| `synthesize` | Task goal, compressed data | All tool results summary | "Synthesize now" |
| `produce` | Task goal, synthesis result | Prior attempts | "Write the output" |
| `verify` | Task goal, output summary | Quality criteria | "Confirm or fix" |

**Tier adaptation within templates:**

- `local`: Maximum compression, explicit single-action directive, no prior context
- `mid`: Compressed summary + last result full, clear directive
- `large`: Summary + last 2 results full, structured directive
- `frontier`: Summary + last 3 results full, minimal directive (trusts the model)

### Deep Path (LLM call, ~300-500ms)

Triggered by escalation decision. Makes a bounded structured call using the configured synthesis model (defaults to the executing model) at temperature 0.0.

**Synthesis prompt** (small, focused, ~200 input tokens):

```
You are a task progress synthesizer. Based on the task transcript below, produce a situation brief in JSON.

Task: {task}
Completed tools: {toolsUsed}
Failed tools: {errors}
Required but not yet called: {missingTools}
Iteration: {iteration}/{maxIterations}

Respond ONLY with JSON:
{
  "accomplished": "one sentence",
  "failed": "what failed and why (empty string if nothing)",
  "remaining": "what still needs to happen",
  "nextAction": "the single most important next call with specific arguments"
}
```

Max tokens: 150. The output feeds into the situation status message. The model executing the task never sees the synthesis prompt — only the brief it produced.

**Deep path timing:** Synthesis runs **after `handleActing` completes** — tool results must be finalized before synthesis can accurately describe what was accomplished. Synthesis starts immediately when acting ends, before `handleThinking` begins. `Effect.all` can parallelize synthesis with any independent post-acting work (scratchpad sync, EventBus publishing).

---

## The ContextSynthesizer Service

**Package:** `packages/reasoning/src/context/context-synthesizer.ts`

`ContextSynthesizerLive` is the default implementation. Users can substitute their own implementation via Effect-TS service substitution — the service tag is the extension point, not the configuration.

Built-in synthesis functions are exported for composition:

```typescript
// Exported for user composition
export { fastSynthesis } from "./synthesis-templates.js";
export { deepSynthesis } from "./context-synthesizer.js";
export type { SynthesisInput, SynthesizedContext, SynthesisStrategy, TaskPhase } from "./context-synthesizer.js";
```

```typescript
export class ContextSynthesizerService extends Context.Tag("ContextSynthesizer")<
  ContextSynthesizerService,
  {
    synthesize(input: SynthesisInput): Effect.Effect<SynthesizedContext, never, LLMService>;
  }
>() {}

export interface SynthesisInput {
  transcript: readonly KernelMessage[];
  task: string;
  taskPhase: TaskPhase;
  requiredTools: readonly string[];
  toolsUsed: ReadonlySet<string>;
  availableTools: readonly ToolSchema[];
  entropy: EntropyScore | undefined;
  iteration: number;
  maxIterations: number;
  lastErrors: readonly string[];
  tier: ModelTier;
  tokenBudget: number;
  synthesisConfig: SynthesisConfig;
}

export interface SynthesizedContext {
  messages: readonly LLMMessage[];       // what the model receives
  synthesisPath: "fast" | "deep";
  synthesisReason: string;
  taskPhase: TaskPhase;
  estimatedTokens: number;
  signalsSnapshot: SynthesisSignalsSnapshot;
}
```

`ContextSynthesizerLive` is the production implementation. It is composed into the runtime automatically by `createRuntime()` when `.withReasoning()` is called — no separate builder method needed.

---

## Synthesis Configuration

### Extension-First Design

The synthesis layer is built for composability and customization. The framework ships built-in implementations as exported functions so users can compose, replace, or extend them. This aligns with the control-first philosophy: the defaults work well for most cases, but specialized agents get a clean path to full control without forking the framework.

**Built-in synthesis functions are exported:**

```typescript
import { fastSynthesis, deepSynthesis } from "@reactive-agents/reasoning";

// Use framework defaults directly, or compose with your own logic
```

**`SynthesisStrategy` — the primary extension point:**

A synthesis strategy is a function that takes all framework signals and returns the exact messages the model will receive. When provided, it completely replaces the built-in fast/deep logic.

```typescript
type SynthesisStrategy = (
  input: SynthesisInput
) => Effect.Effect<readonly LLMMessage[], never, LLMService>;
```

**Configuration lives within `.withReasoning()`:**

```typescript
// Default — synthesis auto, best results out of the box
.withReasoning()

// Explicit opt-out — zero synthesis, pure speed
.withReasoning({ synthesis: "off" })

// Fast only — deterministic, no LLM calls
.withReasoning({ synthesis: "fast" })

// Deep always — maximum quality, pays latency
.withReasoning({ synthesis: "deep" })

// Custom synthesis model — cheap/fast model for synthesis
.withReasoning({ synthesis: "auto", synthesisModel: "gpt-4o-mini" })
.withReasoning({ synthesis: "auto", synthesisModel: "cogito:3b", synthesisProvider: "ollama" })

// Custom synthesis strategy — full control for specialized agents
.withReasoning({
  synthesis: "custom",
  synthesisStrategy: (input) => myDomainSynthesizer.synthesize(input),
})

// Compose with built-ins — override specific phases, delegate the rest
.withReasoning({
  synthesis: "custom",
  synthesisStrategy: (input) =>
    input.taskPhase === "gather" && input.tier === "local"
      ? myCustomGatherBrief(input)   // domain-specific gather brief
      : fastSynthesis(input),        // framework default for everything else
})

// Per-strategy override — inherits builder default, can override per strategy
.withReasoning({
  synthesis: "auto",
  strategies: {
    reactive: { synthesis: "deep" },
    planExecute: { synthesis: "fast" },
    reactive: {
      synthesis: "custom",
      synthesisStrategy: (input) => myReactiveStrategy(input),
    },
  }
})
```

**Resolution order:** strategy-level config → builder-level config → framework default (`"auto"`)

**`SynthesisConfig` type:**

```typescript
interface SynthesisConfig {
  mode: "auto" | "fast" | "deep" | "custom" | "off";
  model?: string;           // synthesis model (deep path, defaults to executing model)
  provider?: string;        // synthesis provider (deep path)
  temperature?: number;     // default: 0.0 for deterministic synthesis
  synthesisStrategy?: SynthesisStrategy;  // custom strategy, required when mode: "custom"
}
```

**Local tier deep path behavior:** When `mode: "auto"` and deep synthesis is triggered, but the executing model is `local` tier and no `synthesisModel` is configured, the system automatically falls back to `fast` path. A stuck local model should not synthesize its own confused state — this is a framework-managed default, not left to user configuration.

**Default behavior:** `mode: "auto"` — synthesis is on, fast path by default, deep path when signals justify it (entropy > 0.6, stalled/oscillating trajectory, errors present, late iteration with missing required tools). Local tier automatically uses fast path unless a separate synthesis model is configured.

---

## KernelState Changes

One new optional field on `KernelState`:

```typescript
interface KernelState {
  // ... all existing fields unchanged ...

  /**
   * Synthesized context for the next handleThinking call.
   * Set by kernel-runner after handleActing completes.
   * Consumed and cleared by handleThinking — never accumulated.
   * null after being consumed, undefined before first synthesis.
   */
  synthesizedContext?: SynthesizedContext | null;
}
```

This field is:
- Set by the kernel runner after `handleActing` returns
- Read once by `handleThinking` as the LLM message source
- Cleared (set to `null`) immediately after use in `handleThinking`
- Never accumulated — always single-use per iteration

`initialKernelState()` sets this to `undefined`.

---

## Integration Points

### kernel-runner.ts — Synthesis in the Loop

Synthesis runs in the main kernel loop after `handleActing` completes and before the next `handleThinking` call:

```typescript
// After state update from acting:
const synthesisConfig = effectiveInput.synthesisConfig ?? { mode: "auto" };
if (synthesisConfig.mode !== "off") {
  const synthesizerOpt = yield* Effect.serviceOption(ContextSynthesizerService);
  if (synthesizerOpt._tag === "Some") {
    const taskPhase = classifyTaskPhase({
      iteration: state.iteration,
      toolsUsed: state.toolsUsed,
      requiredTools: effectiveInput.requiredTools ?? [],
      steps: state.steps,
    });

    const synthesized = yield* synthesizerOpt.value.synthesize({
      transcript: state.messages,
      task: effectiveInput.task,
      taskPhase,
      requiredTools: effectiveInput.requiredTools ?? [],
      toolsUsed: state.toolsUsed,
      availableTools: effectiveInput.availableToolSchemas ?? [],
      entropy: (state.meta.entropy as any)?.latestScore,
      iteration: state.iteration,
      maxIterations: options.maxIterations,
      lastErrors: getLastErrors(state.steps),
      tier: profile.tier ?? "mid",
      tokenBudget: (8192 * (profile.contextBudgetPercent ?? 80)) / 100,
      synthesisConfig,
    });

    // Publish to EventBus for observability
    yield* hooks.onContextSynthesized?.(synthesized);

    // Inject into state for next handleThinking
    state = transitionState(state, { synthesizedContext: synthesized });
  }
}
```

### handleThinking — Consume Synthesized Context

`handleThinking` reads `state.synthesizedContext` if present, uses it as the LLM messages, then clears it:

```typescript
// In handleThinking (FC path), replace applyMessageWindow call:
let conversationMessages: LLMMessage[];

if (state.synthesizedContext) {
  // Use synthesized context — optimized for this specific iteration
  conversationMessages = [...state.synthesizedContext.messages];
  // Clear after use (synthesizedContext is single-use per iteration)
  state = transitionState(state, { synthesizedContext: null });
} else {
  // Fallback: sliding window compaction (legacy behavior, synthesis: "off" path)
  const compacted = applyMessageWindow(state.messages, profile);
  conversationMessages = compacted.map(toProviderMessage);
}
```

### Strategy Integration

**Reactive:** Full synthesis benefit — single continuous thread replaced by phase-aware briefs per iteration.

**Plan-Execute:** Synthesis runs at the sub-kernel level for each step. Each step's `executeReActKernel` call inherits the synthesis config from the parent kernel input. No changes required at the strategy level.

**Tree-of-Thought:** Synthesis runs at the execution phase entry — the best path context is synthesized from exploration results. The exploration phase (pure LLM branching) is unchanged.

**Reflexion:** Synthesis enhances the improvement pass — the critique text flows through synthesis to produce a focused improvement brief rather than raw transcript + critique text.

All strategies dispatch to `executeReActKernel` or `runKernel` unchanged. `SynthesisConfig` is threaded through `KernelInput`. No strategy-level code changes required for baseline integration.

---

## File Structure

```
packages/reasoning/src/context/
├── context-synthesizer.ts      ← ContextSynthesizerService + Live + deepSynthesis()
├── task-phase.ts               ← classifyTaskPhase() pure function
├── synthesis-templates.ts      ← fastSynthesis() + phase × tier templates (exported)
├── message-window.ts           ← existing (retained as synthesis input utility)
└── context-profile.ts          ← existing (unchanged)

packages/reasoning/src/
├── index.ts                    ← export: ContextSynthesizerService, fastSynthesis,
│                                  deepSynthesis, SynthesisInput, SynthesisStrategy,
│                                  SynthesizedContext, TaskPhase
└── strategies/shared/
    ├── kernel-runner.ts        ← synthesis injection in loop
    ├── kernel-state.ts         ← synthesizedContext field added
    └── react-kernel.ts         ← handleThinking reads synthesizedContext
```

---

## Success Criteria

### Task Completion Quality
- cogito:14b completes scratch.ts research+write task consistently (>90% of runs) with reactive strategy — no plan-execute routing required
- m5-tool-search benchmark: passes on all 5 providers (currently 4/5 fail)
- Multi-step tasks (3+ required tools) complete without iteration explosions on mid-tier models
- All existing `test.ts` scenarios pass unchanged (regression baseline)

### Token Efficiency
- Reactive strategy iterations 2+: 30-50% token reduction from dropping accumulated thread
- Deep synthesis overhead: ≤ 500 tokens per call (well below savings on 5+ iteration tasks)
- Net token budget: neutral-to-positive on tasks ≤ 5 iterations; positive on tasks ≥ 6

### Latency
- Fast path: ≤ 5ms added per iteration
- Deep path (same model): ≤ 600ms
- Deep path (separate synthesis model): ≤ 300ms

### Observability
- `ContextSynthesized` event published before every LLM call when synthesis is active
- Event includes full synthesized messages array, signals snapshot, phase, path, reason
- Debug verbosity surfaces synthesis decision inline in execution trace
- Synthesis path and reason visible in metrics dashboard

### Backward Compatibility
- `synthesis: "off"` preserves exact current behavior
- All public APIs unchanged (`AgentResult`, builder API, strategy interfaces)
- Existing test suite passes without modification

---

## Non-Goals

- Changing `state.steps[]` format or downstream observability systems
- Changing `AgentResult` public API
- Building a separate synthesis model/service — synthesis uses the configured model
- Synthesis for non-reasoning paths (direct LLM calls without `.withReasoning()`)
- Multi-agent fleet synthesis (future scope)

---

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Deep synthesis model call adds unacceptable latency | Low | User can pin to `fast`, default is `auto` (fast unless justified) |
| Fast path templates don't generalize to all task types | Medium | Templates are independently testable; start with 5 phases, expand as needed |
| Synthesis drops context the model actually needed | Low | `verify` phase keeps full output context; transcript retained for replay/debug |
| Deep synthesis produces worse brief than fast template | Low | Temperature 0.0, bounded output (150 tokens), structured JSON response |

---

## Open Questions (Resolved)

- **Prefetch synthesis?** No — synthesis requires complete tool results from `handleActing`. Starts immediately when acting ends.
- **Auto-loaded or opt-in?** Auto-loaded when `.withReasoning()` is called. Default `mode: "auto"`. Opt out with `synthesis: "off"`.
- **Per-strategy override?** Yes — `strategies.reactive.synthesis` etc. Resolution: strategy → builder → default.
- **Synthesis model?** Same model by default. Configure with `synthesisModel` + `synthesisProvider`.
- **Store synthesized context in state?** Single-use field `synthesizedContext` on `KernelState`, cleared after consumption. Not accumulated.
