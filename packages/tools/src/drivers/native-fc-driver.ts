import type { ExtractedCall, ToolCallingDriver, ToolSchema } from "./tool-calling-driver.js"

export class NativeFCDriver implements ToolCallingDriver {
  readonly mode = "native-fc" as const

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
