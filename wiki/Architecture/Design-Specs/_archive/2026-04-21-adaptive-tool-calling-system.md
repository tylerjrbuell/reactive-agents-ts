# Adaptive Tool Calling System

**Date:** 2026-04-21  
**Status:** Draft — awaiting implementation plan  
**Evidence base:** live `local-models` benchmark session (qwen3:4b, cogito:8b, rw-2/3/6/8/9), profiles API data, AUC validation runs

---

## Problem Statement

The benchmark session exposed a single root cause beneath every local model failure: **the harness has no normalization layer between how a model expresses tool intent and how tools are executed**. Native function calling hands all control to the model. When the model hallucates param names, invents tool namespaces, or generates wrong paths, the harness returns an error. The model ignores the error. The loop continues. The harness escalates interventions. The model gets more confused. Grade D.

Specific failures observed and their root causes:

| Failure | Model | Task | Root cause |
|---|---|---|---|
| `input` as universal param alias | cogito:8b | rw-2, rw-8 | No param normalization layer |
| `typescript/compile` hallucination | cogito:8b | rw-8 | No tool name normalization layer |
| Wrong absolute path generation | qwen3:4b | rw-6 | No path resolution layer |
| Grade D diverging under ra-full (×3) | cogito:8b | rw-2 | Tool errors → RI interventions → more confusion |
| Flatline entropy | qwen3:4b | rw-6 | Repeated path failures → no progress → stall |
| Error messages ignored | cogito:8b | all | Recovery depends on model reading error text |
| rw-8 D→C→B across 3 runs | cogito:8b | rw-8 | System learning aliases slowly via error recovery |

The last row is the most instructive: the existing system was already learning alias patterns through error recovery observations. The D→C→B progression proves the signal is there. This design makes that learning deliberate, upfront, and pre-emptive.

**Secondary problem:** three existing feedback loops are structurally dead:
1. `ExperienceStore.query()` generates tips that no code path consumes
2. `CalibrationStore` has no tool behavior schema — cannot store alias maps or per-tool success rates
3. `tool-failure-redirect` emits generic guidance regardless of what specifically failed

---

## Solution Overview

A four-layer closed-loop system:

```
┌─────────────────────────────────────────────────────────────┐
│  CALIBRATION LAYER                                           │
│  FC probe → toolCallDialect populated in profiles API       │
│  Runs once per model, re-triggers on sustained failure rate  │
└──────────────────────────┬──────────────────────────────────┘
                           │ toolCallDialect + alias maps
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  ROUTING LAYER                                               │
│  buildCalibratedAdapter() returns toolCallingDriver         │
│  NativeFCDriver  |  TextParseDriver                         │
└──────────────────────────┬──────────────────────────────────┘
                           │ unified ToolCall[]
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  EXECUTION LAYER                                             │
│  HealingPipeline (extends normalizeToolCallArguments)       │
│  ToolNameHealer → ParamNameHealer → PathResolver            │
│  Cascading parse pipeline for TextParseDriver               │
└──────────────────────────┬──────────────────────────────────┘
                           │ ToolCallObservation per call
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  OBSERVATION LAYER                                           │
│  ToolCallObservation → CalibrationStore alias accumulation  │
│  Materialized summary → adapter toolGuidance hook           │
│  interventionResponseRate → dispatcher routing              │
└─────────────────────────────────────────────────────────────┘
```

The kernel phases (`think.ts`, `act.ts`, `context-builder.ts`) are **not modified**. The ToolCallingDriver interface is the only seam. Everything above it is new; everything below it is existing.

---

## Layer 1 — Calibration Probe

### Purpose

Determine a model's FC capability once, store the result as `toolCallDialect` in the profiles API, and never re-run the probe unless the live success rate degrades.

### FC Grading Battery

The probe runs 6–8 synthetic calls against a standard tool set (5 tools covering the param patterns most commonly hallucinated). Each dimension scores 0–1:

| Dimension | What is tested | Weight |
|---|---|---|
| Tool name accuracy | Uses exact registered tool names vs inventing aliases | 0.25 |
| Param name accuracy | Uses schema param names vs universal aliases (`input`, `command`) | 0.30 |
| Type compliance | Passes correct types (string vs number vs object) | 0.15 |
| Required param completeness | Includes all required params | 0.15 |
| Multi-tool selection | Selects the right tool from 5 options without hallucinating extras | 0.15 |

