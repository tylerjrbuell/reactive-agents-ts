# Kernel Optimization & Intelligent Termination

**Date:** 2026-03-20
**Status:** Approved design
**Scope:** `react-kernel.ts`, `kernel-runner.ts`, `execution-engine.ts`, `builder.ts`, prompts, sub-agent adapter, metrics
**Builds on:** Reactive Intelligence Pipeline (2026-03-14), Final Answer/Debrief/Chat (2026-03-09), v0.8.x Adoption Readiness

---

## Thesis

The framework has five distinct exit paths in a waterfall where the dumbest (50-character string length) runs before the smartest (entropy trajectory analysis with 5 calibrated signal sources). The reactive intelligence layer — which already knows when the model has converged — is opt-in and advisory. The result: a 97% pass rate on Anthropic Haiku degrades to 77% on Gemini Flash and 60% on Ollama models, not because those models are wrong, but because the framework rejects their correct answers.

This design inverts the trust model. The entropy sensor and reactive controller become the primary decision-makers. Hardcoded gates become safety nets. The framework gets smarter with every run as conformal calibration learns per-model thresholds. Every agent benefits from day one because reactive intelligence is default-on.

---

## Evidence: Cross-Provider Benchmark Analysis

Five providers tested (33 tests each, verbose output analyzed):

| Provider | Pass Rate | Key Failure Patterns |
|----------|-----------|---------------------|
| Anthropic Haiku 4.5 | 34/35 (97%) | Final answer extraction lost detail |
| OpenAI GPT-4o-mini | 31/35 (89%) | Conversational output, code discarded from final answer |
| Gemini 2.5 Flash | 27/35 (77%) | ALL 8 failures: correct short answers rejected by 50-char gate |
| Ollama cogito:14b | 23/35 (66%) | Answer-then-repeat (10/12), memory-flush overhead (8+) |
| Ollama qwen3:14b | 21/35 (60%) | Same as cogito + markdown FINAL ANSWER not recognized |

**Root causes (framework-wide):**

1. `end_turn` exit gate requires `thought.trim().length >= 50` AND `state.iteration >= 1` — rejects short correct answers and blocks first-iteration exits
2. No same-content detection — model repeats answer verbatim, framework loops
3. Entropy scoring runs AFTER exit checks — smart system never gets a vote
4. Reactive controller's early-stop is a flag for NEXT iteration — one iteration too late
5. `extractFinalAnswer()` discards code blocks from thought trace
6. Memory-flush runs 3-9s on every task regardless of complexity
7. Sub-agent tool schema mismatch wastes 1 iteration on every provider
8. Local models ignore final-answer tool; markdown variants not recognized

---

## Design Overview

Six sections, each addressing specific failure categories:

```
Section 1: Termination Oracle ─────── Replaces scattered exit logic with scored signal pipeline
Section 2: Output Assembly ─────────── Trace-aware output preserving code blocks
Section 3: Proportional Pipeline ──── RI default-on, complexity-based post-processing
Section 4: Prompt Improvements ────── Targeted fixes for model behavioral patterns
Section 5: Sub-Agent Fixes ─────────── Schema, lightweight defaults, name propagation
Section 6: Metrics & Testing ──────── LLM call counter, time multipliers, oracle test suite
```

---

## Section 1: Unified Termination Oracle

### Problem

Five distinct exit paths scattered across two functions in `react-kernel.ts` and the loop in `kernel-runner.ts`:

1. `hasFinalAnswer` regex in `handleThinking` (lines ~508-543)
2. `end_turn` with `length >= 50` + `iteration >= 1` gate in `handleThinking` (lines ~546-577)
3. `final-answer` tool accepted in `handleActing` (lines ~673-783)
4. Post-action FINAL ANSWER check in `handleActing` (lines ~878-903)
5. Max iterations exhausted in `kernel-runner.ts` loop condition

The oracle replaces exit paths 1, 2, and 4 in `handleThinking`. Exit path 3 (`final-answer` tool in `handleActing`) is preserved but its accept/reject logic feeds into the `FinalAnswerTool` evaluator. Exit path 5 remains as the kernel-runner loop boundary.

The 50-character string length check in path 2 runs before the entropy sensor scores the iteration.

### Architecture

A **scored signal pipeline**. Each signal is a typed evaluator that independently produces a verdict. The oracle collects all verdicts and resolves the highest-confidence decision.

**File:** `packages/reasoning/src/strategies/shared/termination-oracle.ts` (new)

### Types

