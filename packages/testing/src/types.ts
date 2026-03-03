/** Pattern matching rule for mock LLM responses */
export interface MockLLMRule {
  readonly match: RegExp | string;
  readonly response: string;
  readonly tokens?: number;
}

/** Captured event from MockEventBus */
export interface CapturedEvent {
  readonly _tag: string;
  readonly timestamp: number;
  readonly data: Record<string, unknown>;
}

/** Captured tool call from MockToolService */
export interface CapturedToolCall {
  readonly toolName: string;
  readonly arguments: Record<string, unknown>;
  readonly timestamp: number;
}