Weighted composite → `fcCapabilityScore` (0.0–1.0).

### Routing Thresholds

| Score | `toolCallDialect` | Driver |
|---|---|---|
| ≥ 0.80 | `"native-fc"` | NativeFCDriver |
| < 0.80 | `"text-parse"` | TextParseDriver |

The three-tier middle bucket (`fc-with-healing`) is deliberately collapsed. In practice, a model scoring 0.5–0.8 requires the same normalization effort as a model scoring 0.2. Two modes are cleaner, less maintenance, and easier to reason about.

Side effects of the probe run:
- Failed param name calls populate `knownParamAliases` seed entries (pending frequency confirmation from live runs)
- Failed tool name calls populate `knownToolAliases` seed entries
- `parallelCallCapability` confirmed or overridden (probe tests two simultaneous calls)

### Probe Trigger

| Trigger | Timing |
|---|---|
| First use of an uncalibrated model | Background, non-blocking, runs alongside first agent execution |
| No profile found in profiles API or local store | Falls through to `text-parse` as safe default |
| Live FC success rate drops below 0.40 over last 10 calls | Flagged at run end; re-probe scheduled for next run start |
| User calls `rax calibrate --model <id>` explicitly | On-demand, blocking, outputs report |

Re-probe is never triggered mid-run. The latency cost is unacceptable when a task is in flight.

### `toolCallDialect` Field

The field already exists in the live profiles API (`api.reactiveagents.dev/v1/profiles/:modelId`) as `"none"` for uncalibrated models. The probe writes:
- `"native-fc"` — model handles FC reliably
- `"text-parse"` — model should use text parsing

Local `~/.reactive-agents/calibration.db` stores the same field and takes precedence over the central API (user-local overrides community profile). The existing `loadCalibration()` cascade already handles this priority order.

---

## Layer 2 — Routing Layer

### ToolCallingDriver Interface

```typescript
interface ToolCallingDriver {
  // Returns "" for NativeFCDriver (schemas go via provider API)
  // Returns format instructions + tool descriptions for TextParseDriver
  buildPromptInstructions(tools: ToolSchema[]): string

  // NativeFCDriver: pass through provider-parsed FC calls
  // TextParseDriver: run cascading parse pipeline → HealingPipeline
  extractCalls(output: ModelOutput, tools: ToolSchema[]): ToolCall[]

  // NativeFCDriver: provider tool_result format (unchanged)
  // TextParseDriver: human-readable observation format
  formatToolResult(result: ToolResult): string

  readonly mode: "native-fc" | "text-parse"
}
```

### Integration Point

`buildCalibratedAdapter()` in `packages/llm-provider/src/calibration.ts` currently returns `{ adapter, profileOverrides }`. This becomes:

```typescript
{ adapter, profileOverrides, toolCallingDriver }
```

The driver is selected from `toolCallDialect` in the loaded profile. If the field is `"none"` (uncalibrated), `text-parse` is the safe default.

### NativeFCDriver

Minimal implementation — passes through the existing FC path unchanged:
- `buildPromptInstructions()` → `""` (schemas already in provider API call)
- `extractCalls()` → returns `state.meta.pendingNativeToolCalls` (already parsed by think.ts)
- `formatToolResult()` → existing provider tool_result format
- HealingPipeline still runs on the extracted calls (lightweight, always-on)

### TextParseDriver

Non-trivial — owns the full parse pipeline:
- `buildPromptInstructions()` → generates structured format guide + human-readable tool descriptions from `ToolSchema[]`
- `extractCalls()` → cascading parse pipeline (see Layer 3)
- `formatToolResult()` → plain text observation format for next model turn

### Provider API Constraint — Critical

Anthropic and OpenAI APIs **enforce FC format** when tools are passed in the API call. A model on TextParseDriver cannot receive tools via the provider API — it will produce FC calls regardless of prompt instructions.

**Required behavior for TextParseDriver on constrained providers:**
1. Pass an **empty tools array** (`[]`) to the provider API call
2. Inject tool descriptions as structured text in the system prompt via `buildPromptInstructions()`
3. The provider receives no FC schema; the model outputs text; TextParseDriver extracts

**Ollama is permissive** — tools can be passed or omitted; no change needed.

The provider adapter must branch on `driver.mode === "text-parse"` when building the API call. This is the only place provider identity affects the driver behavior.

---

## Layer 3 — Execution Layer

