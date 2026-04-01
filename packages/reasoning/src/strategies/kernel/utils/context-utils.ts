// File: src/strategies/kernel/context-utils.ts
import type { ReasoningStep } from "../../../types/index.js";
import type { ContextProfile } from "../../../context/context-profile.js";
import { stripThinking } from "./stream-parser.js";

/**
 * Format a single reasoning step in ReAct style for inclusion in context.
 * Observations get "Observation:" prefix; actions get "Action:" prefix (with
 * JSON tool-name extraction); thoughts are returned as-is.
 */
export function formatStepForContext(step: ReasoningStep): string {
  if (step.type === "observation") return `Observation: ${step.content}`;
  if (step.type === "action") {
    const parsed = (() => {
      try {
        return JSON.parse(step.content);
      } catch {
        return null;
      }
    })();
    return `Action: ${parsed?.tool ?? step.content}`;
  }
  // thought — strip any residual <think> blocks as defense-in-depth
  return stripThinking(step.content);
}

// ── Helpers for decision-preserving summarization ──────────────────────────

/** Extract the tool name from a JSON action step content. */
function parseToolName(actionContent: string): string {
  try { return (JSON.parse(actionContent) as { tool: string }).tool; } catch { return actionContent; }
}

/**
 * Extract the key finding from an observation — the actual value or result,
 * not just the data shape. Falls back to structured shape summary.
 */
export function extractObservationFinding(content: string, toolName?: string): string {
  const label = toolName ?? "tool";
  const trimmed = content.trim();

  // Error/failure markers — preserve them in full (check first, before length check)
  if (trimmed.startsWith("⚠️") || trimmed.startsWith("Error") || trimmed.startsWith("BLOCKED")) {
    const firstLine = trimmed.split("\n")[0] ?? trimmed;
    return firstLine.length <= 120 ? firstLine : firstLine.slice(0, 117) + "...";
  }

  // [STORED: key] markers — preserve scratchpad reference
  const storedMatch = trimmed.match(/\[STORED:\s*(\S+)\]/);
  if (storedMatch) return `${label}: data stored → ${storedMatch[1]}`;

  // JSON object — extract key scalar values (the "findings")
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed);
      const findings = extractScalarFindings(obj, 3);
      if (findings.length > 0) return `${label}: ${findings.join(", ")}`;
      const keys = Object.keys(obj);
      return `${label}: {${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", ..." : ""}}`;
    } catch { /* fall through */ }
  }

  // JSON array — show count + first item preview
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        const preview = typeof arr[0] === "string" ? `"${arr[0].slice(0, 40)}"` :
          typeof arr[0] === "object" && arr[0] !== null ? extractScalarFindings(arr[0], 2).join(", ") || "..." :
          String(arr[0]);
        return `${label}: [${arr.length} items, first: ${preview}]`;
      }
    } catch { /* fall through */ }
    const count = (trimmed.match(/,/g)?.length ?? 0) + 1;
    return `${label}: array(${count} items)`;
  }

  // Short non-structured content — use as-is
  if (trimmed.length <= 100) return `${label}: ${trimmed}`;

  // Plain text — extract first meaningful line (skip boilerplate)
  const lines = trimmed.split("\n").filter((l) => l.trim().length > 10);
  const firstLine = lines[0] ?? trimmed.split("\n")[0] ?? trimmed;
  return firstLine.length > 120
    ? `${label}: ${firstLine.slice(0, 100)}...`
    : `${label}: ${firstLine}`;
}

/** Extract up to `max` key-value pairs from a flat object for summary. */
function extractScalarFindings(obj: Record<string, unknown>, max: number): string[] {
  const findings: string[] = [];
  for (const [key, val] of Object.entries(obj)) {
    if (findings.length >= max) break;
    if (val === null || val === undefined) continue;
    if (typeof val === "string" && val.length <= 80) {
      findings.push(`${key}=${val.length > 50 ? val.slice(0, 47) + "..." : val}`);
    } else if (typeof val === "number" || typeof val === "boolean") {
      findings.push(`${key}=${String(val)}`);
    }
  }
  return findings;
}

/**
 * Extract the decision/conclusion from a thought — what was decided,
 * not the full reasoning chain.
 */
