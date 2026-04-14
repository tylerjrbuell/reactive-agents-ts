/**
 * shared/tool-execution.ts — Shared tool execution primitive.
 *
 * Extracted from reactive.ts (runToolObservation) and react-kernel.ts
 * (runKernelToolObservation). Both implementations were functionally identical
 * (~130 lines each). This module provides a single canonical implementation.
 *
 * Exports:
 *   - makeObservationResult(toolName, success, displayText) → ObservationResult
 *   - truncateForDisplay(result, maxChars) → string
 *   - executeToolCall(toolServiceOpt, toolRequest, config) → Effect<ToolExecutionResult>
 *
 * Internal helpers (not exported):
 *   - normalizeTripleQuotes(input) — Python-style """...""" → JSON string
 *   - normalizeObservation(toolName, result) — tool-specific output normalization
 *   - resolveToolArgs(toolService, toolRequest) — resolve raw ACTION args
 */
import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { ObservationResult } from "../../../types/observation.js";
import { categorizeToolName, deriveResultKind } from "../../../types/observation.js";
import type { ContextProfile } from "../../../context/context-profile.js";
import { ToolNotFoundError } from "@reactive-agents/tools";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import { evaluateTransform, compressToolResult, nextToolResultKey } from "./tool-utils.js";
import type { MaybeService, ToolServiceInstance } from "../kernel-state.js";
import type { ToolCallSpec } from "@reactive-agents/tools";

// ── Result type ──────────────────────────────────────────────────────────────

/** The result of executing a single tool call. */
export interface ToolExecutionResult {
  readonly content: string;
  readonly observationResult: ObservationResult;
  readonly delegatedToolsUsed?: readonly string[];
  /**
   * When the tool result was compressed and auto-stored in the scratchpad,
   * this is the key under which the full result was saved (e.g. "_tool_result_1").
   * The kernel uses this to auto-forward the full content to the next iteration
   * so the model doesn't need to call recall to access the data.
   */
  readonly storedKey?: string;
}

// ── Configuration for executeToolCall ────────────────────────────────────────

export interface ToolExecutionConfig {
  readonly profile?: ContextProfile;
  readonly compression?: ResultCompressionConfig;
  readonly scratchpad?: Map<string, string>;
  readonly agentId?: string;
  readonly sessionId?: string;
}

// ── Exported utilities ───────────────────────────────────────────────────────

/**
 * Build an ObservationResult from tool name + success flag + display text.
 */
export function makeObservationResult(
  toolName: string,
  success: boolean,
  displayText: string,
  options?: { readonly delegatedToolsUsed?: readonly string[] },
): ObservationResult {
  const category = categorizeToolName(toolName);
  const resultKind = deriveResultKind(category, success);
  const preserveOnCompaction = !success || category === "error";
  return {
    success,
    toolName,
    displayText,
    category,
    resultKind,
    preserveOnCompaction,
    ...(options?.delegatedToolsUsed && options.delegatedToolsUsed.length > 0
      ? { delegatedToolsUsed: [...new Set(options.delegatedToolsUsed)] }
      : {}),
  };
}

function extractDelegatedToolsUsed(result: unknown): readonly string[] | undefined {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return undefined;
  const delegated = (result as { delegatedToolsUsed?: unknown }).delegatedToolsUsed;
  if (!Array.isArray(delegated)) return undefined;
  const toolNames = delegated.filter((toolName): toolName is string =>
    typeof toolName === "string" && toolName.length > 0,
  );
  return toolNames.length > 0 ? [...new Set(toolNames)] : undefined;
}

/**
 * Simple head+tail truncation for when structured compression is not available.
 */
export function truncateForDisplay(result: string, maxChars: number): string {
  if (result.length <= maxChars) return result;
  const half = Math.floor(maxChars / 2);
  const omitted = result.length - maxChars;
  return `${result.slice(0, half)}\n[...${omitted} chars omitted...]\n${result.slice(-half)}`;
}

