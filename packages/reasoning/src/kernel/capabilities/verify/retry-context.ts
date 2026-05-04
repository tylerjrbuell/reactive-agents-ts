// File: src/kernel/capabilities/verify/retry-context.ts
//
// Improved retry context builders — handle FM-A1 and FM-C2 failures with
// explicit guidance designed for models with low tool-use compliance
// (e.g., cogito:8b, where direct feedback alone fails per p02 spike).
//
// Design: Per p02 findings, cogito interprets "call the tool" as literal
// file attachment, not function call emission. Improved context:
//   1. Simplifies system prompt (reduce cognitive load)
//   2. Provides explicit examples with concrete syntax
//   3. Addresses the specific misinterpretation (not "attach", but "emit")
//   4. Temperature guidance for reduced stochasticity
//
// Usage:
//   const signal = buildImprovedRetrySignal(verdict);
//   const decision = {
//     retry: true,
//     signalText: signal,
//     reason: "improved retry context for FM-A1"
//   };

import type { VerificationResult } from "./verifier.js";

/**
 * Build an improved retry signal for FM-A1 (agent-took-action) failures.
 *
 * FM-A1 pattern: Agent shipped final answer without calling any required tools.
 * p02 evidence: Direct feedback ("you MUST call tool") doesn't move cogito:8b.
 *
 * Improved approach:
 *   1. Explicit "MUST emit tool_call" not "MUST call function"
 *   2. Concrete examples with exact syntax
 *   3. Separate "describe vs do" distinction (addresses p02 misunderstanding)
 *   4. No attachment language (addresses p02 literal interpretation)
 *
 * @param verdict Verification result containing agent-took-action failure
 * @returns Improved retry signal optimized for low-compliance models
 */
export function buildFMA1RetrySignal(verdict: {
  readonly summary: string;
  readonly checks: readonly { readonly name: string; readonly reason?: string }[];
}): string {
  // Extract the specific tool names from the verdict if available
  const reason = verdict.checks.find((c) => c.name === "agent-took-action")?.reason ?? "";
  const toolMatch = reason.match(/required:\s*(.+?)(?:\)|$)/);
  const toolsStr = toolMatch ? toolMatch[1].trim() : "read_csv";
  const tools = toolsStr.split(",").map((t) => t.trim());

  const exampleTool = tools[0] || "read_csv";
  const exampleParam = exampleTool === "read_csv" ? "filename" : "query";
  const exampleValue =
    exampleTool === "read_csv" ? "'data.csv'" : "'sales data'";

  return (
    "⚠️ RETRY — CRITICAL: You did NOT call any tools in your previous response.\n\n" +
    "You MUST emit a tool_call in your next response. Here's what to do:\n\n" +
    "❌ WRONG: 'I would read the file by calling read_csv...'\n" +
    "✅ RIGHT: Emit a tool_call directly:\n" +
    `   tool_call[${exampleTool}]{ ${exampleParam}: ${exampleValue} }\n\n` +
    "Your response must ACTUALLY EMIT the tool_call, not describe it.\n" +
    `Required tools to call: ${tools.join(", ")}\n` +
    "Emit the tool call now, then process its output to answer the question."
  );
}

/**
 * Build an improved retry signal for FM-C2 (synthesis-grounded) failures.
 *
 * FM-C2 pattern: Agent called tools but final answer doesn't reference data.
 * Common cause: Agent fabricates additional reasoning without grounding.
 *
 * Improved approach:
 *   1. Require ≥3 specific references (number, SKU, name, date)
 *   2. Show concrete example with citations
 *   3. Explicitly reject generic/synthesized facts
 */
export function buildFMC2RetrySignal(verdict: {
  readonly summary: string;
}): string {
  return (
    "⚠️ RETRY — CRITICAL: Your answer doesn't cite specific data.\n\n" +
    "You MUST reference specific numbers, SKUs, dates, or names from the tool results.\n\n" +
    "❌ WRONG: 'The revenue dropped due to market conditions.'\n" +
    "✅ RIGHT: 'SKU ELEC-4K-TV-001 revenue dropped from $6,799.92 to $2,167.47 (15% discount applied).'\n\n" +
    "Include ≥3 specific references from the data:\n" +
    "  • Exact numbers (prices, sums, percentages)\n" +
    "  • SKU codes or product names\n" +
    "  • Dates or time periods\n" +
    "  • Names or identifiers from the data\n\n" +
    "Revise your answer to cite these specific facts."
  );
}

/**
 * Main entry point — examines verdict and returns optimal signal.
 * Falls back to generic feedback if no specific FM pattern matches.
 */
export function buildImprovedRetrySignal(verdict: VerificationResult): string {
  const summary = verdict.summary.toLowerCase();

  // FM-A1: agent-took-action
  if (summary.includes("agent-took-action")) {
    return buildFMA1RetrySignal(verdict);
  }

  // FM-C2: synthesis-grounded
  if (summary.includes("synthesis-grounded")) {
    return buildFMC2RetrySignal(verdict);
  }

  // Fallback for other failure modes
  const failedCheck = verdict.checks.find((c) => !c.passed);
  return (
    `⚠️ RETRY: Your response was rejected at "${failedCheck?.name ?? "verification"}".\n\n` +
    `Issue: ${failedCheck?.reason ?? verdict.summary}\n\n` +
    "Please address this specific gap and try again, being more careful and thorough."
  );
}
