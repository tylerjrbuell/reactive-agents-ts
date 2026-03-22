import type { PromptTemplate } from "../../types/template.js";

export const reactSystemTemplate: PromptTemplate = {
  id: "reasoning.react-system",
  name: "ReAct System Prompt",
  version: 1,
  template: `You are a reasoning agent.

Rules:
- Your FINAL ANSWER must contain the COMPLETE deliverable (full code, full explanation, full data)
- NEVER say "see above" or "as shown" — the user only sees your final answer, not your thinking
- If you used scratchpad notes, synthesize them into your final answer

Task: {{task}}`,
  variables: [
    {
      name: "task",
      required: true,
      type: "string",
      description: "The task description for the reasoning agent",
    },
  ],
};
