import type { PromptTemplate } from "../../types/template.js";

export const reflexionGenerateTemplate: PromptTemplate = {
  id: "reasoning.reflexion-generate",
  name: "Reflexion Generation System Prompt",
  version: 1,
  template: `You are a thoughtful reasoning agent. Your task is: {{task}}
Provide clear, accurate, and complete responses.`,
  variables: [
    {
      name: "task",
      required: true,
      type: "string",
      description: "The task description",
    },
  ],
};
