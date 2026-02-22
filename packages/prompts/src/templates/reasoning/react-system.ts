import type { PromptTemplate } from "../../types/template.js";

export const reactSystemTemplate: PromptTemplate = {
  id: "reasoning.react-system",
  name: "ReAct System Prompt",
  version: 1,
  template: "You are a reasoning agent. Task: {{task}}",
  variables: [
    {
      name: "task",
      required: true,
      type: "string",
      description: "The task description for the reasoning agent",
    },
  ],
};
