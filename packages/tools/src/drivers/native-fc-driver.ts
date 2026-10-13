import type { ExtractedCall, ToolCallingDriver, ToolCallDialectClaim, ToolSchema } from "./tool-calling-driver.js"

export class NativeFCDriver implements ToolCallingDriver {
  readonly mode = "native-fc" as const
  /** Provenance claim that confirmed this selection (undefined = no claim). */
  readonly dialectClaim: ToolCallDialectClaim | undefined

  constructor(dialectClaim?: ToolCallDialectClaim) {
    this.dialectClaim = dialectClaim
  }

  buildPromptInstructions(_tools: readonly ToolSchema[]): string {
    return ""
  }

  extractCalls(_textOutput: string, _tools: readonly ToolSchema[]): ExtractedCall[] {
    return []
  }

  formatToolResult(toolName: string, result: unknown, isError: boolean): string {
    const content = typeof result === "string" ? result : JSON.stringify(result)
    return isError ? `[${toolName} error] ${content}` : content
  }
}