// ── Private helpers ──────────────────────────────────────────────────────────

/**
 * Map common tool error patterns to actionable recovery hints.
 * Helps the LLM understand what went wrong and how to fix it.
 */
function getRecoveryHint(toolName: string, errorMsg: string): string {
  const msg = errorMsg.toLowerCase();

  // File not found
  if (msg.includes("enoent") || msg.includes("not found") || msg.includes("no such file")) {
    if (toolName === "file-read" || toolName === "file-write") {
      return " → Try a different path or verify the file exists.";
    }
    return " → The requested resource was not found.";
  }

  // Permission errors
  if (msg.includes("eacces") || msg.includes("permission denied") || msg.includes("forbidden") || msg.includes("403")) {
    return " → Permission denied. You may not have access to this resource.";
  }

  // Timeout errors
  if (msg.includes("timeout") || msg.includes("etimedout") || msg.includes("timed out") || msg.includes("econnaborted")) {
    if (toolName === "web-search" || toolName === "http-get") {
      return " → Request timed out. Try a more specific query or a different URL.";
    }
    return " → Operation timed out. Try again or simplify the request.";
  }

  // Network errors
  if (msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("network") || msg.includes("dns")) {
    return " → Network error. The service may be unreachable.";
  }

  // Rate limits
  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("too many requests")) {
    return " → Rate limited. Wait before retrying or try a different approach.";
  }

  // Invalid arguments / validation
  if (msg.includes("invalid") || msg.includes("validation") || msg.includes("schema") || msg.includes("required")) {
    return " → Check argument format. Review the expected parameters above.";
  }

  // JSON parse errors
  if (msg.includes("json") && (msg.includes("parse") || msg.includes("syntax") || msg.includes("unexpected"))) {
    return " → Malformed JSON in arguments. Ensure valid JSON syntax.";
  }

  // Code execution errors
  if (toolName === "code-execute") {
    if (msg.includes("syntax")) return " → Fix the syntax error in your code.";
    if (msg.includes("reference") || msg.includes("undefined")) return " → Check variable names and imports.";
    return " → Code execution failed. Review the error and fix the code.";
  }

  return "";
}


/**
 * Normalize Python-style triple-quoted strings ("""...""") to valid JSON strings.
 * Some models (e.g., cogito, smaller Ollama models) produce these in ACTION outputs.
 */
function normalizeTripleQuotes(input: string): string {
  return input.replace(/"""([\s\S]*?)"""/g, (_, content: string) => {
    const escaped = content
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
    return `"${escaped}"`;
  });
}

/**
 * Escape literal control characters (newlines, tabs, CRs) that appear inside
 * JSON string values. LLMs frequently produce JSON with unescaped newlines in
 * multi-line message content, which causes JSON.parse() to fail.
 *
 * Walks the string character-by-character, tracking whether we're inside a
 * JSON string (between unescaped double-quotes). Inside strings, replaces
 * literal \n → \\n, \r → \\r, \t → \\t.
 */
function repairJsonControlChars(json: string): string {
  let inString = false;
  let escaped = false;
  let result = "";
  for (let i = 0; i < json.length; i++) {
    const ch = json[i]!;
    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      result += ch;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }
    if (inString) {
      if (ch === "\n") { result += "\\n"; continue; }
      if (ch === "\r") { result += "\\r"; continue; }
      if (ch === "\t") { result += "\\t"; continue; }
    }
    result += ch;
  }
  return result;
}

/**
 * Strip markdown/HTML noise from web page content so the model's snippet
 * budget is spent on actual data (prices, names, dates) instead of image
 * tags and navigation chrome.  Zero LLM calls — pure regex.
 */
function cleanWebSnippet(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/!\[[^\]]*\]/g, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Normalize tool-specific raw output to compact semantic representations.
 */
