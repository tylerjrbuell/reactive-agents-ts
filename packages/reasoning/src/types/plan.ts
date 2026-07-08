// File: src/types/plan.ts
import { Schema } from "effect";
import { fromStepRe } from "../assembly/ref-grammar.js";

// ─── Short ID Generator ───

// 6 base36 chars of entropy (~2.2B space). The previous 4 chars (~1.7M) made a
// 100-id uniqueness draw collide ~0.3% of the time — a real CI flake. Stays
// within the 8-char id budget (`p_` + 6).
export const shortId = (): string =>
  `p_${Math.random().toString(36).slice(2, 8).padEnd(6, "0").slice(0, 6)}`;

// ─── LLM Plan Step (content-only, from LLM output) ───

export const LLMPlanStepSchema = Schema.Struct({
  title: Schema.String,
  instruction: Schema.String,
  type: Schema.Literal("tool_call", "analysis", "composite"),
  toolName: Schema.optional(Schema.String),
  toolArgs: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
  toolHints: Schema.optional(Schema.Array(Schema.String)),
  dependsOn: Schema.optional(Schema.Array(Schema.String)),
  rationale: Schema.optional(
    Schema.Struct({
      why: Schema.String,
      confidence: Schema.optional(Schema.Number),
    }),
  ),
});
export type LLMPlanStep = typeof LLMPlanStepSchema.Type;

// ─── LLM Plan Output (top-level LLM response) ───

export const LLMPlanOutputSchema = Schema.Struct({
  steps: Schema.Array(LLMPlanStepSchema),
});
export type LLMPlanOutput = typeof LLMPlanOutputSchema.Type;

// ─── Plan Step Status ───

export const PlanStepStatusSchema = Schema.Literal(
  "pending",
  "in_progress",
  "completed",
  "failed",
  "skipped",
);
export type PlanStepStatus = typeof PlanStepStatusSchema.Type;

// ─── Plan Status ───

export const PlanStatusSchema = Schema.Literal(
  "active",
  "completed",
  "failed",
  "abandoned",
);
export type PlanStatus = typeof PlanStatusSchema.Type;

// ─── Plan Step (hydrated with metadata) ───

export interface PlanStep {
  id: string;
  seq: number;
  title: string;
  instruction: string;
  type: "tool_call" | "analysis" | "composite";
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolHints?: readonly string[];
  dependsOn?: readonly string[];
  rationale?: { why: string; confidence?: number };
  status: PlanStepStatus;
  result?: string;
  /**
   * Full sanitized (uncompressed) tool result for tool_call steps. `result`
   * holds the compressed preview consumed by intermediate prompts; `fullResult`
   * preserves the complete data so synthesis can render every item. Undefined
   * for analysis/composite steps (their `result` already IS full content).
   */
  fullResult?: string;
  error?: string;
  retries: number;
  tokensUsed: number;
  startedAt?: string;
  completedAt?: string;
}

// ─── Plan ───

export interface Plan {
  id: string;
  taskId: string;
  agentId: string;
  goal: string;
  mode: "linear" | "dag";
  steps: PlanStep[];
  status: PlanStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  totalTokens: number;
  totalCost: number;
}

// ─── Plan Context (input for hydration) ───

export interface PlanContext {
  taskId: string;
  agentId: string;
  goal: string;
  planMode: "linear" | "dag";
}

// ─── Hydrate Plan ───

export const hydratePlan = (raw: LLMPlanOutput, context: PlanContext): Plan => {
  const now = new Date().toISOString();
  const steps: PlanStep[] = raw.steps.map((step, index) => ({
    id: `s${index + 1}`,
    seq: index + 1,
    title: step.title,
    instruction: step.instruction,
    type: step.type,
    toolName: step.toolName,
    toolArgs: step.toolArgs,
    toolHints: step.toolHints,
    dependsOn: step.dependsOn,
    rationale: step.rationale,
    status: "pending" as PlanStepStatus,
    retries: 0,
    tokensUsed: 0,
  }));

  return {
    id: shortId(),
    taskId: context.taskId,
    agentId: context.agentId,
    goal: context.goal,
    mode: context.planMode,
    steps,
    status: "active",
    version: 1,
    createdAt: now,
    updatedAt: now,
    totalTokens: 0,
    totalCost: 0,
  };
};

// ─── Resolve Step References ───

