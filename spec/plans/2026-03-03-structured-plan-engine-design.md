# Structured Plan Engine — Design Document

**Date:** 2026-03-03
**Status:** Approved
**Scope:** Rewrite plan-execute-reflect strategy with structured JSON plans, persistent SQLite storage, provider-adaptive structured output, and DAG-capable execution.

---

## Problem

The current plan-execute-reflect strategy is fundamentally broken:

1. **Plans are text-parsed** — regex extraction of numbered lists. Fragile, no type safety.
2. **Kernel loses plan context** — each step is passed as free text to the full ReAct kernel. The model sees 48 tool schemas and hallucinates random tasks instead of executing the plan step.
3. **No persistence** — plans exist only in memory during a single run. No cross-run learning, no crash recovery.
4. **No step type differentiation** — every step goes through the LLM kernel even when a direct tool call would suffice.
5. **Replanning is nuclear** — on failure, the entire plan regenerates from scratch instead of patching the broken part.

**Observed in test.ts:** Agent creates a good plan ("fetch luduscom/ludus-next commits, draft briefing, send via Signal") then immediately diverges to searching random GitHub repos (facebook/react, aws/aws-amplify, expressjs/express). Replans 3 times without executing the original plan. Model hallucinates conversations with imaginary users.

---

## Design

### 1. Plan Step Schema

Type-safe JSON data model. The LLM generates only high-value content fields. All metadata (IDs, timestamps, status, token counts) is injected deterministically by framework code.

**What the LLM generates:**

```typescript
// LLM output schema — minimal, content-only
interface LLMPlanStep {
  title: string;                       // "Fetch recent commits"
  instruction: string;                 // Detailed instruction for executor
  type: "tool_call" | "analysis" | "composite";
  toolName?: string;                   // For tool_call steps
  toolArgs?: Record<string, unknown>;  // For tool_call steps
  toolHints?: string[];                // For composite steps — which tools are relevant
  dependsOn?: string[];                // For DAG mode — step IDs (e.g., ["s1", "s3"])
}

interface LLMPlanOutput {
  steps: LLMPlanStep[];
}
```

**What the framework hydrates:**

```typescript
interface PlanStep {
  id: string;                          // Deterministic: "s1", "s2", "s3" (short, token-friendly)
  seq: number;                         // Execution order
  title: string;                       // From LLM
  instruction: string;                 // From LLM
  type: "tool_call" | "analysis" | "composite";  // From LLM
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  toolName?: string;                   // From LLM
  toolArgs?: Record<string, unknown>;  // From LLM
  toolHints?: string[];                // From LLM
  dependsOn?: string[];                // From LLM (DAG mode)
  result?: string;                     // Populated during execution
  error?: string;                      // Populated on failure
  retries: number;                     // Framework-tracked
  tokensUsed: number;                  // Framework-tracked
  startedAt?: string;                  // ISO timestamp, framework-set
  completedAt?: string;                // ISO timestamp, framework-set
}

interface Plan {
  id: string;                          // Short ID: "p_7k3m" (4-6 chars)
  taskId: string;
  agentId: string;
  goal: string;                        // Original task description
  mode: "linear" | "dag";
  steps: PlanStep[];
  status: "active" | "completed" | "failed" | "abandoned";
  version: number;                     // Increments on replan/patch
  createdAt: string;
  updatedAt: string;
  totalTokens: number;
  totalCost: number;
}
```

**ID strategy:** Step IDs are `s1`, `s2`, `s3` — deterministic from array position, 2 tokens max. Plan IDs are `p_<4-char-random>` — unique within agent lifetime, human-readable in logs. No ULIDs or UUIDs in LLM-visible contexts.

**Step reference syntax:** `{{from_step:s2}}` in `toolArgs` or `instruction` fields. Resolved by framework code before execution.

### 2. Structured Output Pipeline

Reusable JSON extraction from any LLM provider. Lives in the shared reasoning layer — usable by all strategies and user code.

```typescript
interface StructuredOutputConfig<T> {
  schema: Schema.Schema<T>;           // Effect-TS Schema for validation
  prompt: string;                      // Task prompt
  systemPrompt?: string;
  examples?: T[];                      // Few-shot examples
  maxRetries?: number;                 // Default: 2
  temperature?: number;                // Default: 0.3
  repairStrategy?: "json-fix" | "re-extract" | "both";  // Default: "both"
}

interface StructuredOutputResult<T> {
  data: T;                             // Validated, typed output
  raw: string;                         // Original LLM response
  attempts: number;                    // How many tries
  repaired: boolean;                   // Whether JSON repair was needed
}
```

**4-layer fallback pipeline:**

1. **High-signal prompting** — Schema as JSON example (not TypeScript types), few-shot examples from memory, "respond with ONLY valid JSON" instruction. Tier-adaptive: frontier models get schema once; local models get schema + concrete example + recency anchor.