function normalizeObservation(toolName: string, result: string): string {
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>;

    if (toolName === "file-write" && parsed.written === true) {
      const rawPath = String(parsed.path ?? "file");
      const path = rawPath.includes("/") ? `./${rawPath.split("/").pop()}` : rawPath;
      return `✓ Written to ${path}`;
    }

    if (toolName === "code-execute" && parsed.executed === false) {
      return "[Code execution unavailable — compute from first principles]";
    }

    if (toolName === "web-search" && Array.isArray(parsed.results)) {
      const lines = (parsed.results as Array<{ title?: string; url?: string; content?: string }>)
        .slice(0, 5)
        .map((r, i) => {
          const header = `${i + 1}. ${r.title ?? "result"}: ${r.url ?? ""}`;
          const snippet = cleanWebSnippet(r.content?.trim() ?? "");
          return snippet ? `${header}\n   ${snippet.slice(0, 300)}` : header;
        })
        .join("\n");
      return lines || result;
    }

    if (toolName === "http-get" && typeof parsed.content === "string") {
      return cleanWebSnippet(parsed.content);
    }

    if (toolName === "shell-execute" && typeof parsed === "object" && parsed !== null) {
      const shell = parsed as {
        output?: unknown;
        fullOutput?: unknown;
        stderr?: unknown;
        fullStderr?: unknown;
        exitCode?: unknown;
      };

      const mainOutput =
        typeof shell.fullOutput === "string"
          ? shell.fullOutput
          : typeof shell.output === "string"
            ? shell.output
            : "";
      const errOutput =
        typeof shell.fullStderr === "string"
          ? shell.fullStderr
          : typeof shell.stderr === "string"
            ? shell.stderr
            : "";
      const exitCode =
        typeof shell.exitCode === "number" ? shell.exitCode : undefined;

      if (mainOutput.trim().length > 0) {
        if (exitCode !== undefined && exitCode !== 0 && errOutput.trim().length > 0) {
          return `${mainOutput}\n\n[stderr]\n${errOutput}`;
        }
        return mainOutput;
      }

      if (errOutput.trim().length > 0) return errOutput;
    }

    if (typeof parsed.subAgentName === "string" && typeof parsed.summary === "string") {
      const icon = parsed.success ? "✓" : "✗";
      const name = parsed.subAgentName;
      const steps = typeof parsed.stepsCompleted === "number" ? `${parsed.stepsCompleted} steps` : "";
      const toks = typeof parsed.tokensUsed === "number" && parsed.tokensUsed > 0 ? `${parsed.tokensUsed} tok` : "";
      const meta = [steps, toks].filter(Boolean).join(", ");
      const metaStr = meta ? ` (${meta})` : "";
      // Generous limit — this is the primary handoff the parent reasons over
      const content = String(parsed.summary).slice(0, 800);
      return `${icon} Sub-agent "${name}"${metaStr}:\n${content}`;
    }
  } catch {
    // Not JSON — return as-is
  }
  return result;
}

/**
 * Resolve tool arguments from the raw ACTION string.
 * Handles JSON objects, malformed JSON, and plain string → first-param mapping.
 */
