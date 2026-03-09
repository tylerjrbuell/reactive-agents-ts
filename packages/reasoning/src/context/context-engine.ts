// File: src/context/context-engine.ts
//
// ContextEngine — unified scoring, budgeting, and rendering of context.
// Replaces 6 static builders in react-kernel.ts with a single `buildContext()`.

import type { ReasoningStep } from "../types/step.js";
import type { ContextProfile } from "./context-profile.js";
import type { ToolSchema } from "../strategies/shared/tool-utils.js";
import {
  formatToolSchemas,
  formatToolSchemaCompact,
  filterToolsByRelevance,
} from "../strategies/shared/tool-utils.js";
import { formatStepForContext, summarizeStepForContext } from "../strategies/shared/context-utils.js";

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

/** Input for the unified buildContext function. */
export interface ContextBuildInput {
  task: string;
  steps: readonly ReasoningStep[];
  iteration: number;
  maxIterations: number;
  profile: ContextProfile;
  availableToolSchemas?: readonly ToolSchema[];
  requiredTools?: readonly string[];
  priorContext?: string;
  memories?: MemoryItem[];
  systemPrompt?: string;
}

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
  const recencyScore = Math.exp(-0.3 * iterDiff);

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
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "to", "of", "in", "for",
    "and", "or", "on", "at", "by", "with", "from", "that", "this", "it",
  ]);
  const taskWords = taskDescription
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
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
 * - Memory: ~10% (task-relevant memories with relevance >= 0.3)
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

// ── Unified Context Builder ──────────────────────────────────────────────────

/**
 * Build the full context string for an LLM prompt.
 * Replaces 6 separate builders with a single scored, budgeted render.
 *
 * Section order (tool ref first, task last for recency bias):
 * 1. Tool reference (pinned, with required tool markers)
 * 2. Memory section (if relevant)
 * 3. Scored history (compacted older steps)
 * 4. Recent steps (full detail)
 * 5. Completed summary (tool usage tally)
 * 6. Task description
 * 7. Iteration awareness (progressive urgency)
 * 8. RULES block (with dynamic required tool + delegation rules)
 */
export function buildContext(input: ContextBuildInput): string {
  const {
    task,
    steps,
    iteration,
    maxIterations,
    profile,
    availableToolSchemas,
    requiredTools,
    priorContext,
    memories,
  } = input;

  const sections: string[] = [];

  // 1. Tool reference
  sections.push(buildToolReference(task, availableToolSchemas, requiredTools, profile.toolSchemaDetail));

  // 2. Prior context (if provided)
  if (priorContext) {
    sections.push(priorContext);
  }

  // 3. Memory section
  if (memories && memories.length > 0) {
    const relevant = memories.filter((m) => m.relevance >= 0.3);
    if (relevant.length > 0) {
      const memLines = relevant.map((m) => `- ${m.content}`).join("\n");
      sections.push(`[Relevant memories]:\n${memLines}`);
    }
  }

  // 4-5. Step history (scored older + recent)
  if (steps.length > 0) {
    const compactAfter = profile.compactAfterSteps ?? 6;
    const fullDetailN = profile.fullDetailSteps ?? 4;

    if (steps.length <= compactAfter) {
      // All steps in full detail
      const stepLines = steps.map(formatStepForContext).join("\n");
      sections.push(stepLines);
    } else {
      // Split into compacted older + full recent
      const recentCutoff = steps.length - fullDetailN;
      const olderSteps = steps.slice(0, recentCutoff);
      const recentSteps = steps.slice(recentCutoff);

      // Compacted older steps
      if (olderSteps.length > 0) {
        const summaryLines = olderSteps.map(summarizeStepForContext);
        sections.push(
          `[Earlier steps — ${olderSteps.length} steps]:\n${summaryLines.join("\n")}`,
        );
      }

      // Recent steps in full detail
      const recentLines = recentSteps.map(formatStepForContext).join("\n");
      sections.push(`[Recent steps]:\n${recentLines}`);
    }
  }

  // 6. Completed summary
  const completedSummary = buildCompletedSummary(steps);
  if (completedSummary) {
    sections.push(completedSummary);
  }

  // 7. Pinned tool reference (compact, survives compaction)
  const pinnedRef = buildPinnedToolReference(availableToolSchemas, requiredTools, profile.toolSchemaDetail);
  if (pinnedRef) {
    sections.push(pinnedRef);
  }

  // 8. Iteration awareness
  sections.push(buildIterationAwareness(iteration, maxIterations));

  // 9. Task description (last for recency bias)
  sections.push(`Task: ${task}`);

  // 10. RULES block
  sections.push(buildRules(availableToolSchemas, requiredTools));

  return sections.join("\n\n");
}

// ── Private Helpers ──────────────────────────────────────────────────────────

/**
 * Build the initial tool section from schemas.
 */
