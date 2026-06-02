import type { ResolvedCapability } from "./capability.js";

export interface ProviderRequest {
  readonly systemPrompt: string;
  readonly messages: ReadonlyArray<{
    role: string;
    content: string;
    toolCallId?: string;
    toolName?: string;
    toolCalls?: unknown;
  }>;
  readonly tools: readonly unknown[];
}

export interface GoalState {
  readonly goal: string;
  readonly remaining: readonly string[];
}

export interface ToolsSnapshot {
  readonly schemas: readonly unknown[];
}

export type { ResolvedCapability };
