import type { ProviderCapabilities } from "@reactive-agents/llm-provider";
import { NativeFCStrategy } from "./native-fc-strategy.js";
import type { ToolCallResolver } from "./types.js";

export function createToolCallResolver(capabilities: ProviderCapabilities): ToolCallResolver {
  if (capabilities.supportsToolCalling) {
    return new NativeFCStrategy();
  }
  // StructuredOutputStrategy will be added in Task 12b
  throw new Error(
    "Provider supports neither native tool calling nor structured output. " +
    "Tool use requires at least one of these capabilities."
  );
}