/**
 * Cap for the bare `{{from_step:sN}}` projection. Chained tool args are the
 * consumer (search queries, ids, short values) — FM#3 (2026-07-07 census):
 * splicing the FULL compressed-preview blob into a downstream web-search
 * `query` blew Tavily's 400-char cap and 400'd deterministically (3/3 rw-1
 * traces, 8 failures). 380 leaves headroom under that cap; use `:full` when a
 * step genuinely transfers whole content (e.g. file-write `content`).
 */
const BARE_REF_MAX_CHARS = 380;

/** Strip display-oriented noise (preview banners, whitespace runs) from a step
 * result before it is spliced into a downstream tool argument. */
const distillStepResult = (raw: string): string =>
  raw
    .replace(/^\[[^\]]{0,80}(?:preview|result)[^\]]{0,80}\]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

export const resolveStepReferences = (
  args: Record<string, unknown>,
  completedSteps: PlanStep[],
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      result[key] = value.replace(
        fromStepRe(),
        (match, stepId, _offset, _full) => {
          const step = completedSteps.find((s) => s.id === stepId);
          if (!step || step.result === undefined) return match;
          // :full transfers WHOLE content (e.g. file-write `content`). Prefer
          // step.fullResult — the uncompressed tool payload — over step.result,
          // which for tool steps is the compressed preview. Hotfix 0.5-2
          // (2026-07-07): returning step.result here silently truncated the
          // exact case :full exists for (FM#3 sibling). Analysis steps have no
          // fullResult and their result IS full, so the ?? falls through cleanly.
          if (match.includes(":full}}")) return step.fullResult ?? step.result;
          // :summary gets the same banner-strip as bare refs: the rw-1 rerun
          // (2026-07-07) showed models template :summary into search queries,
          // and a raw preview slice still starts with the display banner and
          // still blows Tavily's 400-char cap.
          if (match.includes(":summary}}"))
            return distillStepResult(step.result).slice(0, 500);
          // Discriminate by source-step kind: TOOL results are display-oriented
          // compressed previews (banner + URLs) that break short downstream args
          // (FM#3 — Tavily 400s); ANALYSIS outputs are authored content a
          // downstream step consumes deliberately — pass those through whole.
          if (step.toolName === undefined) return step.result;
          return distillStepResult(step.result).slice(0, BARE_REF_MAX_CHARS);
        },
      );
    } else {
      result[key] = value;
    }
  }
  return result;
};

// ─── Dependency Analysis & Wave Scheduling ───

// C3 (2026-07-08): the from_step grammar is the ONE shared with the recall/ref
// grammar module (assembly/ref-grammar.ts). matchAll clones its regex, so a
// single module-level instance stays lastIndex-safe.
const FROM_STEP_RE = fromStepRe();

/**
 * Extract all step IDs that a step depends on, from both `dependsOn` and
 * `{{from_step:sN}}` references in toolArgs/instruction.
 */
export const extractDependencies = (step: PlanStep): ReadonlySet<string> => {
  const deps = new Set<string>(step.dependsOn ?? []);
  if (step.toolArgs) {
    for (const value of Object.values(step.toolArgs)) {
      if (typeof value === "string") {
        for (const match of value.matchAll(FROM_STEP_RE)) {
          deps.add(match[1]!);
        }
      }
    }
  }
  for (const match of step.instruction.matchAll(FROM_STEP_RE)) {
    deps.add(match[1]!);
  }
  return deps;
};

/**
 * Group pending steps into parallel execution waves based on dependencies.
 * Returns waves in execution order: wave[0] can run immediately, wave[1]
 * after wave[0] completes, etc.
 */
export const computeWaves = (
  steps: readonly PlanStep[],
  completedIds: ReadonlySet<string>,
): PlanStep[][] => {
  const pending = steps.filter((s) => s.status !== "completed" && s.status !== "skipped");
  const waves: PlanStep[][] = [];
  const done = new Set(completedIds);

  let remaining = [...pending];
  while (remaining.length > 0) {
    const wave = remaining.filter((s) => {
      const deps = extractDependencies(s);
      for (const dep of deps) {
        if (!done.has(dep)) return false;
      }
      return true;
    });

    if (wave.length === 0) {
      // Cycle or unresolvable — fall back to sequential
      waves.push(remaining);
      break;
    }

    waves.push(wave);
    for (const s of wave) done.add(s.id);
    remaining = remaining.filter((s) => !wave.includes(s));
  }
  return waves;
};