2. **JSON extraction & repair** (pure functions, no LLM) — Strip markdown fences, find first `{`/`[`, match closing bracket. Fix trailing commas, single→double quotes, unescaped newlines. Handle truncated JSON.

3. **Schema validation with coercion** — `Schema.decodeUnknown(schema)` with Effect-TS type coercion. Collect specific field errors for retry.

4. **Retry with error feedback** — Focused retry prompt with specific field errors. Lower temperature (0.1). Max 2 retries default.

**Worst case:** 3 LLM calls (initial + 2 retries). Best case: 1 call, 0 repair.

### 3. Provider-Adaptive Structured Output

Each LLM provider adapter exposes its structured output capabilities:

```typescript
interface StructuredOutputCapabilities {
  nativeJsonMode: boolean;       // OpenAI, Gemini, Ollama
  jsonSchemaEnforcement: boolean; // OpenAI structured outputs
  prefillSupport: boolean;       // Anthropic
  grammarConstraints: boolean;   // Ollama/llama.cpp GBNF
}
```

| Provider | Native JSON | Schema Enforcement | Prefill | Grammar |
|---|---|---|---|---|
| OpenAI | `response_format: { type: "json_object" }` | `response_format: { type: "json_schema" }` | No | No |
| Anthropic | No | No | Yes — `{` as assistant prefill | No |
| Gemini | `responseMimeType: "application/json"` | `responseSchema` | No | No |
| Ollama | `format: "json"` | No | No | GBNF `grammar` param |
| LiteLLM | Pass-through | Pass-through | Pass-through | Pass-through |

Pipeline strategy selection:
1. Schema enforcement available → pass JSON Schema directly (most reliable)
2. Native JSON mode → enable JSON flag + prompt engineering
3. Prefill support → inject `{` as assistant message start
4. Grammar constraints → convert schema to GBNF
5. None → pure prompt engineering + aggressive repair

New method on `LLMService`: `getStructuredOutputCapabilities()`.
Future providers implement this method; pipeline automatically uses best path.

### 4. Plan Execution Engine

**Step dispatch by type:**

- **`tool_call`** — Direct dispatch. No LLM needed. Resolve `{{from_step:X}}` references, call `toolService.execute()` directly. Fastest path.

- **`analysis`** — Goal-anchored kernel. Tightly scoped prompt with: (1) overall goal always visible at top, (2) step number and total, (3) previous step data injected, (4) no tools or only explicitly needed tools. Max 2-3 iterations.

- **`composite`** — Scoped kernel. Only tools listed in `toolHints` are shown in the schema section. Reduces model confusion for small models.

**Analysis step prompt structure:**
```
OVERALL GOAL: [original task verbatim]

CURRENT STEP (2 of 3): [step title]
INSTRUCTION: [step instruction]

DATA FROM PREVIOUS STEPS:
  Step 1 (s1) result: [compressed result]

[Tool section — only if composite, scoped to toolHints]

Produce your answer. Write FINAL ANSWER: <your answer> when done.
```

**DAG execution (opt-in):**
- Topologically sort steps by `dependsOn`
- Group steps with all dependencies satisfied into "waves"
- Execute each wave concurrently via `Effect.all(stepEffects, { concurrency: "unbounded" })`
- Linear mode degenerates to waves of 1 step — same code path

**Retry & replan logic (graduated):**

```typescript
interface PlanExecuteConfig {
  maxRefinements: number;           // Full plan regenerations (default: 1)
  reflectionDepth: "shallow" | "deep";
  planMode: "linear" | "dag";
  stepRetries: number;              // Per-step retries before patching (default: 1)
  patchStrategy: "in-place" | "replan-remaining";  // Default: "in-place"
  stepKernelMaxIterations: number;  // For composite/analysis steps (default: 3)
}
```

Recovery flow:
1. Step fails → retry once with error feedback injected
2. Retry fails → LLM patches just the failed + remaining steps (completed steps untouched)
3. Patch fails → full reflect + replan cycle (`refinement++`)
4. All refinements exhausted → return partial result with failure context

Each state change persisted to SQLite.

### 5. SQLite Persistence

Two new tables in the existing memory database:

```sql
CREATE TABLE IF NOT EXISTS plans (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  goal        TEXT NOT NULL,
  mode        TEXT NOT NULL DEFAULT 'linear',
  status      TEXT NOT NULL DEFAULT 'active',
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  total_tokens INTEGER DEFAULT 0,
  total_cost  REAL DEFAULT 0
);

CREATE INDEX idx_plans_agent_status ON plans(agent_id, status);
CREATE INDEX idx_plans_task ON plans(task_id);

CREATE TABLE IF NOT EXISTS plan_steps (
  id          TEXT PRIMARY KEY,
  plan_id     TEXT NOT NULL REFERENCES plans(id),
  seq         INTEGER NOT NULL,
  title       TEXT NOT NULL,
  instruction TEXT NOT NULL,
  type        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  tool_name   TEXT,
  tool_args   TEXT,
  tool_hints  TEXT,
  depends_on  TEXT,
  result      TEXT,
  error       TEXT,
  retries     INTEGER DEFAULT 0,
  tokens_used INTEGER DEFAULT 0,
  started_at  TEXT,
  completed_at TEXT
);

CREATE INDEX idx_plan_steps_plan ON plan_steps(plan_id, seq);
CREATE INDEX idx_plan_steps_status ON plan_steps(plan_id, status);
```

