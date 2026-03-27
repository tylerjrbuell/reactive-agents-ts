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
import type { ObservationResult } from "../../types/observation.js";
import { categorizeToolName, deriveResultKind } from "../../types/observation.js";
import type { ContextProfile } from "../../context/context-profile.js";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import { evaluateTransform, compressToolResult, nextToolResultKey } from "./tool-utils.js";
import type { ToolRequestGroup } from "./tool-utils.js";
import type { MaybeService, ToolServiceInstance } from "./kernel-state.js";
import type { ToolCallSpec } from "@reactive-agents/tools";

// ── Result type ──────────────────────────────────────────────────────────────

/** The result of executing a single tool call. */
export interface ToolExecutionResult {
  readonly content: string;
  readonly observationResult: ObservationResult;
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
): ObservationResult {
  const category = categorizeToolName(toolName);
  const resultKind = deriveResultKind(category, success);
  const preserveOnCompaction = !success || category === "error";
  return { success, toolName, displayText, category, resultKind, preserveOnCompaction };
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
          const snippet = r.content?.trim();
          return snippet ? `${header}\n   ${snippet.slice(0, 300)}` : header;
        })
        .join("\n");
      return lines || result;
    }

    if (toolName === "http-get" && typeof parsed.content === "string") {
      return parsed.content;
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
              observationResult: makeObservationResult(toolRequest.tool, isSuccess, transformed),
            } satisfies ToolExecutionResult;
          }

          // Structured compression / auto-preview
          const budget = compressionConfig?.budget ?? profile?.toolResultMaxChars ?? 800;
          const previewItems = compressionConfig?.previewItems ?? 3;
          const autoStore = compressionConfig?.autoStore ?? true;
          const compressed = compressToolResult(normalized, toolRequest.tool, budget, previewItems);
          if (autoStore && compressed.stored && scratchpadStore) {
            scratchpadStore.set(compressed.stored.key, compressed.stored.value);
          }
          const content = compressed.content;
          return {
            content,
            observationResult: makeObservationResult(toolRequest.tool, r.success !== false, content),
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
): Effect.Effect<{ content: string; success: boolean; storedKey?: string }, never> {
  return toolService
    .execute({
      toolName: toolCall.name,
      arguments: toolCall.arguments,
      agentId,
      sessionId,
    })
    .pipe(
      Effect.map((r) => {
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
        }

        return { content, success, storedKey };
      }),
      Effect.catchAll((e) =>
        Effect.succeed({
          content: `[Tool error: ${e instanceof Error ? e.message : String(e)}]`,
          success: false,
        }),
      ),
    );
}

// ── Group execution ───────────────────────────────────────────────────────────

/**
 * Execute a ToolRequestGroup — dispatches to single, parallel, or chain mode.
 *
 * - single: identical to executeToolCall (backwards compatible)
 * - parallel: Effect.all with concurrency: "unbounded" — all tools run concurrently
 * - chain: sequential with $RESULT substitution; fails fast on first error
 */
export function executeToolGroup(
  toolService: MaybeService<ToolServiceInstance>,
  group: ToolRequestGroup,
  config: ToolExecutionConfig,
): Effect.Effect<{ results: ToolExecutionResult[]; combinedObservation: string }, never> {
  if (group.requests.length === 0) {
    return Effect.succeed({ results: [], combinedObservation: "No tool request." });
  }

  if (group.mode === "single") {
    const req = group.requests[0]!;
    return executeToolCall(toolService, req, config).pipe(
      Effect.map((r) => ({ results: [r], combinedObservation: r.content })),
    );
  }

  if (group.mode === "parallel") {
    return Effect.all(
      group.requests.map((req) => executeToolCall(toolService, req, config)),
      { concurrency: "unbounded" },
    ).pipe(
      Effect.map((results) => ({
        results,
        combinedObservation: results
          .map((r, i) => `[${i + 1}] ${group.requests[i]!.tool}: ${r.content}`)
          .join("\n"),
      })),
    );
  }

  // Chain mode: sequential with $RESULT forwarding
  return Effect.gen(function* () {
    const results: ToolExecutionResult[] = [];
    let lastResult = "";
    for (const req of group.requests) {
      const resolvedInput = req.input.replace(/\$RESULT/g, lastResult);
      const resolved = { ...req, input: resolvedInput };
      const result = yield* executeToolCall(toolService, resolved, config);
      results.push(result);
      if (!result.observationResult.success) break; // chain fails fast
      lastResult = result.content;
    }
    const combinedObservation = results
      .map((r, i) => `[chain ${i + 1}] ${group.requests[i]!.tool}: ${r.content}`)
      .join("\n");
    return { results, combinedObservation };
  });
}
