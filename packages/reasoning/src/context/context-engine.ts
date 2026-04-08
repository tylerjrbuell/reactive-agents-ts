// File: src/context/context-engine.ts
//
// ContextEngine — unified scoring, budgeting, and rendering of context.

import type { ReasoningStep } from "../types/step.js";
import type { ContextProfile } from "./context-profile.js";
import type { ToolSchema } from "../strategies/kernel/utils/tool-utils.js";
import {
  formatToolSchemas,
  formatToolSchemaCompact,
  formatToolSchemaMicro,
} from "../strategies/kernel/utils/tool-utils.js";
import { formatStepForContext, summarizeStepsTriplets } from "../strategies/kernel/utils/context-utils.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** A scored context item — steps, rules, tool refs, task, or memories. */
export interface ContextItem {
  type: "thought" | "action" | "observation" | "rules" | "task" | "tool-ref" | "memory";
  content: string;
  iteration: number;
  pinned: boolean;
  /** Whether this observation represents a failed tool call */
  failed?: boolean;
}

/** Memory retrieved from episodic/semantic stores. */
export interface MemoryItem {
  content: string;
  relevance: number;
}

/** Context needed to score items. */
export interface ScoringContext {
  currentIteration: number;
  taskDescription: string;
  maxIterations: number;
}

/** Budget allocation result — items sorted into sections. */
export interface BudgetResult {
  pinned: ContextItem[];
  recent: ContextItem[];
  scored: ContextItem[];
  memories: MemoryItem[];
}

/** Input for the static system prompt builder. */
export interface StaticContextInput {
  task: string;
  profile: ContextProfile;
  availableToolSchemas?: readonly ToolSchema[];
  requiredTools?: readonly string[];
  /** Custom environment context key-value pairs (merged with auto-detected defaults) */
  environmentContext?: Readonly<Record<string, string>>;
}

/** Input for the dynamic per-iteration context builder. */
export interface DynamicContextInput {
  task: string;
  steps: readonly ReasoningStep[];
  iteration: number;
  maxIterations: number;
  profile: ContextProfile;
  availableToolSchemas?: readonly ToolSchema[];
  requiredTools?: readonly string[];
  priorContext?: string;
  memories?: MemoryItem[];
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Exponential decay rate applied per iteration distance in recency scoring. */
const RECENCY_DECAY_RATE = 0.3;

/** Minimum relevance score for a memory item to be included in context. */
const MEMORY_RELEVANCE_THRESHOLD = 0.3;

/**
 * Fraction of remaining iterations at which the "LAST CHANCE" urgency message
 * is shown (e.g. 0.2 = last 20% of iterations).
 */
const URGENCY_LAST_CHANCE_THRESHOLD = 0.2;

/**
 * Fraction of remaining iterations at which the "Be decisive" urgency message
 * is shown (e.g. 0.4 = last 40% of iterations).
 */
const URGENCY_DECISIVE_THRESHOLD = 0.4;

/** Stop words excluded from keyword-overlap relevance scoring. */
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "to", "of", "in", "for",
  "and", "or", "on", "at", "by", "with", "from", "that", "this", "it",
]);

// ── Scoring ──────────────────────────────────────────────────────────────────

/** Type weights: observations are most valuable, thoughts least. */
const TYPE_WEIGHTS: Record<string, number> = {
  observation: 0.8,
  action: 0.6,
  thought: 0.4,
  rules: 1.0,
  task: 1.0,
  "tool-ref": 1.0,
  memory: 0.5,
};

/**
 * Score a context item from 0.0 to 1.0.
 *
 * Components:
 * - pinScore: Hard 1.0 for pinned/rules/task items
 * - recencyScore: Exponential decay from current iteration
 * - relevanceScore: Keyword overlap with task description
 * - outcomeScore: 1.5x boost for failed observations
 * - typeWeight: observations 0.8 > actions 0.6 > thoughts 0.4
 */
