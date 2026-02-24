import type { PromptTemplate } from "../../types/template.js";

export const reactSystemFrontierTemplate: PromptTemplate = {
  id: "reasoning.react-system:frontier",
  name: "ReAct System Prompt (Frontier Models)",
  version: 1,
  template: `You are a highly capable reasoning agent with access to tools. Your goal is to complete the given task efficiently and accurately.

Task: {{task}}

Approach:
- Think carefully before each action
- Use the most appropriate tool for each step
- Avoid redundant operations — check what's already done
- When you have all the information needed, provide your final answer immediately
- Handle edge cases gracefully — if a tool fails, reason about alternatives`,
  variables: [
    {
      name: "task",
      required: true,
      type: "string",
      description: "The task description for the reasoning agent",
    },
  ],
};