**PlanStore service:** Thin data-access layer — `savePlan`, `getPlan`, `getActivePlan`, `updateStepStatus`, `patchRemainingSteps`, `getRecentPlans`.

### 6. Memory Integration

**Episodic memory** — Plan lifecycle events logged after completion/failure:
- `eventType: "plan-completed"` or `"plan-failed"`
- Structured content: planId, goal, steps total/completed/failed, tools used, tokens, duration

**Semantic memory** — Successful plan patterns stored as generalizable knowledge:
- `category: "plan-pattern"`
- Content: generalized goal → step count, mode, key tools, success/duration
- Available at bootstrap as few-shot examples for future plan generation

**Plan resumption** — On bootstrap, check for active plan in SQLite:
- If found, resume from last pending step instead of replanning
- Crash recovery: plans survive process restarts

### 7. Plan Generation Prompts

**4-section dynamic prompt assembly:**

1. **Role & Goal** — original task verbatim, always first
2. **Available Tools** — pre-filtered to relevant tools (not all 48). Frontier: full param schemas. Local: name + one-liner signature.
3. **Past Plan Patterns** — from semantic memory bootstrap. Highest-signal input for plan quality.
4. **Schema & Output Instructions** — tier-adaptive:
   - Frontier/large: full JSON schema once
   - Mid/local: simpler schema + concrete task-specific example + recency anchor ("JSON only, no explanation:")

**Patch prompt:** Shows completed steps (checkmark), failed step (X with error), pending steps. Asks LLM to rewrite only the failed/remaining portion.

**Reflect prompt:** Lists all step results with status icons. Asks "SATISFIED: <summary>" or describe what's missing.

---

## Configuration

Builder API:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("ollama")
  .withModel("qwen3.5")
  .withTools()
  .withReasoning({
    defaultStrategy: "plan-execute-reflect",
    strategies: {
      planExecute: {
        planMode: "linear",                // "linear" | "dag"
        stepRetries: 1,                    // Per-step retries before patching
        patchStrategy: "in-place",         // "in-place" | "replan-remaining"
        maxRefinements: 1,                 // Full replan cycles
        reflectionDepth: "shallow",        // "shallow" | "deep"
        stepKernelMaxIterations: 3,        // For analysis/composite steps
      },
    },
  })
  .build();
```

---

## Files Changed / Created

| File | Change |
|---|---|
| `packages/reasoning/src/types/plan.ts` | **NEW** — Plan, PlanStep, LLMPlanOutput schemas |
| `packages/reasoning/src/structured-output/pipeline.ts` | **NEW** — `extractStructuredOutput()` pipeline |
| `packages/reasoning/src/structured-output/json-repair.ts` | **NEW** — JSON extraction & repair utilities |
| `packages/reasoning/src/structured-output/index.ts` | **NEW** — barrel export |
| `packages/reasoning/src/strategies/plan-execute.ts` | **REWRITE** — structured plan generation, typed step dispatch, retry/patch logic |
| `packages/reasoning/src/strategies/shared/plan-prompts.ts` | **NEW** — tier-adaptive plan/patch/reflect prompts |
| `packages/memory/src/services/plan-store.ts` | **NEW** — SQLite CRUD for plans + plan_steps |
| `packages/memory/src/database.ts` | **MODIFY** — add plans + plan_steps table creation |
| `packages/llm-provider/src/types.ts` | **MODIFY** — add `StructuredOutputCapabilities` interface |
| `packages/llm-provider/src/services/*.ts` | **MODIFY** — each provider implements `getStructuredOutputCapabilities()` |
| `packages/reasoning/src/types/config.ts` | **MODIFY** — extend `PlanExecuteConfig` with new fields |
| `packages/reasoning/src/strategies/shared/service-utils.ts` | **MODIFY** — add plan-aware service resolution |

---

## Test Strategy

- **Structured output pipeline:** JSON repair edge cases, schema validation, retry behavior, provider capability routing
- **Plan generation:** Valid plan output from prompt, tier-adaptive prompt assembly, past-pattern injection
- **Step execution:** tool_call direct dispatch, analysis kernel focus, composite scoped tools, step reference resolution
- **Retry/replan:** Step retry with error feedback, in-place patching, full replan cycle
- **Persistence:** SQLite round-trip (save/load/update), plan resumption after simulated crash
- **DAG execution:** Parallel wave dispatch, dependency resolution, topological sort
- **Integration:** End-to-end with TestLLMServiceLayer producing structured JSON plans