### Cascading Parse Pipeline (TextParseDriver)

Extraction runs in tiers. Each tier produces a confidence score. If confidence meets the threshold, extraction is done. If not, fall to the next tier.

**Tier 1 — Structured format** (threshold: 0.90)

System prompt instructs this exact format. Regex extraction. Highest confidence.

```
<tool_call>
tool: file-read
path: /foo/bar.ts
</tool_call>
```

**Tier 2 — JSON-in-text** (threshold: 0.70)

Model outputs JSON-like content inline with prose. JSON.parse with error recovery on extracted blocks.

```
I'll call {"tool": "file-read", "path": "/foo/bar.ts"}
```

**Tier 3 — Relaxed FC JSON** (threshold: 0.50)

Model outputs something resembling native FC in text — partial schemas, wrong nesting, extra fields, array wrappers. Tolerant JSON extraction with field normalization. This tier catches models that switch between native FC and text output.

**Tier 4 — Structured re-prompt** (threshold: n/a, one retry)

Tiers 1–3 all failed. Rather than attempting semantic intent extraction from natural language (unreliable), inject a one-shot clarification nudge with the exact required format and retry. If re-prompt also fails: record parse failure observation, early-stop the iteration.

Semantic NL intent extraction is deliberately excluded. It adds reliability risk precisely when the model is already struggling, and the re-prompt approach produces cleaner observations for the learning loop.

**Multi-call extraction:** Each tier attempts to extract ALL tool calls from a single response, in sequence. Ordering is preserved — tool calls extracted left-to-right as they appear in output.

**Confidence scoring:**
- Tier 1: binary — either the XML structure parses or it doesn't
- Tier 2: JSON.parse success + required fields present = 1.0; partial = 0.6–0.8
- Tier 3: at least tool name + one param extracted = 0.5; nothing usable = 0.0
- Re-prompt: no confidence score; treated as atomic retry

### HealingPipeline

Runs on every extracted `ToolCall`, regardless of driver mode. Extends the existing `normalizeToolCallArguments()` in `act.ts` — same seam, richer rules.

**Stage 1 — ToolNameHealer**

Resolves tool name to a registered tool. Lookup order:
1. Exact match → done
2. `knownToolAliases` from CalibrationStore (e.g., `typescript/compile` → `code-execute`)
3. Edit-distance fuzzy match against registered tool names (threshold: ≤ 2 character edits)
4. No match → `ToolNameResolutionFailure` — skip remaining stages, record observation

**Stage 2 — ParamNameHealer**

Normalizes param names against the resolved tool's schema. Lookup order:
1. Exact match → done
2. `knownParamAliases` from CalibrationStore for this model + tool (e.g., `input` → `path`)
3. Edit-distance fuzzy match against schema param names (threshold: ≤ 2 edits)
4. No match and param is required → `ParamResolutionFailure` — record observation, continue with missing param

**Stage 3 — PathResolver**

Fires only on file-operation tools (`file-read`, `file-write`, `code-execute`, etc.). Resolves paths in order:
1. Relative path → resolve against FileSandbox working directory
2. Absolute path outside working directory → remap to working directory equivalent
3. `~/` prefix → expand via `expandPath()`

**Stage 4 — TypeCoercer**

Coerces param values to schema-declared types where unambiguous:
- `"5"` → `5` when schema declares `number`
- `"true"` / `"false"` → `boolean` when schema declares `boolean`
- Leaves ambiguous cases (e.g., `"null"`) unchanged — conservative by default

**Stage 5 — RequiredParamInferrer**

If a required param is still missing after stages 1–4, attempts to infer from:
1. Other params in the same call (e.g., missing `region` on a file tool when `path` is present)
2. `state.pendingGuidance.taskContext` (task-level context injected via `withTaskContext`)

If inference is not possible, records a `MissingRequiredParam` observation. The call still proceeds — the tool's error message will be more useful than a pre-emptive abort.

---

## Layer 4 — Observation Layer

### ToolCallObservation Schema

Added to `ExperienceRecord` in `packages/memory/src/services/experience-store.ts`:

