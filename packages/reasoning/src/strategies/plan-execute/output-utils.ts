// File: src/strategies/plan-execute/output-utils.ts
/**
 * Output utilities for the plan-execute-reflect strategy.
 *
 * WS-6 Phase 3 bucket B extraction (from `strategies/plan-execute.ts`).
 * Self-contained pure helpers consumed by both the step executor and the
 * plan-mutation helpers — extracted as a peer module so step-executor and
 * plan-mutation can import without circular dependency.
 *
 * Public surface:
 * - `extractGoalText(taskDescription)`  → goal-string normalizer
 * - `stripFinalAnswerPrefix(text)`      → "FINAL ANSWER:" prefix stripper
 * - `sanitizeToolOutput(name, raw, args)` → action-tool echo sanitizer
 * - `ACTION_TOOL_PATTERNS`              → regex used by the sanitizer (also
 *    re-exported so call sites that need to test individual tool names can
 *    do so without re-defining the pattern).
 * - `stripDeadStorageHints(content, toolName)` → removes dead [STORED:]/recall()
 *    pointers from compressed tool results before they enter tool-less prompts.
 */

/**
 * Extract plain goal text from taskDescription which may be JSON-wrapped.
 * The execution engine passes `JSON.stringify(task.input)` which produces
 * `{"question":"actual goal text"}` — unwrap that to get the clean string.
 */
export function extractGoalText(taskDescription: string): string {
  try {
    const parsed = JSON.parse(taskDescription);
    if (typeof parsed === "object" && parsed !== null && typeof parsed.question === "string") {
      return parsed.question;
    }
  } catch {
    // Not JSON — use as-is
  }
  return taskDescription;
}

/**
 * Strip "FINAL ANSWER:" prefix from LLM output so it doesn't leak into
 * tool arguments or user-visible messages.
 */
export function stripFinalAnswerPrefix(text: string): string {
  return text.replace(/^FINAL ANSWER:\s*/i, "").trim();
}

/**
 * Action-oriented tool name patterns — tools that perform side effects
 * (send, write, post, create, delete, etc.) rather than fetching data.
 * Their raw output (JSON with args like recipient/message) should NOT
 * appear in downstream steps or the final synthesis.
 */
export const ACTION_TOOL_PATTERNS = /\b(send|write|post|create|delete|remove|update|set|put|push|publish|notify|deploy|upload)\b/i;

/**
 * Strip dead `[STORED:]` headers + `recall(…)` coverage hints from a compressed
 * tool result before it enters a plan-execute prompt.
 *
 * `compressToolResult` emits these hints assuming the kernel act path (which
 * stores the full data under the `_tool_result_*` key the resolver reads, then
 * re-appends ONE honest recall line — `tool-execution.ts:704-717`). plan-execute
 * takes a different path: it DISCARDS the full data and injects the result into
 * tool-less single-shot prompts (analysis/reflection/synthesis) where `recall` is
 * uncallable. So every hint is a DEAD pointer — the model is told to recall a key
 * that was never stored and cannot be called, which invites fabricated tails or
 * echoed framework scaffolding (the latter HARD-fails evidence-grounding).
 *
 * This mirrors the kernel's strip set MINUS the re-append: plan-execute stored
 * nothing, so it must promise nothing. (Persisting the data + a resolving ref is
 * roadmap #4, not this fix.) The real preview rows are preserved.
 */
export function stripDeadStorageHints(content: string, toolName: string): string {
  return content
    .replace(/^\[STORED:[^\]]+\]\n?/m, `[${toolName} result — compressed preview]\n`)
    .replace(/\s*— use recall\("[^"]+",? ?(?:full: ?true)?\)[^\n]*/g, "")
    .replace(/\s*— call recall[^\n]*/g, "")
    .replace(/\s*— full (?:text|data|object) is stored[^\n]*/g, "")
    .replace(/\s*Use recall\([^\n]*/g, "")
    .replace(/\s*✓ Preview (?:covers|includes)[^\n]*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Sanitize tool output to prevent internal metadata from leaking into
 * downstream steps or final user-facing synthesis.
 *
 * - Data-fetching tools (list, get, search, read) → keep full output
 * - Action tools (send, write, post, create) → clean confirmation only
 */
export function sanitizeToolOutput(
  toolName: string,
  rawOutput: string,
  args: Record<string, unknown>,
): string {
  // shell-execute wraps command output in metadata; prefer the full untruncated
  // command payload so downstream synthesis can parse complete results.
  if (toolName.includes("shell-execute")) {
    const extractText = (value: unknown): string | null => {
      if (typeof value === "string" && value.trim().length > 0) return value;
      return null;
    };

    const parseUnknown = (value: unknown): unknown => {
      if (typeof value !== "string") return value;
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    };

    // Some integrations return shell payloads as nested objects or as
    // stringified JSON at one or more levels. Normalize to inspect safely.
    const parsed = parseUnknown(rawOutput);
    const normalized =
      parsed && typeof parsed === "object" && "result" in parsed
        ? parseUnknown((parsed as { result?: unknown }).result)
        : parsed;

    if (normalized && typeof normalized === "object") {
      const payload = normalized as {
        fullOutput?: unknown;
        output?: unknown;
        fullStderr?: unknown;
        stderr?: unknown;
      };

      const output =
        extractText(payload.fullOutput) ??
        extractText(payload.output) ??
        "";
      const stderr =
        extractText(payload.fullStderr) ??
        extractText(payload.stderr) ??
        "";

      if (output.trim().length > 0) return output;
      if (stderr.trim().length > 0) return stderr;
    }
  }

  // If tool name indicates a data-fetching operation, keep full output
  if (!ACTION_TOOL_PATTERNS.test(toolName)) {
    return rawOutput;
  }

  // For action tools, check if the raw output is just echoing back the args
  // (common MCP pattern: return the request payload as confirmation)
  const isJsonEcho = (() => {
    try {
      const parsed = JSON.parse(rawOutput);
      if (typeof parsed !== "object" || parsed === null) return false;
      // If most keys in the output match the input args, it's an echo
      const outputKeys = Object.keys(parsed);
      const argKeys = Object.keys(args);
      const overlap = outputKeys.filter((k) => argKeys.includes(k));
      return overlap.length >= argKeys.length * 0.5;
    } catch {
      return false;
    }
  })();

  if (isJsonEcho) {
    // Replace with clean confirmation — just the tool name and success
    const friendlyName = toolName.split("/").pop() ?? toolName;
    return `✓ ${friendlyName} completed successfully`;
  }

  return rawOutput;
}