export function extractThoughtDecision(content: string): string {
  const stripped = stripThinking(content);
  if (stripped.length <= 100) return stripped;

  // Look for explicit decision markers
  const decisionPatterns = [
    /I (?:should|will|need to|'ll) (.+?)(?:\.|$)/i,
    /(?:Next|Now),? I (?:should|will|need to|'ll) (.+?)(?:\.|$)/i,
    /(?:Let me|Let's) (.+?)(?:\.|$)/i,
    /(?:The answer|The result|The solution) (?:is|seems to be) (.+?)(?:\.|$)/i,
    /(?:Based on|Given|From) .{5,60}, (.+?)(?:\.|$)/i,
  ];

  for (const pattern of decisionPatterns) {
    const match = stripped.match(pattern);
    if (match?.[1] && match[1].length >= 10 && match[1].length <= 120) {
      return match[1].trim();
    }
  }

  // Fall back to last sentence (conclusion tends to be at the end)
  const sentences = stripped.match(/[^.!?]+[.!?]+/g);
  if (sentences && sentences.length >= 2) {
    const last = sentences[sentences.length - 1]!.trim();
    if (last.length >= 15 && last.length <= 150) return last;
  }

  return stripped.slice(0, 100) + "...";
}

/**
 * Format a single reasoning step as a compact summary for old-step context.
 * Uses decision-preserving summarization — extracts key findings from
 * observations and conclusions from thoughts.
 */
export function summarizeStepForContext(step: ReasoningStep): string {
  if (step.type === "action") {
    const tool = parseToolName(step.content);
    return `Action: ${tool}`;
  }

  if (step.type === "observation") {
    const toolName = step.metadata?.toolUsed ?? "tool";
    return extractObservationFinding(step.content, toolName);
  }

  // Thought: extract decision/conclusion
  return extractThoughtDecision(step.content);
}

/**
 * Collapse a thought→action→observation triplet into a single decision line.
 * E.g.: "web-search('AI news') → found 5 results about latest developments"
 *
 * Returns null if the steps don't form a valid triplet.
 */
export function summarizeTriplet(
  thought: ReasoningStep,
  action: ReasoningStep,
  observation: ReasoningStep,
): string | null {
  if (thought.type !== "thought" || action.type !== "action" || observation.type !== "observation") {
    return null;
  }

  const toolName = parseToolName(action.content);
  const toolInput = (() => {
    try {
      const parsed = JSON.parse(action.content);
      // Show a concise version of the most important input arg
      const input = parsed.input;
      if (!input || input === "{}") return "";
      if (typeof input === "string") {
        try {
          const obj = JSON.parse(input);
          const firstVal = Object.values(obj)[0];
          if (typeof firstVal === "string" && firstVal.length <= 50) return `('${firstVal}')`;
          return "";
        } catch { return input.length <= 50 ? `('${input}')` : ""; }
      }
      return "";
    } catch { return ""; }
  })();

  const success = observation.metadata?.observationResult?.success !== false;
  const obsToolName = observation.metadata?.toolUsed ?? toolName;
  const finding = extractObservationFinding(observation.content, obsToolName);
  // Strip the tool label prefix from finding since we already show it
  const findingBody = finding.startsWith(`${obsToolName}: `)
    ? finding.slice(obsToolName.length + 2)
    : finding;

  const icon = success ? "→" : "✗";
  const line = `${toolName}${toolInput} ${icon} ${findingBody}`;
  return line.length > 150 ? line.slice(0, 147) + "..." : line;
}

/**
 * Group steps into triplets (thought→action→observation) and summarize
 * each triplet into a single decision line. Orphaned steps are summarized
 * individually.
 */
export function summarizeStepsTriplets(steps: readonly ReasoningStep[]): string[] {
  const lines: string[] = [];
  let i = 0;

  while (i < steps.length) {
    // Try to form a triplet
    if (
      i + 2 < steps.length &&
      steps[i]!.type === "thought" &&
      steps[i + 1]!.type === "action" &&
      steps[i + 2]!.type === "observation"
    ) {
      const tripletLine = summarizeTriplet(steps[i]!, steps[i + 1]!, steps[i + 2]!);
      if (tripletLine) {
        lines.push(tripletLine);
        i += 3;
        continue;
      }
    }

    // Try action→observation pair (thought may have been before the window)
    if (
      i + 1 < steps.length &&
      steps[i]!.type === "action" &&
      steps[i + 1]!.type === "observation"
    ) {
      const toolName = parseToolName(steps[i]!.content);
      const finding = extractObservationFinding(steps[i + 1]!.content, steps[i + 1]!.metadata?.toolUsed ?? toolName);
      const findingBody = finding.startsWith(`${toolName}: `)
        ? finding.slice(toolName.length + 2)
        : finding;
      const success = steps[i + 1]!.metadata?.observationResult?.success !== false;
      lines.push(`${toolName} ${success ? "→" : "✗"} ${findingBody}`);
      i += 2;
      continue;
    }

    // Orphan step — summarize individually
    lines.push(summarizeStepForContext(steps[i]!));
    i++;
  }

  return lines;
}

/**
 * Build a compacted context string from initial context + step history.
 * Keeps the most recent `fullDetailSteps` steps in full detail (ReAct format).
 * Older steps are summarized using decision-preserving triplet grouping
 * to prevent O(n²) token growth while retaining key findings.
 *
 * Thresholds come from the context profile (defaults: compactAfterSteps=6, fullDetailSteps=4).
 */
export function buildCompactedContext(
  initialContext: string,
  steps: readonly ReasoningStep[],
  profile: Pick<ContextProfile, "compactAfterSteps" | "fullDetailSteps"> | undefined,
): string {
  const compactAfterSteps = profile?.compactAfterSteps ?? 6;
  const fullDetailSteps = profile?.fullDetailSteps ?? 4;

  if (steps.length === 0) return initialContext;

  if (steps.length <= compactAfterSteps) {
    // Not enough steps to compact — rebuild context from all steps in ReAct format
    const stepLines = steps.map(formatStepForContext).join("\n");
    return `${initialContext}\n\n${stepLines}`;
  }

  // Split into old steps (summarized) and recent steps (full detail)
  const cutoff = steps.length - fullDetailSteps;
  const oldSteps = steps.slice(0, cutoff);
  const recentSteps = steps.slice(cutoff);

  // Summarize old steps using decision-preserving triplet grouping
  const summaryLines = summarizeStepsTriplets(oldSteps);
  const summary = `[Earlier steps — ${oldSteps.length} steps]:\n${summaryLines.join("\n")}`;

  // Keep recent steps in full detail in ReAct format
  const recentLines = recentSteps.map(formatStepForContext).join("\n");

  return `${initialContext}\n\n${summary}\n\n[Recent steps]:\n${recentLines}`;
}