function resolveToolArgs(
  toolService: ToolServiceInstance,
  toolRequest: { tool: string; input: string },
): Effect.Effect<Record<string, unknown>, never> {
  const trimmed = normalizeTripleQuotes(toolRequest.input.trim());

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    // Escape literal newlines/tabs/CRs inside JSON string values —
    // LLMs often produce unescaped control characters that break JSON.parse.
    const repaired = repairJsonControlChars(trimmed);
    try {
      const parsed = JSON.parse(repaired);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return Effect.succeed(parsed as Record<string, unknown>);
      }
    } catch {
      return toolService
        .getTool(toolRequest.tool)
        .pipe(
          Effect.flatMap((toolDef) => {
            const requiredParams = toolDef.parameters.filter(
              (p: { required?: boolean }) => p.required,
            );
            if (requiredParams.length > 1) {
              const paramNames = requiredParams.map((p: { name: string }) => p.name).join(", ");
              return Effect.succeed({
                _parseError: true,
                error: `Malformed JSON for tool "${toolRequest.tool}". Expected JSON with keys: ${paramNames}. Got: ${trimmed.slice(0, 100)}...`,
              } as Record<string, unknown>);
            }
            const firstParam = requiredParams[0] ?? toolDef.parameters[0];
            return Effect.succeed(
              firstParam
                ? ({ [firstParam.name]: trimmed } as Record<string, unknown>)
                : ({ input: trimmed } as Record<string, unknown>),
            );
          }),
          Effect.catchAll(() =>
            Effect.succeed({ input: trimmed } as Record<string, unknown>),
          ),
        );
    }
  }

  return toolService
    .getTool(toolRequest.tool)
    .pipe(
      Effect.map((toolDef) => {
        const firstParam =
          toolDef.parameters.find((p: { required?: boolean }) => p.required) ??
          toolDef.parameters[0];
        if (firstParam) {
          return { [firstParam.name]: trimmed } as Record<string, unknown>;
        }
        return { input: trimmed } as Record<string, unknown>;
      }),
      Effect.catchAll(() =>
        Effect.succeed({ input: trimmed } as Record<string, unknown>),
      ),
    );
}

// ── Main exported function ───────────────────────────────────────────────────

/**
 * Execute a single tool call and produce a structured observation.
 *
 * Replaces both `runToolObservation` (reactive.ts) and
 * `runKernelToolObservation` (react-kernel.ts) with a single implementation.
 *
 * Handles:
 * - Scratchpad-read short-circuit for auto-stored tool results
 * - ToolService unavailable graceful fallback
 * - Argument resolution (JSON, malformed JSON, plain string)
 * - Tool-specific output normalization
 * - Pipe transforms (| transform: <expr>)
 * - Structured compression / auto-preview
 * - Error enrichment with expected parameter schema
 */