```typescript
interface ToolCallObservation {
  toolNameAttempted: string       // what the model wrote
  toolNameResolved: string | null // what was actually called (null = unresolvable)
  paramsAttempted: Record<string, unknown>  // raw from model
  paramsResolved: Record<string, unknown>   // after healing
  parseMode: "native-fc" | "tier-1" | "tier-2" | "tier-3" | "reprompt"
  healingApplied: HealingAction[]  // which stages fired and what they changed
  succeeded: boolean
  errorText: string | null
}

interface HealingAction {
  stage: "tool-name" | "param-name" | "path" | "type" | "param-infer"
  from: string
  to: string
}
```

### CalibrationStore Additions

New fields on `ModelCalibrationSchema`:

```typescript
// FC routing
toolCallDialect: "native-fc" | "text-parse" | "none"  // extends existing field
fcCapabilityScore: number          // 0.0–1.0 from probe
fcCapabilityProbedAt: string       // ISO date

// Learned alias maps (frequency-gated)
knownToolAliases: Record<string, string>   // e.g. "typescript/compile" → "code-execute"
knownParamAliases: Record<string, Record<string, string>> // tool → { aliasParam → schemaParam }

// Per-tool success rates
toolSuccessRateByName: Record<string, number>

// Intervention behavior
interventionResponseRate: number   // avg iterationsAfterFirstDispatch; -1 = insufficient data
interventionResponseSamples: number // must reach ≥ 5 before field influences routing

// Harness harm tracking (per task type)
harnessHarmByTaskType: Record<string, HarnessHarmRecord>
```

### Alias Map Frequency Gate

An alias is only written to CalibrationStore after being observed **N ≥ 3 times** in `ToolCallObservation`. A single hallucinated call could be noise. Three consistent observations of the same wrong param name confirm it's a model pattern, not a one-off.

### Materialized ExperienceStore Summary

`ExperienceStore.query()` is currently called lazily and its results consumed nowhere. Replace with a **materialized summary** written to CalibrationStore after each run completes:

```typescript
interface ExperienceSummary {
  topWorkingParamPatterns: Array<{ tool: string, params: Record<string, string>, successRate: number }>
  topErrorPatterns: Array<{ tool: string, error: string, recovery: string, occurrences: number }>
  lastUpdated: string
}
```

The adapter's `toolGuidance` hook reads from `ExperienceSummary` — fast, no live query overhead. Content becomes concrete: "For `file-read`, use `path` not `input` (confirmed 12 times)" instead of generic required-tools reminder.

### interventionResponseRate

Computed from `firstDispatchIter` and `iterationsAfterFirstDispatch` already tracked in `state.controllerDecisionLog` (note: `budget.interventionsFiredThisRun` was hardcoded 0 and cannot be used — `controllerDecisionLog` is the correct source).

Routing behavior once `interventionResponseSamples ≥ 5`:
- `rate ≤ 2` (responds quickly) → soft nudge sequence, give model runway
- `rate > 2` (slow/ignores nudges) → skip soft nudge, go directly to early-stop on second fire

---

## HarnessHarmDetector

### Problem

cogito:8b on rw-2 scored Grade D diverging under ra-full × 3 runs. Bare-llm performed better. The harness was net-negative: tool errors triggered RI interventions, interventions added system prompt content, the model got more confused, more errors, more interventions. A compounding spiral.

### Detection Strategy

Production agents don't run bare-llm as a control. Harm is inferred from RI data within the run:

1. Track `interventionCountThisRun` from `state.controllerDecisionLog`
2. Track `toolSuccessRateThisRun` from `ToolCallObservation` per run
3. After run completes: if `interventionCount > 3` AND `toolSuccessRate < 0.40` AND `taskSuccess = false` → record as probable harness harm for `modelId + taskType`
4. After N ≥ 3 runs matching this pattern → `harnessHarmByTaskType[taskType] = "confirmed"`

### Circuit-Break Behavior

When `harnessHarmByTaskType[taskType] === "confirmed"` for the current model:
- Disable all RI interventions except `early-stop` (the one intervention that cannot make things worse)
- Raise the `minEntropyComposite` threshold so RI fires only on extreme divergence
- Log the harm profile so the benchmark session can flag it in the ablation report

This is not permanent — if tool success rate improves (from HealingPipeline making calls succeed), the harm confirmation is re-evaluated after 10 clean runs.

### Relationship to HealingPipeline

The HarnessHarmDetector is the safety net, not the primary fix. With HealingPipeline pre-normalizing tool calls, the tool error rate drops and the RI spiral never starts. The detector catches cases where harness harm occurs for reasons other than tool call format failures.

---

## StallDetector

### Problem

