import type { PromptTemplate } from "../../types/template.js";

export const reactSystemLocalTemplate: PromptTemplate = {
  id: "reasoning.react-system:local",
  name: "ReAct System Prompt (Local Models)",
  version: 1,
  template: "You are an AI agent. Use tools to complete the task. One action per turn. Task: {{task}}",
  variables: [
    {
      name: "task",
      required: true,
      type: "string",
      description: "The task description",
    },
  ],
};