```typescript
/**
 * Read-only snapshot of all information available for termination decisions.
 * Built by the kernel from its current state — evaluators cannot mutate it.
 */
interface TerminationContext {
  readonly thought: string;
  readonly thinking?: string;
  readonly stopReason: string;              // "end_turn" | "tool_call" | "max_tokens"
  readonly toolRequest: ToolRequest | null;
  readonly iteration: number;
  readonly steps: readonly ReasoningStep[];
  readonly priorThought?: string;           // previous iteration's output
  readonly entropy?: EntropyScore;
  readonly trajectory?: EntropyTrajectory;  // from @reactive-agents/reactive-intelligence
  readonly toolsUsed: ReadonlySet<string>;
  readonly requiredTools: readonly string[];
  readonly allToolSchemas: readonly ToolSchema[];
  readonly redirectCount: number;
  readonly priorFinalAnswerAttempts: number;
  readonly taskDescription: string;
  readonly controllerDecisions?: readonly ReactiveDecision[];  // from reactive controller evaluate()
}

/**
 * Each evaluator has a consistent shape: evaluate context, return verdict or null.
 * null means "I have no opinion" — the signal doesn't apply.
 */
interface TerminationSignalEvaluator {
  readonly name: string;
  readonly evaluate: (ctx: TerminationContext) => SignalVerdict | null;
}

interface SignalVerdict {
  readonly action: "exit" | "redirect" | "continue";
  readonly confidence: "high" | "medium" | "low";
  readonly reason: string;
  readonly output?: string;       // assembled output for "exit" verdicts
}

interface TerminationDecision {
  readonly shouldExit: boolean;
  readonly action: "exit" | "redirect" | "continue";
  readonly confidence: "high" | "medium" | "low";
  readonly reason: string;
  readonly evaluator: string;     // which evaluator produced the winning verdict
  readonly output?: string;
  readonly allVerdicts: ReadonlyArray<{ evaluator: string; verdict: SignalVerdict }>;  // observability
}
```

### Oracle Resolution Function

```typescript
function evaluateTermination(
  ctx: TerminationContext,
  evaluators: readonly TerminationSignalEvaluator[],
): TerminationDecision {
  const verdicts: Array<{ evaluator: string; verdict: SignalVerdict }> = [];

  for (const ev of evaluators) {
    const verdict = ev.evaluate(ctx);
    if (!verdict) continue;

    // Short-circuit: high-confidence exit — no need to check others
    if (verdict.action === "exit" && verdict.confidence === "high") {
      verdicts.push({ evaluator: ev.name, verdict });
      return { shouldExit: true, ...verdict, evaluator: ev.name, allVerdicts: verdicts };
    }

    // Short-circuit: high-confidence continue — stop evaluating, keep looping
    if (verdict.action === "continue" && verdict.confidence === "high") {
      verdicts.push({ evaluator: ev.name, verdict });
      return { shouldExit: false, ...verdict, evaluator: ev.name, allVerdicts: verdicts };
    }

    verdicts.push({ evaluator: ev.name, verdict });
  }

  // Collect exits and redirects, resolve by confidence
  const exits = verdicts.filter(v => v.verdict.action === "exit");
  const redirects = verdicts.filter(v => v.verdict.action === "redirect");

  // Compare best exit vs best redirect — highest confidence wins
  const bestExit = exits.sort((a, b) =>
    confidenceRank(b.verdict.confidence) - confidenceRank(a.verdict.confidence)
  )[0];
  const bestRedirect = redirects.sort((a, b) =>
    confidenceRank(b.verdict.confidence) - confidenceRank(a.verdict.confidence)
  )[0];

  if (bestExit && bestRedirect) {
    // If exit confidence >= redirect confidence, exit wins
    if (confidenceRank(bestExit.verdict.confidence) >= confidenceRank(bestRedirect.verdict.confidence)) {
      return { shouldExit: true, ...bestExit.verdict, evaluator: bestExit.evaluator, allVerdicts: verdicts };
    }
    return { shouldExit: false, ...bestRedirect.verdict, evaluator: bestRedirect.evaluator, allVerdicts: verdicts };
  }

  if (bestExit) {
    return { shouldExit: true, ...bestExit.verdict, evaluator: bestExit.evaluator, allVerdicts: verdicts };
  }

  if (bestRedirect) {
    return { shouldExit: false, ...bestRedirect.verdict, evaluator: bestRedirect.evaluator, allVerdicts: verdicts };
  }

  return {
    shouldExit: false,
    action: "continue",
    confidence: "low",
    reason: "no_exit_signal",
    evaluator: "none",
    allVerdicts: verdicts,
  };
}

function confidenceRank(c: "high" | "medium" | "low"): number {
  return c === "high" ? 3 : c === "medium" ? 2 : 1;
}
```

### Built-In Signal Evaluators

Ordered for short-circuit performance. Ordering does not affect correctness — each evaluator is independent.