qwen3:4b on rw-6 flatlined — repeated the same broken pattern for N iterations. Entropy variance for local models is ~0.02 (confirmed from profiles API), too low to use as a stall signal. The existing `tool-failure-streak` handler catches repeated tool call failures but not content-level stalls where the model generates varied-looking text that makes no progress.

### Detection Signal

Entropy-based stall detection is **disabled for local tier**. Signal instead:

1. **Iteration count gate** — stall window is tier-adaptive:
   - Local tier: 2 consecutive iterations with no new tool calls
   - Frontier tier: 5 consecutive iterations with no new tool calls

2. **Content similarity** — cosine similarity of consecutive `think.ts` outputs above 0.85 → model is repeating itself. Computed from token overlap of the last two reasoning outputs (no embedding required — token frequency comparison is sufficient and fast).

Both conditions must hold simultaneously to trigger. Either alone is insufficient — a model that's legitimately thinking through a hard problem may produce similar-looking reasoning across iterations.

### Escalation

Matches the existing escalating pattern from `tool-failure-redirect`:
1. First fire → structured re-prompt nudge ("You appear to be stuck. Try a different approach: [specific suggestion from task context]")
2. Second fire → `early-stop`

The stall window resets on any new tool call or measurably different response content.

---

## Open Failure — ExperienceStore Consumption

The Explore agent reported ExperienceStore is "called by guidance systems for pattern recommendations" — but earlier analysis found zero live consumers of `query()`. This discrepancy must be resolved before implementation begins:

- If `query()` is genuinely unwired → the materialized summary design in this spec closes the loop
- If `query()` is partially wired somewhere → the existing consumer must be identified and migrated to the materialized summary path to avoid dual-maintenance

**Action:** grep for all `ExperienceStore` call sites before writing the implementation plan.

---

## Package Boundaries

| Component | Package | File(s) |
|---|---|---|
| FC probe battery | `packages/reactive-intelligence/src/` | `calibration-probe.ts` (new) |
| `toolCallDialect` profiles API write | `packages/llm-provider/src/` | `calibration.ts` (extend schema + buildCalibratedAdapter return) |
| ToolCallingDriver interface | `packages/tools/src/drivers/` | `tool-calling-driver.ts` (new) |
| NativeFCDriver | `packages/tools/src/drivers/` | `native-fc-driver.ts` (new) |
| TextParseDriver + parse pipeline | `packages/tools/src/drivers/` | `text-parse-driver.ts` (new) |
| HealingPipeline | `packages/tools/src/healing/` | `healing-pipeline.ts` (new, extends `normalizeToolCallArguments`) |
| ToolNameHealer | `packages/tools/src/healing/` | `tool-name-healer.ts` (new) |
| ParamNameHealer | `packages/tools/src/healing/` | `param-name-healer.ts` (new) |
| PathResolver | `packages/tools/src/healing/` | `path-resolver.ts` (new) |
| ToolCallObservation schema | `packages/memory/src/services/` | `experience-store.ts` (extend ExperienceRecord) |
| CalibrationStore schema additions | `packages/llm-provider/src/` | `calibration.ts` (extend ModelCalibrationSchema) |
| ExperienceSummary materialization | `packages/llm-provider/src/` | `calibration.ts` (new function: materializeExperienceSummary) |
| HarnessHarmDetector | `packages/reactive-intelligence/src/controller/handlers/` | `harness-harm-detector.ts` (new) |
| StallDetector | `packages/reactive-intelligence/src/controller/handlers/` | `stall-detector.ts` (new) |
| Provider API constraint | `packages/llm-provider/src/` | provider adapters (branch on driver.mode) |

---

## Integration Points — What Changes in Existing Files

| File | Change |
|---|---|
| `packages/llm-provider/src/calibration.ts` | `ModelCalibrationSchema` gains new fields; `buildCalibratedAdapter()` returns `toolCallingDriver`; `materializeExperienceSummary()` added |
| `packages/reasoning/src/strategies/kernel/phases/act.ts` | `normalizeToolCallArguments()` extended with HealingPipeline stages; driver injected via `KernelContext` |
| `packages/reasoning/src/strategies/kernel/phases/think.ts` | Passes empty tools array to provider API when `driver.mode === "text-parse"` on constrained providers; injects `driver.buildPromptInstructions()` into system prompt |
| `packages/reasoning/src/strategies/kernel/kernel-state.ts` | `KernelContext` gains `toolCallingDriver: ToolCallingDriver` |
| `packages/llm-provider/src/adapter.ts` | `toolGuidance` hook reads from `ExperienceSummary` instead of generating generic text |
| `packages/reactive-intelligence/src/controller/handlers/tool-failure-redirect.ts` | Reads `knownParamAliases` from CalibrationStore to emit concrete corrections |
| `packages/runtime/src/builder.ts` | Triggers calibration probe on first use of uncalibrated model; passes `toolCallingDriver` through to kernel context |