export function scoreContextItem(item: ContextItem, ctx: ScoringContext): number {
  // Pinned items always score 1.0
  if (item.pinned) return 1.0;

  const typeWeight = TYPE_WEIGHTS[item.type] ?? 0.5;

  // Recency: exponential decay based on iteration distance
  const iterDiff = Math.max(0, ctx.currentIteration - item.iteration);
  const recencyScore = Math.exp(-RECENCY_DECAY_RATE * iterDiff);

  // Relevance: keyword overlap between item content and task
  const relevanceScore = computeKeywordOverlap(item.content, ctx.taskDescription);

  // Outcome: failed observations get a 1.5x boost
  const outcomeScore = item.type === "observation" && item.failed ? 1.5 : 1.0;

  // Weighted combination — recency dominates, relevance and type refine
  const raw = (recencyScore * 0.5 + relevanceScore * 0.2 + typeWeight * 0.3) * outcomeScore;

  return Math.min(1.0, raw);
}

/**
 * Compute keyword overlap between two strings.
 * Returns 0.0-1.0 based on fraction of task keywords found in content.
 */
function computeKeywordOverlap(content: string, taskDescription: string): number {
  const taskWords = taskDescription
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  if (taskWords.length === 0) return 0;

  const contentLower = content.toLowerCase();
  const matches = taskWords.filter((w) => contentLower.includes(w));
  return matches.length / taskWords.length;
}

// ── Budget Allocation ────────────────────────────────────────────────────────

/**
 * Allocate context items into sections based on scoring and profile.
 *
 * Sections:
 * - Pinned: ~15% (tool ref, task, rules — always included)
 * - Recent: ~45% (last N steps, N = profile.fullDetailSteps)
 * - Scored: ~25% (older steps ranked by score, compacted)
 * - Memory: ~10% (task-relevant memories with relevance >= MEMORY_RELEVANCE_THRESHOLD)
 *
 * @remarks This function is a lower-level primitive exported for callers who
 * want programmatic access to the scored/bucketed result (e.g. custom renderers,
 * tests, or advanced callers). `buildContext()` uses its own inline compaction
 * logic and does not call this function directly.
 */
export function allocateContextBudget(
  items: readonly ContextItem[],
  profile: ContextProfile,
  ctx: ScoringContext,
): BudgetResult {
  const fullDetailSteps = profile.fullDetailSteps ?? 4;

  const pinned: ContextItem[] = [];
  const unpinned: ContextItem[] = [];

  for (const item of items) {
    if (item.pinned) {
      pinned.push(item);
    } else {
      unpinned.push(item);
    }
  }

  // Split unpinned into recent and older
  const recentCutoff = ctx.currentIteration - fullDetailSteps;
  const recent: ContextItem[] = [];
  const older: ContextItem[] = [];

  for (const item of unpinned) {
    if (item.iteration >= recentCutoff) {
      recent.push(item);
    } else {
      older.push(item);
    }
  }

  // Score and sort older items (highest first)
  const scored = older
    .map((item) => ({ item, score: scoreContextItem(item, ctx) }))
    .sort((a, b) => b.score - a.score)
    .map((s) => s.item);

  return {
    pinned,
    recent,
    scored,
    memories: [], // Memories handled separately in buildContext
  };
}

// ── Split Context Builders (system prompt + per-iteration) ──────────────────

/**
 * Build the STATIC portion of context — tool schemas, RULES, task description.
 * This content is identical across all iterations and belongs in the system prompt
 * to avoid token waste from repetition.
 */
/**
 * Build environment context — date, time, timezone, platform, and custom fields.
 * Always included so the agent knows the current temporal context without tool calls.
 */
export function buildEnvironmentContext(
  custom?: Readonly<Record<string, string>>,
): string {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const lines: string[] = [
    `Date: ${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`,
    `Time: ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}`,
    `Timezone: ${tz}`,
    `Platform: ${typeof process !== "undefined" ? `${process.platform} (${process.arch})` : "unknown"}`,
  ];
  if (custom) {
    for (const [k, v] of Object.entries(custom)) {
      lines.push(`${k}: ${v}`);
    }
  }
  return `Environment:\n${lines.join("\n")}`;
}

export function buildStaticContext(input: StaticContextInput): string {
  const { task, profile, availableToolSchemas, requiredTools } = input;
  const sections: string[] = [];

  // Environment context (date, time, timezone, platform, custom)
  sections.push(buildEnvironmentContext(input.environmentContext));

  // Tool reference (full schemas — no pinned duplicate needed since both
  // tool ref and RULES are together in the system prompt now)
  sections.push(
    buildToolReference(task, availableToolSchemas, requiredTools, profile.toolSchemaDetail, profile.tier),
  );

  // Task description
  sections.push(`Task: ${task}`);

  // RULES block
  sections.push(buildRules(availableToolSchemas, requiredTools, profile.tier));

  return sections.join("\n\n");
}