#### 1. PendingToolCall

```typescript
// If the model wants to use a tool, never exit
evaluate(ctx): SignalVerdict | null {
  if (ctx.toolRequest) return { action: "continue", confidence: "high", reason: "tool_call_pending" };
  return null;
}
```

#### 2. FinalAnswerTool

```typescript
// Existing final-answer tool hard gate — preserved as highest-confidence exit
evaluate(ctx): SignalVerdict | null {
  // Detected via state machine transition in handleActing, not re-checked here.
  // This evaluator handles the case where the kernel identified a final-answer tool call.
  // The accept/reject logic (required tools, completion gaps) is preserved from the
  // existing implementation in react-kernel.ts lines 673-783.
  // Returns high-confidence exit when accepted.
}
```

#### 3. EntropyConvergence

```typescript
// Smart system: entropy trajectory says the model has converged
evaluate(ctx): SignalVerdict | null {
  if (!ctx.entropy || !ctx.trajectory) return null;
  if (ctx.stopReason !== "end_turn") return null;

  const converging = ctx.trajectory.shape === "converging" &&
    ctx.trajectory.derivative < -0.05;

  if (converging && ctx.thought.trim().length > 0) {
    return {
      action: "exit",
      confidence: "high",
      reason: "entropy_converged",
      output: ctx.thought.trim(),
    };
  }
  return null;
}
```

#### 3b. ReactiveControllerEarlyStop

```typescript
// Consumes the reactive controller's early-stop decision directly.
// The controller's evaluate() runs before the oracle (see Entropy Scoring Reorder).
// Its decision is passed into TerminationContext rather than setting a flag for next iteration.
evaluate(ctx): SignalVerdict | null {
  if (!ctx.controllerDecisions) return null;

  const earlyStop = ctx.controllerDecisions.find(d => d.decision === "early-stop");
  if (!earlyStop) return null;

  return {
    action: "exit",
    confidence: "high",
    reason: `controller_early_stop: ${earlyStop.reason}`,
    output: ctx.thought.trim(),
  };
}
```

**Note:** This replaces the current `earlyStopSignaled` flag mechanism in `kernel-runner.ts` (line 237). Instead of setting a meta flag that nudges the LLM on the next iteration, the controller's decision feeds directly into the oracle for immediate evaluation. The `TerminationContext` gains an additional field:

```typescript
readonly controllerDecisions?: readonly ReactiveDecision[];  // from reactive controller evaluate()
```

#### 4. ContentStability

```typescript
// Model is repeating itself — it's done, just not signaling it
evaluate(ctx): SignalVerdict | null {
  if (!ctx.priorThought || ctx.toolRequest) return null;

  const current = ctx.thought.trim();
  const prior = ctx.priorThought.trim();

  if (current.length === 0 || prior.length === 0) return null;

  // Exact match or high normalized similarity.
  // normalizedLevenshtein is a ~15-line utility implemented in termination-oracle.ts:
  // Levenshtein edit distance / max(len(a), len(b)), result inverted to similarity (1 - distance/max).
  // No external dependency needed. For the 90% case (benchmark data shows verbatim repeats),
  // the exact match branch fires first and the Levenshtein path is a safety net.
  const isStable = current === prior ||
    normalizedLevenshtein(current, prior) > 0.85;

  if (isStable) {
    return {
      action: "exit",
      confidence: current === prior ? "high" : "medium",
      reason: "content_stable",
      output: current,
    };
  }
  return null;
}
```

#### 5. LLMEndTurn

```typescript
// Trust the LLM's native "I'm done" signal
evaluate(ctx): SignalVerdict | null {
  if (ctx.stopReason !== "end_turn") return null;
  if (ctx.thought.trim().length === 0) return null;

  // Don't exit if required tools haven't been called
  const remainingRequired = ctx.requiredTools.filter(t => !ctx.toolsUsed.has(t));
  if (remainingRequired.length > 0) return null;

  return {
    action: "exit",
    confidence: "medium",
    reason: "llm_end_turn",
    output: ctx.thought.trim(),
  };
}
```

#### 6. FinalAnswerRegex

```typescript
// Text-based fallback — catches markdown variants.
// Uses the expanded FINAL_ANSWER_RE defined in tool-utils.ts (Section 4E).
// Single regex definition shared between hasFinalAnswer() and this evaluator.
// import { FINAL_ANSWER_RE, extractFinalAnswer } from "./tool-utils";

evaluate(ctx): SignalVerdict | null {
  if (!FINAL_ANSWER_RE.test(ctx.thought) && !FINAL_ANSWER_RE.test(ctx.thinking ?? "")) {
    return null;
  }

  const extracted = extractFinalAnswer(ctx.thought) ?? extractFinalAnswer(ctx.thinking ?? "");
  if (!extracted || extracted.trim().length === 0) return null;

  return {
    action: "exit",
    confidence: "medium",
    reason: "final_answer_regex",
    output: extracted.trim(),
  };
}
```

