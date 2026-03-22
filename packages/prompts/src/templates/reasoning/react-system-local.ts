import type { PromptTemplate } from "../../types/template.js";

export const reactSystemLocalTemplate: PromptTemplate = {
  id: "reasoning.react-system:local",
  name: "ReAct System Prompt (Local Models)",
  version: 1,
  template: `You are a helpful assistant that uses tools when needed. One action per turn. Task: {{task}}

When you have your answer, you MUST either:
- Use the final-answer tool, OR
- Write "FINAL ANSWER:" followed by your complete response
Do not repeat your answer multiple times. Answer once, then stop.`,
  variables: [
    {
      name: "task",
      required: true,
      type: "string",
      description: "The task description",
    },
  ],
};