---

## Build Order

Phases are sequenced so each phase is independently shippable and testable.

**Phase 1 — CalibrationStore schema + `toolCallDialect` routing**
Add new fields to `ModelCalibrationSchema`. Extend `buildCalibratedAdapter()` to return `toolCallingDriver`. Plumb `ToolCallingDriver` through `KernelContext`. NativeFCDriver is a thin pass-through. TextParseDriver stub (Tier 1 only). Tests: schema round-trip, driver selection by `toolCallDialect` value.

**Phase 2 — HealingPipeline**
Extend `normalizeToolCallArguments()` with ToolNameHealer, ParamNameHealer (seeded with empty alias maps initially). PathResolver. TypeCoercer. Tests: unit tests per healer stage with mock CalibrationStore; integration test with cogito:8b alias map pre-loaded.

**Phase 3 — TextParseDriver full parse pipeline**
Tiers 1–3 + re-prompt. Confidence scoring. Multi-call extraction. Provider API empty-tools-array branch for Anthropic/OpenAI. Tests: parser unit tests per tier; integration test running TextParseDriver against recorded cogito:8b and qwen3:4b model outputs from benchmark session.

**Phase 4 — FC calibration probe**
Probe battery (6–8 calls). FC scoring per dimension. `toolCallDialect` write to local store. Background probe trigger at first use. Tests: probe scoring unit tests; mock model that scores 0.9 routes to native-fc; mock model that scores 0.3 routes to text-parse.

**Phase 5 — ToolCallObservation + CalibrationStore feedback loop**
`ToolCallObservation` schema on `ExperienceRecord`. Alias accumulation with frequency gate (N ≥ 3). `materializeExperienceSummary()`. Adapter `toolGuidance` reads from summary. `interventionResponseRate` computation from `controllerDecisionLog`. Tests: alias frequency gate (2 observations = no write, 3 = write); summary materialization; toolGuidance hook output with seeded summary.

**Phase 6 — StallDetector + HarnessHarmDetector**
StallDetector: iteration count gate + content similarity. HarnessHarmDetector: harm inference from run data; circuit-break on confirmed harm. Register both in intervention handler registry. Tests: stall scenario (same content 3× → nudge → early-stop); harm scenario (high intervention count + low success rate → harm flag accumulates → circuit-break).

---

## Testing Strategy

Each phase has unit tests before integration tests before benchmark validation.

**Unit:** each healer stage in isolation with a mock CalibrationStore. Each parse tier with recorded model output strings. Probe scoring with synthetic FC responses.

**Integration:** run TextParseDriver + HealingPipeline against the recorded rw-2, rw-6, rw-8 model outputs from the benchmark session. Assert Grade C or better (tool calls succeed, no unresolved aliases).

**Benchmark validation:** re-run `local-models` session after Phase 3 ships. Target: cogito:8b rw-2 Grade C+, rw-8 Grade B+; qwen3:4b rw-6 no flatlines. Record as new baseline.

**Regression gate:** existing `regression-gate` session must pass with no regressions on Anthropic/OpenAI models. The empty-tools-array branch for TextParseDriver must not activate for calibrated frontier models.

---

## Success Criteria

| Metric | Before | Target |
|---|---|---|
| cogito:8b rw-2 grade | D diverging | C converged |
| cogito:8b rw-8 grade | D→C→B trend | B on first run |
| qwen3:4b rw-6 flatlines | Present | Eliminated |
| Tool call success rate (cogito:8b) | ~0% on param-sensitive tools | ≥ 80% |
| ra-full vs bare-llm on cogito:8b rw-2 | -1 grade (ra-full worse) | 0 or +1 (ra-full same or better) |
| ExperienceStore tip consumption | 0 consumers | toolGuidance hook reads materialized summary |
| Frontier model regression | 0 regressions | 0 regressions (regression-gate must pass) |
