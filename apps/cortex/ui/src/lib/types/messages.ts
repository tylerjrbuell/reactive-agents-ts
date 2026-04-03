export type KernelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<{ type: string; [key: string]: unknown }>;
  toolCalls?: Array<{ id: string; name: string; input: unknown }>;
  toolName?: string;
  toolCallId?: string;
};

export type MessageGroup = {
  seq: number;
  kernelPass: number;
  step: number;
  totalSteps: number;
  strategy: string;
  messages: KernelMessage[];
};