function buildToolReference(
  task: string,
  availableToolSchemas?: readonly ToolSchema[],
  requiredTools?: readonly string[],
  toolSchemaDetail?: "names-only" | "names-and-types" | "full",
): string {
  if (!availableToolSchemas || availableToolSchemas.length === 0) {
    return "No tools available for this task.";
  }

  const detail = toolSchemaDetail ?? "full";

  // Check for name-only stubs
  const allNameOnly = availableToolSchemas.every(
    (t) => !t.description && t.parameters.length === 0,
  );
  if (allNameOnly) {
    const names = availableToolSchemas.map((t) => t.name).join(", ");
    return `Available Tools: ${names}\nTo use a tool: ACTION: tool_name({"param": "value"}) — use JSON for tool arguments.`;
  }

  const { primary, secondary } = filterToolsByRelevance(task, availableToolSchemas);

  if (primary.length === 0) {
    // No tools matched task — format all based on detail level
    if (detail === "names-only") {
      return `Tools: ${availableToolSchemas.map((t) => t.name).join(", ")}\nTo use: ACTION: tool_name({"param": "value"})`;
    }
    if (detail === "names-and-types" || availableToolSchemas.length > 20) {
      const toolLines = availableToolSchemas.map(formatToolSchemaCompact).join("\n");
      return `Available Tools:\n${toolLines}\n\nTo use a tool: ACTION: tool_name({"param": "value"}) — use EXACT parameter names.`;
    }
    const toolLines = formatToolSchemas(availableToolSchemas);
    return `Available Tools:\n${toolLines}\n\nTo use a tool: ACTION: tool_name({"param": "value"}) — use EXACT parameter names shown above, valid JSON only.`;
  }

  // Format primary + secondary
  const primaryLines =
    detail === "names-only"
      ? primary.map((t) => t.name).join(", ")
      : detail === "names-and-types"
        ? primary.map(formatToolSchemaCompact).join("\n")
        : formatToolSchemas(primary);

  let secondarySection = "";
  if (secondary.length > 0) {
    if (detail === "names-only" || secondary.length > 15) {
      secondarySection = `\nAlso available (use by name): ${secondary.map((t) => t.name).join(", ")}`;
    } else {
      secondarySection = `\nOther tools:\n${secondary.map(formatToolSchemaCompact).join("\n")}`;
    }
  }

  if (detail === "names-only") {
    const allNames =
      secondary.length > 0
        ? `${primaryLines}, ${secondary.map((t) => t.name).join(", ")}`
        : primaryLines;
    return `Tools: ${allNames}\nTo use: ACTION: tool_name({"param": "value"})`;
  }

  return `Available Tools:\n${primaryLines}${secondarySection}\n\nTo use a tool: ACTION: tool_name({"param": "value"}) — use EXACT parameter names shown above, valid JSON only.`;
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
 * Build a compact pinned tool reference that survives compaction.
 * Marks required tools with a star.
 */
function buildPinnedToolReference(
  availableToolSchemas?: readonly ToolSchema[],
  requiredTools?: readonly string[],
  toolSchemaDetail?: "names-only" | "names-and-types" | "full",
): string {
  if (!availableToolSchemas || availableToolSchemas.length === 0) return "";
  const detail = toolSchemaDetail ?? "full";
  const requiredSet = new Set(requiredTools ?? []);

  if (detail === "names-only") {
    if (requiredSet.size === 0) return "";
    const reqNames = availableToolSchemas
      .filter((t) => requiredSet.has(t.name))
      .map((t) => t.name);
    if (reqNames.length === 0) return "";
    return `\u2B50 REQUIRED tools: ${reqNames.join(", ")}`;
  }

  const lines = availableToolSchemas.map((t) => {
    const params = t.parameters
      .map((p) => `${p.name}: ${p.type}${p.required ? " \u2605" : "?"}`)
      .join(", ");
    const req = requiredSet.has(t.name) ? " \u2B50 REQUIRED" : "";
    return `  ${t.name}(${params})${req}`;
  });
  return `[Tool reference \u2014 EXACT parameter names]:\n${lines.join("\n")}`;
}

/**
 * Build iteration awareness string with progressive urgency.
 */
function buildIterationAwareness(iteration: number, maxIterations: number): string {
  const remaining = maxIterations - iteration;
  if (remaining <= Math.ceil(maxIterations * 0.2)) {
    return `[Iteration ${iteration + 1}/${maxIterations} \u2014 LAST CHANCE. Give FINAL ANSWER now or next turn.]`;
  }
  if (remaining <= Math.ceil(maxIterations * 0.4)) {
    return `[Iteration ${iteration + 1}/${maxIterations} \u2014 ${remaining} remaining. Be decisive.]`;
  }
  return `[Iteration ${iteration + 1}/${maxIterations}]`;
}

/**
 * Build the RULES block with dynamic entries for required tools and delegation.
 */
function buildRules(
  availableToolSchemas?: readonly ToolSchema[],
  requiredTools?: readonly string[],
): string {
  const rules: string[] = [
    "1. ONE action per turn. Wait for the real result before proceeding.",
    "2. Use EXACT parameter names from the tool reference above.",
    "3. When you have ALL required information: FINAL ANSWER: <your answer>",
    "4. Check 'ALREADY DONE' above. Skip completed steps.",
    "5. Do NOT fabricate or invent data. Only use information from tool results.",
    '6. When results show [STORED: _key], use ACTION: scratchpad-read({"key": "_key"}) to read full data BEFORE summarizing. Do NOT guess missing items from previews.',
    "7. Trust tool results. Once a tool succeeds, do NOT repeat it.",
  ];

  let ruleNum = 8;
  if (requiredTools && requiredTools.length > 0) {
    rules.push(
      `${ruleNum++}. \u2B50 REQUIRED tools (marked above) MUST be called before giving FINAL ANSWER. Plan your approach to include them.`,
    );
  }

  const hasSpawnAgent = availableToolSchemas?.some((t) => t.name === "spawn-agent");
  if (hasSpawnAgent) {
    rules.push(
      `${ruleNum}. DELEGATION: When using spawn-agent, the sub-agent has NO knowledge of your conversation. Include ALL specific values in the "task" field: phone numbers, emails, URLs, repo names, file paths, IDs. Never use pronouns like "the user" or "the repo" \u2014 write the actual values.`,
    );
  }

  return `RULES:\n${rules.join("\n")}`;
}