export function executeToolCall(
  toolServiceOpt: MaybeService<ToolServiceInstance>,
  toolRequest: { tool: string; input: string; transform?: string },
  config: ToolExecutionConfig,
): Effect.Effect<ToolExecutionResult, never> {
  const { profile, compression: compressionConfig, scratchpad: scratchpadStore, agentId, sessionId } = config;

  if (toolServiceOpt._tag === "None") {
    const content = `[Tool "${toolRequest.tool}" requested but ToolService is not available — add .withTools() to agent builder]`;
    return Effect.succeed({
      content,
      observationResult: makeObservationResult(toolRequest.tool, false, content),
    });
  }

  const toolService = toolServiceOpt.value;

  return Effect.gen(function* () {
    const args = yield* resolveToolArgs(toolService, toolRequest);

    const result = yield* toolService
      .execute({
        toolName: toolRequest.tool,
        arguments: args,
        agentId: agentId ?? "reasoning-agent",
        sessionId: sessionId ?? "reasoning-session",
      })
      .pipe(
        Effect.map((r) => {
          const delegatedToolsUsed = extractDelegatedToolsUsed(r.result);
          const raw = typeof r.result === "string" ? r.result : JSON.stringify(r.result);
          const normalized = normalizeObservation(toolRequest.tool, raw);

          // Pipe transform — evaluate in-process, inject only transformed result
          if (toolRequest.transform && (compressionConfig?.codeTransform ?? true)) {
            let parsed: unknown = normalized;
            try {
              parsed = JSON.parse(normalized);
            } catch {
              /* use string */
            }
            const transformed = evaluateTransform(toolRequest.transform, parsed);
            if ((compressionConfig?.autoStore ?? true) && scratchpadStore) {
              const key = nextToolResultKey();
              scratchpadStore.set(key, normalized);
            }
            const isSuccess = !transformed.startsWith("[Transform error:");
            return {
              content: transformed,
              observationResult: makeObservationResult(toolRequest.tool, isSuccess, transformed, {
                delegatedToolsUsed,
              }),
              delegatedToolsUsed,
            } satisfies ToolExecutionResult;
          }

          // Structured compression / auto-preview (tier-adaptive)
          const budget = compressionConfig?.budget ?? profile?.toolResultMaxChars ?? 800;
          const previewItems = compressionConfig?.previewItems ?? profile?.toolResultPreviewItems ?? 3;
          const autoStore = compressionConfig?.autoStore ?? true;
          const compressed = compressToolResult(normalized, toolRequest.tool, budget, previewItems);
          if (autoStore && compressed.stored && scratchpadStore) {
            scratchpadStore.set(compressed.stored.key, compressed.stored.value);
          }
          const content = compressed.content;
          return {
            content,
            observationResult: makeObservationResult(toolRequest.tool, r.success !== false, content, {
              delegatedToolsUsed,
            }),
            delegatedToolsUsed,
            storedKey: compressed.stored?.key,
          } satisfies ToolExecutionResult;
        }),
        Effect.catchAll((e) => {
          const msg =
            e instanceof Error
              ? e.message
              : typeof e === "object" && e !== null && "message" in e
                ? String((e as { message: unknown }).message)
                : String(e);
          const hint = getRecoveryHint(toolRequest.tool, msg);
          return toolService.getTool(toolRequest.tool).pipe(
            Effect.map((toolDef) => {
              const paramHints = toolDef.parameters
                .map((p) => `"${p.name}": "${p.type}${p.required ? ", required" : ", optional"}"`)
                .join(", ");
              const content = `[Tool error: ${msg}${hint}] Expected: ${toolRequest.tool}({${paramHints}})`;
              return {
                content,
                observationResult: makeObservationResult(toolRequest.tool, false, content),
              } satisfies ToolExecutionResult;
            }),
            Effect.catchAll(() => {
              const content = `[Tool error: ${msg}${hint}]`;
              return Effect.succeed({
                content,
                observationResult: makeObservationResult(toolRequest.tool, false, content),
              } satisfies ToolExecutionResult);
            }),
          );
        }),
      );

    return result;
  }).pipe(
    Effect.catchAll((e) => {
      const content = `[Unexpected error executing tool: ${String(e)}]`;
      return Effect.succeed({
        content,
        observationResult: makeObservationResult(toolRequest.tool, false, content),
      } satisfies ToolExecutionResult);
    }),
  );
}

// ── Native function calling execution ─────────────────────────────────────────

/**
 * Execute a single native function call (structured tool_use from the LLM).
 *
 * Unlike `executeToolCall` which handles text-based ACTION parsing, argument
 * repair, and malformed JSON recovery, this function receives pre-parsed
 * arguments directly from the provider's tool_use response. It runs the tool
 * through ToolService and normalizes the result.
 *
 * Returns `{ content, success }` — never fails (errors are caught and surfaced
 * as content strings so the LLM can reason about them).
 */