/**
 * Build the DYNAMIC portion of context — step history, memories, iteration
 * awareness, and completed summary. This changes every iteration.
 */
export function buildDynamicContext(input: DynamicContextInput): string {
  const {
    steps, iteration, maxIterations, profile,
    priorContext, memories, availableToolSchemas,
  } = input;

  const sections: string[] = [];

  // Prior context (reflexion critique, plan-execute plan, etc.)
  if (priorContext) sections.push(priorContext);

  // Memory section
  if (memories && memories.length > 0) {
    const relevant = memories.filter((m) => m.relevance >= MEMORY_RELEVANCE_THRESHOLD);
    if (relevant.length > 0) {
      const memLines = relevant.map((m) => `- ${m.content}`).join("\n");
      sections.push(`[Relevant memories]:\n${memLines}`);
    }
  }

  // Step history (scored older + recent)
  if (steps.length > 0) {
    const compactAfter = profile.compactAfterSteps ?? 6;
    const fullDetailN = profile.fullDetailSteps ?? 4;

    if (steps.length <= compactAfter) {
      const stepLines = steps.map(formatStepForContext).join("\n");
      sections.push(stepLines);
    } else {
      const recentCutoff = steps.length - fullDetailN;
      const olderSteps = steps.slice(0, recentCutoff);
      const recentSteps = steps.slice(recentCutoff);

      if (olderSteps.length > 0) {
        const summaryLines = summarizeStepsTriplets(olderSteps);
        sections.push(
          `[Earlier steps — ${olderSteps.length} steps]:\n${summaryLines.join("\n")}`,
        );
      }
      const recentLines = recentSteps.map(formatStepForContext).join("\n");
      sections.push(`[Recent steps]:\n${recentLines}`);
    }
  }

  // Completed summary
  const completedSummary = buildCompletedSummary(steps);
  if (completedSummary) sections.push(completedSummary);

  // Iteration awareness
  sections.push(buildIterationAwareness(iteration, maxIterations));

  // Reminder of final-answer tool when visible (nudge toward structured exit)
  const finalAnswerSchema = (availableToolSchemas ?? []).find((t) => t.name === "final-answer");
  if (finalAnswerSchema) {
    sections.push(`💡 The final-answer tool is available. When ALL steps are complete, call it directly to deliver your answer.`);
  }

  return sections.join("\n\n");
}

// ── Private Helpers ──────────────────────────────────────────────────────────

/**
 * Build the initial tool section from schemas.
 * Native FC is always active — lists tool names/purposes without ACTION: instructions.
 */
function buildToolReference(
  _task: string,
  availableToolSchemas?: readonly ToolSchema[],
  requiredTools?: readonly string[],
  toolSchemaDetail?: "names-only" | "names-and-types" | "full",
  tier?: string,
): string {
  if (!availableToolSchemas || availableToolSchemas.length === 0) {
    return "No tools available for this task.";
  }

  const detail = toolSchemaDetail ?? "full";

  // Tier-adaptive compression (only when full schema verbosity is requested — preserves names-only/names-and-types overrides)
  if (tier === "local" && detail === "full") {
    const required = new Set(requiredTools ?? []);
    const requiredSchemas = availableToolSchemas.filter((t) => required.has(t.name));
    const otherSchemas = availableToolSchemas.filter((t) => !required.has(t.name));
    const lines: string[] = [];
    if (requiredSchemas.length > 0) {
      lines.push("Required tools (call these):");
      lines.push(...requiredSchemas.map(formatToolSchemaCompact));
    }
    if (otherSchemas.length > 0) {
      if (lines.length > 0) lines.push("Other available tools:");
      else lines.push("Available tools:");
      lines.push(...otherSchemas.map(formatToolSchemaMicro));
    }
    return lines.join("\n");
  }

  if (tier === "mid" && detail === "full") {
    const toolLines = availableToolSchemas.map(formatToolSchemaCompact).join("\n");
    return `Available Tools:\n${toolLines}`;
  }

  // large / frontier / unspecified (or explicit names-only override) — existing behavior preserved exactly

  if (detail === "names-only") {
    const names = availableToolSchemas.map((t) => t.name).join(", ");
    return `Available Tools: ${names}`;
  }
  if (detail === "names-and-types" || availableToolSchemas.length > 20) {
    const toolLines = availableToolSchemas.map(formatToolSchemaCompact).join("\n");
    return `Available Tools:\n${toolLines}`;
  }
  const toolLines = formatToolSchemas(availableToolSchemas);
  return `Available Tools:\n${toolLines}`;
}

