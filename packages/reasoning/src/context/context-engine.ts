// File: src/context/context-engine.ts
//
// ContextEngine — static system prompt builders used by the kernel's think phase.
// Renders environment context, tool schemas, task description, and rules into
// the system prompt each iteration via buildStaticContext().

import type { ContextProfile } from "./context-profile.js";
import type { ToolSchema } from "../strategies/kernel/utils/tool-utils.js";
import {
  formatToolSchemas,
  formatToolSchemaCompact,
  formatToolSchemaMicro,
} from "../strategies/kernel/utils/tool-utils.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** Input for the static system prompt builder. */
export interface StaticContextInput {
  task: string;
  profile: ContextProfile;
  availableToolSchemas?: readonly ToolSchema[];
  requiredTools?: readonly string[];
  /** Custom environment context key-value pairs (merged with auto-detected defaults) */
  environmentContext?: Readonly<Record<string, string>>;
}

// ── Static Context Builders ─────────────────────────────────────────────────

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
  const hasNamespacedTools = availableToolSchemas?.some((s) => s.name.includes("/"));

  // Core rules — always included, small-model-safe count
  const rules: string[] = [
    "1. When actions are independent, issue multiple tool calls in the same response — they run in parallel. For N separate items (currencies, files, URLs, users), make ONE call per item all in the same response rather than one combined query.",
    hasNamespacedTools
      ? "2. Use EXACT tool names and parameter names from the tool reference. MCP tools require the full listed prefix, and you must never invent prefixes or namespaces (for example, do not create `google:search` unless it appears in Available Tools)."
      : "2. Use EXACT tool names and parameter names from the tool reference. Do not invent prefixes or namespaces (for example, do not create `google:search` unless it appears in Available Tools).",
    "3. Do NOT fabricate data. Only use information from tool results.",
    "4. Do NOT repeat identical calls (same tool + same arguments). New calls with different arguments are fine.",
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
