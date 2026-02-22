import type { PromptTemplate } from "../../types/template.js";

export const planExecutePlanTemplate: PromptTemplate = {
  id: "reasoning.plan-execute-plan",
  name: "Plan-Execute Planning Phase System Prompt",
  version: 1,
  template:
    "You are a planning agent. Break tasks into clear, sequential steps. Task: {{task}}",
  variables: [
    {
      name: "task",
      required: true,
      type: "string",
      description: "The task description",
    },
  ],
};