/**
 * Build a summary of already-completed (successful) observations.
 */
function buildCompletedSummary(steps: readonly ReasoningStep[]): string {
  const toolCounts = new Map<string, number>();
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    if (step.type !== "action") continue;
    const next = steps[i + 1];
    if (next?.type !== "observation" || next.metadata?.observationResult?.success !== true) continue;
    try {
      const parsed = JSON.parse(step.content);
      if (parsed.tool) {
        toolCounts.set(parsed.tool, (toolCounts.get(parsed.tool) ?? 0) + 1);
      }
    } catch {
      /* not parseable */
    }
  }
  if (toolCounts.size === 0) return "";
  const parts = Array.from(toolCounts.entries())
    .map(([tool, count]) => (count > 1 ? `${tool} \u2713 (${count}x)` : `${tool} \u2713`))
    .join(", ");
  return `ALREADY DONE: ${parts}\n\u2193 Pick your next action from tools NOT listed above.`;
}

/**
 * Build iteration awareness string with progressive urgency.
 */
function buildIterationAwareness(iteration: number, maxIterations: number): string {
  const remaining = maxIterations - iteration;
  if (remaining <= Math.ceil(maxIterations * URGENCY_LAST_CHANCE_THRESHOLD)) {
    return `[Iteration ${iteration + 1}/${maxIterations} \u2014 LAST CHANCE. Give FINAL ANSWER now or next turn.]`;
  }
  if (remaining <= Math.ceil(maxIterations * URGENCY_DECISIVE_THRESHOLD)) {
    return `[Iteration ${iteration + 1}/${maxIterations} \u2014 ${remaining} remaining. Be decisive.]`;
  }
  return `[Iteration ${iteration + 1}/${maxIterations}]`;
}

/**
 * Build the RULES block with dynamic entries for required tools and delegation.
 * Tier-adaptive: local/mid models get 5 core rules; large/frontier get full set.
 */
export function buildRules(
  availableToolSchemas?: readonly ToolSchema[],
  requiredTools?: readonly string[],
  tier?: "local" | "mid" | "large" | "frontier",
): string {
  const t = tier ?? "mid";
  const hasSpawnAgent = availableToolSchemas?.some((s) => s.name === "spawn-agent");
  const hasStoredResults = availableToolSchemas?.some((s) => s.name === "recall");

  // Core rules — always included, small-model-safe count
  const rules: string[] = [
    "1. ONE action per turn. Wait for the result before proceeding.",
    "2. Use EXACT parameter names from the tool reference.",
    "3. Do NOT fabricate data. Only use information from tool results.",
    "4. Once a tool succeeds, do NOT repeat it.",
  ];

  let ruleNum = 5;

  // Required tools rule — always included when applicable
  if (requiredTools && requiredTools.length > 0) {
    rules.push(
      `${ruleNum++}. ⭐ REQUIRED tools MUST be called before giving FINAL ANSWER.`,
    );
  }

  // Conditional rules — only for larger models or when the feature is active
  if (t === "large" || t === "frontier") {
    if (hasStoredResults) {
      rules.push(
        `${ruleNum++}. Large tool results are stored automatically. Use recall(key) to retrieve full content when needed.`,
      );
    }
    if (hasSpawnAgent) {
      rules.push(
        `${ruleNum++}. DELEGATION: spawn-agent has NO context. Include ALL values (numbers, URLs, IDs) in the "task" field.`,
      );
    }
  } else {
    // For local/mid: only add recall rule if recall is available (concise version)
    if (hasStoredResults) {
      rules.push(
        `${ruleNum++}. Large results are stored automatically. Use recall(key) to retrieve them.`,
      );
    }
    if (hasSpawnAgent) {
      rules.push(
        `${ruleNum++}. spawn-agent has NO context. Put ALL values in the "task" field.`,
      );
    }
  }

  return `RULES:\n${rules.join("\n")}`;
}
