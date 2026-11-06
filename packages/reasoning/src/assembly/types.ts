import type { MessageContent } from "@reactive-agents/core";
import type { ResolvedCapability } from "./capability.js";

export interface ProviderRequest {
  readonly systemPrompt: string;
  readonly messages: ReadonlyArray<{
    role: string;
    /** Typed parts (Plan 9 Phase 4); text-only content is one string. */
    content: MessageContent;
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
