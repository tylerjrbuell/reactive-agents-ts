import type { Rationale } from "@reactive-agents/core"
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

/**
 * Closed vocabulary of tool-calling dialect CLAIMS (W3b, plan 3.3). Mirrors the
 * calibration `toolCallDialect` literals and llm-provider's `DialectPriorClaim`
 * — a string outside this vocabulary is NOT a claim and must never be defaulted
 * into one (GH #243: never teach/parse/default on a guessed format).
 */
export type ToolCallDialectClaim = "native-fc" | "text-parse" | "none"

// ── Core types ────────────────────────────────────────────────────────────────

export interface ExtractedCall {
  readonly name: string
  readonly arguments: Record<string, unknown>
  readonly parseMode: ParseMode
  readonly confidence: number
  /**
   * Optional rationale emitted by the model in the same JSON object as the
   * tool call (v0.11.x). Captured by tier-2/tier-3 parsers when present;
   * tier-1 captures it from a `rationale: { ... }` JSON line.
   */
  readonly rationale?: Rationale
}

export interface HealingAction {
  readonly stage: "tool-name" | "param-name" | "param-structure" | "path" | "type-coerce" | "judgment"
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
  /**
   * Source-tagged provenance (W3b, spec 2026-06-03 §3: "surface the observed
   * parse mode / dialect … so a wrong route is *visible* in telemetry, not
   * silent"). The explicit dialect claim that informed this driver's
   * selection, or `undefined` when there was no claim. It NEVER selects the
   * mode — the capability claim is the sole routing arbiter (design law #1;
   * `dialectClaim: "none"` on a native driver is exactly the 482c11e4 class
   * the Stage-A triple pins against).
   */
  readonly dialectClaim?: ToolCallDialectClaim
  /** Returns "" for native-fc. Returns format guide + tool list for text-parse. */
  buildPromptInstructions(tools: readonly ToolSchema[]): string
  /** native-fc: pass through pendingNativeToolCalls. text-parse: run parse pipeline. */
  extractCalls(textOutput: string, tools: readonly ToolSchema[]): ExtractedCall[]
  /** native-fc: provider format (unchanged). text-parse: plain text observation. */
  formatToolResult(toolName: string, result: unknown, isError: boolean): string
}
