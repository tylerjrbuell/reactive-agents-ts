import type { ToolCallSpec } from "../tool-calling/types.js"

// ── ToolSchema (inline — tools does not depend on @reactive-agents/reasoning) ─

export interface ToolParamSchema {
  readonly name: string
  readonly type: string
  readonly description?: string
  readonly required?: boolean
  readonly items?: { readonly type: string }
  readonly enum?: readonly string[]
}

export interface ToolSchema {
  readonly name: string
  readonly description: string
  readonly parameters: readonly ToolParamSchema[]
}

// ── Parse modes ───────────────────────────────────────────────────────────────

export type ParseMode = "native-fc" | "tier-1" | "tier-2" | "tier-3" | "reprompt"

// ── Core types ────────────────────────────────────────────────────────────────

export interface ExtractedCall {
  readonly name: string
  readonly arguments: Record<string, unknown>
  readonly parseMode: ParseMode
  readonly confidence: number
}

export interface HealingAction {
  readonly stage: "tool-name" | "param-name" | "path" | "type-coerce"
  readonly from: string
  readonly to: string
}

export interface HealingResult {
  readonly call: ToolCallSpec
  readonly actions: readonly HealingAction[]
  readonly succeeded: boolean
}

export interface ToolCallObservation {
  readonly toolNameAttempted: string
  readonly toolNameResolved: string | null
  readonly paramsAttempted: Record<string, unknown>
  readonly paramsResolved: Record<string, unknown>
  readonly parseMode: ParseMode
  readonly healingApplied: readonly HealingAction[]
  readonly succeeded: boolean
  readonly errorText: string | null
}

// ── Driver interface ──────────────────────────────────────────────────────────

export interface ToolCallingDriver {
  readonly mode: "native-fc" | "text-parse"
  /** Returns "" for native-fc. Returns format guide + tool list for text-parse. */
  buildPromptInstructions(tools: readonly ToolSchema[]): string
  /** native-fc: pass through pendingNativeToolCalls. text-parse: run parse pipeline. */
  extractCalls(textOutput: string, tools: readonly ToolSchema[]): ExtractedCall[]
  /** native-fc: provider format (unchanged). text-parse: plain text observation. */
  formatToolResult(toolName: string, result: unknown, isError: boolean): string
}