export function executeNativeToolCall(
  toolService: ToolServiceInstance,
  toolCall: ToolCallSpec,
  agentId: string,
  sessionId: string,
  config?: { compression?: ResultCompressionConfig; scratchpad?: Map<string, string> },
): Effect.Effect<{ content: string; success: boolean; storedKey?: string; delegatedToolsUsed?: readonly string[] }, never> {
  return toolService
    .execute({
      toolName: toolCall.name,
      arguments: toolCall.arguments,
      agentId,
      sessionId,
    })
    .pipe(
      Effect.map((r) => {
        const delegatedToolsUsed = extractDelegatedToolsUsed(r.result);
        let content = typeof r.result === "string" ? r.result : JSON.stringify(r.result);
        const success = r.success !== false;

        // Apply tool-specific normalization (HTML stripping for http-get, etc.)
        content = normalizeObservation(toolCall.name, content);

        // Apply result compression for large outputs
        let storedKey: string | undefined;
        if (config?.compression) {
          const budget = config.compression.budget ?? 800;
          const previewItems = config.compression.previewItems ?? 5;
          const compressed = compressToolResult(content, toolCall.name, budget, previewItems);
          content = compressed.content;
          if (compressed.stored) {
            storedKey = compressed.stored.key;
            config.scratchpad?.set(compressed.stored.key, compressed.stored.value);
          }

          // In FC mode, clean up the compressed content for native message format:
          // - Replace verbose [STORED: ...] header with a clean preview header
          // - Strip ALL recall/storage hints (covers every compressToolResult variant)
          // - Append one concise retrieval line if stored
          content = content
            .replace(/^\[STORED: [^\]]+\]\n?/m, `[${toolCall.name} result — compressed preview]\n`)
            .replace(/— use recall\("[^"]+",? ?(?:full: ?true)?\)[^\n]*/g, "")
            .replace(/— call recall[^\n]*/g, "")
            .replace(/— full text is stored[^\n]*/g, "")
            .replace(/— full data is stored[^\n]*/g, "")
            .replace(/— full object is stored[^\n]*/g, "")
            .replace(/✓ Preview (?:covers|includes)[^\n]*/g, "")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

          if (storedKey) {
            content += `\n  — full text is stored. Use recall("${storedKey}") to retrieve.`;
          }
        }

        return { content, success, storedKey, delegatedToolsUsed };
      }),
      Effect.catchAll((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        // ToolNotFoundError carries availableTools — surface them so the model can self-correct.
        const available = e instanceof ToolNotFoundError ? e.availableTools : undefined;
        if (available && available.length > 0 && msg.includes("not found")) {
          const searchLike = available.filter((n) =>
            n.includes("search") || n.includes("fetch") || n.includes("get") || n.includes("browse"),
          );
          const suggestion = searchLike.length > 0
            ? `For search/fetch tasks use: ${searchLike.slice(0, 4).join(", ")}.`
            : `Available tools include: ${available.slice(0, 5).join(", ")}.`;
          return Effect.succeed({
            content: `[Tool error: ${msg}. ${suggestion} Use EXACT tool names from the system prompt.]`,
            success: false,
          });
        }
        return Effect.succeed({
          content: `[Tool error: ${msg}]`,
          success: false,
        });
      }),
    );
}

// ── LLM-based observation fact extraction ─────────────────────────────────────

const META_TOOL_NAMES = new Set([
  "brief", "pulse", "recall", "find", "final-answer",
]);

const EXTRACTION_INPUT_LIMIT = 2000;

/**
 * Run a lightweight LLM pass to extract key facts from a raw tool result.
 * Returns the extracted bullet-list string, or undefined if extraction fails
 * or is skipped. Skips meta-tools whose output is already compact.
 */
export function extractObservationFacts(
  toolName: string,
  rawResult: string,
  args: Record<string, unknown>,
  compressionBudget: number,
): Effect.Effect<string | undefined, never, LLMService> {
  if (META_TOOL_NAMES.has(toolName)) return Effect.succeed(undefined);
  if (rawResult.length <= compressionBudget) return Effect.succeed(undefined);

  const truncatedInput = rawResult.length > EXTRACTION_INPUT_LIMIT
    ? rawResult.slice(0, EXTRACTION_INPUT_LIMIT) + `\n[...${rawResult.length - EXTRACTION_INPUT_LIMIT} chars truncated]`
    : rawResult;

  const argsStr = Object.entries(args)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ");

  return Effect.gen(function* () {
    const llm = yield* LLMService;
    const response = yield* llm.complete({
      messages: [{
        role: "user",
        content: [
          `Extract the key data points from this tool result. Return ONLY a concise bullet list of facts (numbers, names, prices, dates, URLs). No commentary or explanation.`,
          ``,
          `Tool: ${toolName}(${argsStr})`,
          `Result:`,
          truncatedInput,
        ].join("\n"),
      }],
      temperature: 0,
      maxTokens: 200,
    });

    const extracted = typeof response.content === "string"
      ? response.content.trim()
      : "";

    return extracted.length > 0 ? extracted : undefined;
  }).pipe(
    Effect.catchAll(() => Effect.succeed(undefined)),
  );
}