#### 7. CompletionGap

```typescript
// Safety net: task coverage check — returns "redirect", not "exit"
evaluate(ctx): SignalVerdict | null {
  if (ctx.redirectCount >= 1) return null;  // max 1 redirect, then allow exit

  const gaps = detectCompletionGaps(ctx.taskDescription, ctx.toolsUsed, ctx.allToolSchemas);
  if (gaps.length === 0) return null;

  return {
    action: "redirect",
    confidence: "medium",
    reason: `completion_gaps: ${gaps.join(", ")}`,
  };
}
```

### Integration Point

In `react-kernel.ts`, the current `handleThinking` function's exit logic (lines 508-577) is replaced by a single call:

```typescript
const decision = evaluateTermination(buildTerminationContext(state, thoughtResponse), evaluators);

if (decision.shouldExit) {
  const assembled = assembleOutput({ steps: state.steps, finalAnswer: decision.output!, ... });
  return transitionState(state, {
    status: "done",
    output: assembled.text,
    meta: { ...state.meta, terminatedBy: decision.reason, evaluator: decision.evaluator },
  });
}

if (decision.action === "redirect") {
  // Inject completion gap feedback, continue thinking
}

// Otherwise: continue to tool parsing / next iteration
```

### Entropy Scoring Reorder

**Clarification:** Entropy scoring stays in `kernel-runner.ts` (it needs the kernel's thought output to score). The reorder is within the kernel-runner's post-step processing: entropy scoring and reactive controller evaluation now happen BEFORE the kernel-runner checks exit status, not after. The oracle is called from within the kernel's `handleThinking` function, which now receives the entropy score and controller decisions as part of its context.

The updated flow in `kernel-runner.ts`:

```
1. Kernel's handleThinking produces thought (LLM call)
2. Entropy sensor scores the response (in kernel-runner, post-thought)
3. Reactive controller evaluates (early-stop, compression, strategy-switch)
4. Controller decisions + entropy score passed back to kernel via TerminationContext
5. Termination oracle evaluates all signals (inside handleThinking)
6. If exit → assemble output → done
7. If continue → tool parsing → action → observation → next iteration
```

The reactive controller's `early-stop` decision feeds into the `ReactiveControllerEarlyStop` evaluator for immediate evaluation, replacing the `earlyStopSignaled` flag-for-next-iteration mechanism.

### priorThought Threading

The `ContentStability` evaluator needs the previous iteration's thought. Currently `state.meta.lastThought` is set (react-kernel.ts line ~595) but cleared after acting (line ~914).

**Fix:** Add a persistent `priorThought` field to `KernelState`:

```typescript
// In kernel-state.ts
readonly priorThought?: string;  // previous iteration's thought, for stability detection
```

Updated at the end of each `handleThinking` call: `priorThought: thought.trim()`. Not cleared during acting — persists across the full iteration cycle.

### handleActing Scope

The oracle replaces exit logic in `handleThinking` only. The `handleActing` function's exit paths are preserved:

- **`final-answer` tool** (lines ~673-783): The accept/reject logic stays in `handleActing`. When accepted, the `FinalAnswerTool` evaluator in the oracle is not involved — `handleActing` transitions directly to `status: "done"`. The evaluator exists for cases where the kernel needs to evaluate final-answer signals outside the acting phase.
- **Post-action FINAL ANSWER check** (lines ~878-903): This path (checking if the original thought had FINAL ANSWER after tool execution) is moved into the oracle. After tool execution completes in `handleActing` (after line ~877), the kernel calls the oracle a second time with updated context:

```typescript
// In handleActing, after tool execution completes (replaces lines ~878-903):
const postActionCtx = buildTerminationContext(state, {
  // Re-use the original thought from state.meta.lastThought
  thought: state.meta.lastThought as string,
  stopReason: "end_turn",  // synthetic — tool executed, check if thought had exit signal
});
const postActionDecision = evaluateTermination(postActionCtx, evaluators);
if (postActionDecision.shouldExit) {
  const assembled = assembleOutput({ ... });
  return transitionState(state, { status: "done", output: assembled.text, ... });
}
```

Only the text-matching evaluators fire meaningfully here (`FinalAnswerRegex`, `ContentStability`). `EntropyConvergence` and `ReactiveControllerEarlyStop` return null since no new entropy score exists for this synthetic check. `PendingToolCall` returns null since tool execution is complete.

---

## Section 2: Output Assembly

### Problem

`extractFinalAnswer()` in `tool-utils.ts` (lines 14-17) captures only text after "FINAL ANSWER:" or returns the full thought. When models write code in their reasoning and summarize in their final answer, the code is discarded.

Evidence: GPT-4o-mini fizzbuzz (correct code in thought, "The code is complete and correct." extracted as output), Qwen3 isPrime (same pattern).

### Design

**File:** `packages/reasoning/src/strategies/shared/output-assembly.ts` (new)

```typescript
interface OutputAssemblyContext {
  readonly steps: readonly ReasoningStep[];
  readonly finalAnswer: string;
  readonly terminatedBy: string;
  readonly entropyScores?: readonly EntropyScore[];
}

interface AssembledOutput {
  readonly text: string;
  readonly codeBlocks: readonly string[];
  readonly sources: readonly string[];     // which steps contributed
}
```

### Assembly Logic

Pure function, no LLM calls, no async:

1. **Final answer already has code blocks or is > 200 chars** → use as-is
2. **Final answer is a short summary AND preceding steps contain code blocks** → prepend the best code block(s) to the final answer
3. **When multiple iterations contain code blocks** → prefer the one with the lowest entropy score (highest signal), or most recent if entropy unavailable
4. **Tool results compressed to scratchpad** → NOT re-expanded (too expensive)

### Code Block Extraction

```typescript
function extractCodeBlocks(text: string): string[] {
  // Fenced code blocks (```...```)
  const fenced = [...text.matchAll(/```[\w]*\n([\s\S]*?)```/g)].map(m => m[0]);
  if (fenced.length > 0) return fenced;
  // Fallback: indented code blocks (4+ spaces)
  const indented = [...text.matchAll(/(?:^|\n)((?:[ ]{4,}[^\n]+\n?)+)/g)].map(m => m[1]);
  return indented;
}
```

### Integration

Called after the termination oracle decides to exit, before the output is set on the kernel state:

```typescript
// In react-kernel.ts, after oracle says exit:
const assembled = assembleOutput({
  steps: state.steps,
  finalAnswer: decision.output!,
  terminatedBy: decision.reason,
  entropyScores: state.meta.entropy?.entropyHistory,
});
// state.output = assembled.text
```

---

## Section 3: Proportional Pipeline & Reactive Intelligence Default-On

### Problem

Every task runs the full 10-phase execution engine. Memory-flush takes 3-9s on local models for trivial tasks. Reactive intelligence is opt-in and its controller features are disabled even when opted in.

### 3A: Reactive Intelligence Default-On

**`packages/runtime/src/builder.ts`:**

```typescript
// Change default from false to true
private _enableReactiveIntelligence: boolean = true;

// Add boolean overload for opt-out
withReactiveIntelligence(enabled: boolean): this;
withReactiveIntelligence(options?: Partial<ReactiveIntelligenceConfig>): this;
withReactiveIntelligence(arg?: boolean | Partial<ReactiveIntelligenceConfig>): this {
  if (typeof arg === "boolean") {
    this._enableReactiveIntelligence = arg;
    return this;
  }
  this._enableReactiveIntelligence = true;
  if (arg) this._reactiveIntelligenceOptions = arg;
  return this;
}
```

**`packages/reactive-intelligence/src/types.ts`:**

```typescript
// Enable controller features by default
controller: {
  earlyStop: true,             // was false
  contextCompression: true,    // was false
  strategySwitch: true,        // was false
  branching: false,            // deferred (needs logprobs)
  causalAttribution: false,    // deferred (post-v1.0)
},

// Telemetry stays opt-in
telemetry: false,              // was true — changed to respect trust
```

### 3B: Task Complexity Classification

```typescript
type TaskComplexity = "trivial" | "moderate" | "complex";

function classifyComplexity(
  iteration: number,
  entropy: EntropyScore | undefined,
  toolCallCount: number,
  terminatedBy: string,
): TaskComplexity {
  // No tools, 1 iteration, natural exit → trivial (e.g., "2+2", "capital of France")
  if (iteration <= 1 && toolCallCount === 0 && terminatedBy !== "max_iterations") return "trivial";
  // Light tool use (1-2 calls), low entropy, few iterations → moderate (e.g., "search for X")
  if (toolCallCount <= 2 && iteration <= 3 &&
      (entropy ? entropy.composite < 0.4 : true)) return "moderate";
  // Everything else → complex
  return "complex";
}
```

Uses `toolCallCount` (number of actual tool executions) rather than boolean `toolsUsed`. A single tool call in 2 iterations (think → act → done) is "moderate" and gets async memory-flush rather than full blocking pipeline.

Runs at end of reasoning phase. Stored on `AgentResult.metrics.complexity`.

### 3C: Proportional Post-Processing

**`packages/runtime/src/execution-engine.ts`** — conditional at top of memory-flush phase:

| Phase | Trivial | Moderate | Complex |
|-------|---------|----------|---------|
| Memory snapshot | Skip | Skip | Run |
| Memory flush | Skip | Async (fire-and-forget via `Effect.forkDaemon`) | Run (blocking) |
| Memory decay | Skip | Skip | Run |
| Memory extraction | Skip | Skip | Run |
| Debrief synthesis | Skip | Skip | Run |
| Debrief persistence | Skip | Skip | Run |

**Expected savings:**
- Trivial tasks: 3-9s saved (local), 1-3s saved (cloud)
- Moderate tasks: Latency hidden by async execution
- Complex tasks: No change

---

## Section 4: Prompt & Tool Description Improvements

Targeted edits addressing specific model behavioral patterns observed in benchmarks. No new files, no new abstractions.

### 4A: Final-Answer Tool Description

**File:** `packages/tools/src/skills/final-answer.ts` (tool description)

Add to existing description:

```
When your task involves code generation, your output field MUST contain the actual
complete code — not a description of the code or a reference to code you wrote earlier.
```

### 4B: Anti-Conversational Instruction

**Files:** `packages/prompts/src/templates/reasoning/react-thought.ts`, `react-thought-local.ts`

Add to instruction block:

```
Do NOT ask follow-up questions like "Would you like me to continue?" or
"Shall I proceed?". Complete the task fully in your response.
```

Not added to `react-thought-frontier.ts` — frontier models don't exhibit this pattern.

### 4C: Local Tier Termination Nudge

**File:** `packages/prompts/src/templates/reasoning/react-system-local.ts`

Strengthen from minimal to explicit:

```
You are a helpful assistant that uses tools when needed.
When you have your answer, you MUST either:
- Use the final-answer tool, OR
- Write "FINAL ANSWER:" followed by your complete response
Do not repeat your answer multiple times. Answer once, then stop.
```

### 4D: Plan-Execute Output Budget

Add to plan-execute analysis step prompt:

```
Keep your analysis focused and concise. Aim for completeness, not exhaustiveness.
```

### 4E: Expanded FINAL ANSWER Regex

**File:** `packages/reasoning/src/strategies/shared/tool-utils.ts`

Replace `/final answer:/i` with:

```typescript
const FINAL_ANSWER_RE = /(?:\*{0,2})final\s*answer(?:\*{0,2})\s*[:：]?\s*/i;
```

Catches: `FINAL ANSWER:`, `**Final Answer**:`, `**Final Answer:**`, `Final Answer ` (no colon), full-width colon `：`.

### Impact Matrix

| Fix | Addresses | Providers Helped |
|-----|-----------|-----------------|
| 4A | Code discarded from output | GPT-4o-mini, Qwen3 |
| 4B | "Shall I proceed?" loops | GPT-4o-mini |
| 4C | Models ignoring final-answer tool | Cogito, Qwen3 |
| 4D | 15K token plan-execute outputs | All |
| 4E | Markdown-formatted final answers | Qwen3, Cogito |

---

## Section 5: Sub-Agent Fixes

### 5A: Input Parameter Schema

**File:** `packages/tools/src/adapters/agent-tool-adapter.ts`

Every provider (5/5) fails the first sub-agent tool call with `Parameter "input" expected object, got string`.

**Fix:** Accept both string and object in the tool's execute handler:

```typescript
const normalizedInput = typeof rawInput === "string"
  ? { query: rawInput }
  : rawInput;
```

Update schema description:

```
input: The task for the sub-agent. Can be a string (treated as a query)
or an object with a "query" field and optional parameters.
```

### 5B: Lightweight Sub-Agent Defaults

Tighten defaults in `createLightRuntime` (already exists):

```typescript
const subAgentDefaults = {
  maxIterations: 3,            // was inheriting parent's 10-15
  enableMemory: false,          // sub-agents don't need persistence
  enableDebrief: false,         // no post-run LLM call
  enableReactiveIntelligence: true,  // smart termination still active
};
```

User-configured values on `SubAgentConfig` override these defaults. No capability removed.

### 5C: Name Propagation

**File:** `packages/tools/src/adapters/agent-tool-adapter.ts`

Static sub-agent name shows as "undefined" in logs. Ensure `SubAgentConfig.name` propagates to the log prefix. Dynamic sub-agents already work (e.g., `factorial-calculator`) — fix the static adapter path to match.

---

## Section 6: Metrics Clarity & Testing

### 6A: LLM Call Counter

**File:** `packages/reasoning/src/strategies/shared/react-kernel.ts`

Distinguish internal steps from actual LLM round-trips:

```typescript
// Existing (unchanged)
readonly steps: readonly ReasoningStep[];    // internal state transitions

// New: incremented each time the kernel calls LLM.complete()
readonly llmCalls: number;
```

Surfaced in `AgentResult.metrics`:

```typescript
metrics: {
  iterations: number;           // kernel loop iterations (existing)
  llmCalls: number;             // actual LLM round-trips (new)
  tokens: number;
  durationMs: number;
  complexity: TaskComplexity;   // from Section 3
}
```

Benchmark reporter and observability dashboard use `llmCalls` for efficiency grading.

### 6B: Provider-Aware Time Budgets

**File:** `test.ts` (benchmark harness)

```typescript
const TIME_MULTIPLIER: Record<string, number> = {
  anthropic: 1.0,
  openai: 1.0,
  gemini: 1.0,
  ollama: 3.0,
  litellm: 1.5,
};

const adjustedMax = test.maxExpectedMs * (TIME_MULTIPLIER[provider] ?? 1.0);
```

Benchmark report shows both raw time and adjusted-budget pass/fail for fair cross-provider comparison.

### 6C: Oracle Test Suite

Comprehensive tests derived from benchmark failures.

**Unit tests — one per evaluator:**

| Evaluator | Key Test Cases |
|-----------|---------------|
| PendingToolCall | Tool request present → always continue |
| FinalAnswerTool | Accepted/rejected states, completion gap interaction |
| EntropyConvergence | Converging + end_turn → exit; flat → continue; diverging → continue |
| ContentStability | Identical thoughts → exit; similar-but-different → continue; tool pending → continue |
| LLMEndTurn | Non-empty + no required tools → exit; empty → continue; required tools remaining → continue |
| FinalAnswerRegex | All markdown variants, full-width colon, no colon, bare text |
| CompletionGap | Gap → redirect; max redirects → allow exit |

**Integration tests — signal interaction:**

| Scenario | Expected Outcome |
|----------|-----------------|
| Entropy says exit + tool pending | Continue (PendingToolCall short-circuits) |
| Content stable + required tools remaining | Continue (LLMEndTurn blocks due to remaining tools) |
| Multiple exit signals at different confidence | Highest confidence wins |
| No reactive intelligence available | Fallback works via ContentStability + LLMEndTurn |

**Regression tests — exact benchmark failures (with expected evaluator):**

| Scenario | Provider | Expected Evaluator | Expected Decision |
|----------|----------|--------------------|-------------------|
| Gemini "4" at iteration 0, end_turn | Gemini | `LLMEndTurn` | Exit — no iteration gate, no length gate |
| "Paris" repeated 3 times, no tools | GPT-4o-mini | `ContentStability` | Exit on iteration 2 — exact match detected |
| `**Final Answer** 105` | Qwen3 | `FinalAnswerRegex` | Exit — expanded regex matches markdown bold |
| Fizzbuzz code in thought, "The code is complete" in final answer | GPT-4o-mini | Any exit evaluator | Output assembly prepends code blocks |
| "Hello! How can I help?" on "Hi" | Cogito | `LLMEndTurn` | Exit — no length gate for end_turn |
| Scratchpad write+read then repeating answer | Qwen3 | `ContentStability` | Exit — verbatim repeat after tool sequence |
| Entropy converging + end_turn on iteration 2 | Any with RI | `EntropyConvergence` | Exit — trajectory.shape converging |
| Controller signals early-stop | Any with RI | `ReactiveControllerEarlyStop` | Exit — immediate, not flag for next iter |

**Output assembly tests:**

| Scenario | Expected |
|----------|----------|
| Short summary + preceding code blocks | Code prepended |
| Final answer already has code | Pass-through |
| Multiple iterations with code + entropy | Lowest entropy iteration's code preferred |
| No code anywhere | Pass-through |

---

## Scope Summary

| Section | Files Changed | New Files | ~Lines Changed | ~Lines of Tests |
|---------|--------------|-----------|----------------|-----------------|
| 1. Termination Oracle | `react-kernel.ts`, `kernel-runner.ts`, `kernel-state.ts` | `termination-oracle.ts` | 300 | 450 |
| 2. Output Assembly | `react-kernel.ts` (integration) | `output-assembly.ts` | 80 | 150 |
| 3. Proportional Pipeline | `builder.ts`, `types.ts`, `execution-engine.ts` | None | 60 | 100 |
| 4. Prompt Fixes | `final-answer.ts`, 3 prompt files, `tool-utils.ts` | None | 30 | 50 |
| 5. Sub-Agent Fixes | `agent-tool-adapter.ts`, light runtime | None | 25 | 50 |
| 6. Metrics & Testing | `react-kernel.ts`, `test.ts` | `termination-oracle.test.ts`, `output-assembly.test.ts` | 40 | 250 |
| **Total** | | **3 new** | **~535** | **~1050** |

**Net deleted:** ~150-200 lines of scattered if/else exit logic in `react-kernel.ts` replaced by oracle.

---

## Migration & Breaking Changes

### Reactive Intelligence Default-On

**Change:** `_enableReactiveIntelligence` defaults to `true` (was `false`).

**Impact:** All agents built without explicitly calling `.withReactiveIntelligence(false)` will now load the entropy sensor and reactive controller services. This adds:

- ~2-5ms overhead per iteration for entropy scoring (synchronous computation, no I/O)
- CalibrationStore SQLite table created on first use (lazy, not at initialization)
- No network calls unless telemetry is explicitly opted in

**Test suite compatibility:** The entropy sensor service is already available as an optional dependency in the test fixtures. Making it default-on means some tests that assert on exact `state.meta` contents may see additional entropy fields. Tests that mock the full runtime layer are unaffected since they provide their own service implementations.

**Mitigation:** Run full test suite after the change. Any test that breaks due to unexpected entropy fields is fixed by either: (a) asserting on specific fields rather than exact meta shape, or (b) explicitly disabling RI in that test's builder.

### Telemetry Default Change

**Change:** `telemetry` defaults to `false` (was `true` in `defaultReactiveIntelligenceConfig`).

**Impact:** Users who previously relied on the default `telemetry: true` when calling `.withReactiveIntelligence()` without options will stop sending telemetry. This is intentional — telemetry should be a conscious choice.

**Mitigation:** Document in CHANGELOG. Users who want telemetry explicitly set `.withReactiveIntelligence({ telemetry: true })`.

---

## What's NOT in Scope

- **Fast-path routing** (bypass ReAct loop entirely for simple tasks) — valuable but a separate execution mode. The oracle + proportional pipeline handle 90% of the benefit by exiting on iteration 1 and skipping post-processing.
- **Model behavior profiles** (per-model-family framework behavior changes) — the oracle's extensible evaluator array is the hook for this. A future `ModelProfile` evaluator can adjust confidence thresholds per model. Not needed for v1 since tier-adaptive prompts + expanded regex + content stability cover the observed failures.
- **Conformal calibration wired into oracle** — already shipped as part of reactive intelligence. The oracle's `EntropyConvergence` evaluator already uses calibrated thresholds via the trajectory analysis. Deeper integration (per-model convergence thresholds) happens naturally as calibration data accumulates.
- **Contextual bandit for prompt selection** — already shipped. The design doesn't change how it works, just ensures it has better data by making reactive intelligence default-on.
- **New execution modes** (direct LLM call without kernel) — the proportional pipeline with trivial-task classification achieves the same latency improvement without a new code path.

---

## Success Metrics

| Metric | Current | Target | How Measured |
|--------|---------|--------|--------------|
| Gemini Flash pass rate | 77% (27/35) | 95%+ | Re-run benchmark suite |
| GPT-4o-mini pass rate | 89% (31/35) | 95%+ | Re-run benchmark suite |
| Ollama cogito pass rate | 66% (23/35) | 80%+ (adjusted budgets) | Re-run with time multipliers |
| Ollama qwen3 pass rate | 60% (21/35) | 75%+ (adjusted budgets) | Re-run with time multipliers |
| Anthropic Haiku pass rate | 97% (34/35) | 100% | Re-run benchmark suite |
| Trivial task latency | 3-12s (memory-flush) | < 2s (cloud), < 5s (local) | Benchmark "2+2", "capital of France" |
| Sub-agent first-call success | 0% (schema mismatch) | 100% | Sub-agent benchmark tests |
| Answer-then-repeat detection | Not detected | Detected + exited by iteration 2 | ContentStability evaluator tests |
| Code in output preservation | Discarded | Preserved | Output assembly tests |

---

## Implementation Order

1. **Termination Oracle** (Section 1) — highest impact, enables everything else
2. **Output Assembly** (Section 2) — depends on oracle integration point
3. **Prompt Fixes** (Section 4) — independent, can ship alongside 1+2
4. **Sub-Agent Fixes** (Section 5) — independent, can ship alongside 1+2
5. **Proportional Pipeline** (Section 3) — depends on reactive intelligence default-on
6. **Metrics & Testing** (Section 6) — oracle tests written alongside Section 1; time multipliers + llmCalls counter last

Sections 1+2 are the critical path. Sections 3-5 are independent and can be parallelized. Section 6 spans the entire effort.
