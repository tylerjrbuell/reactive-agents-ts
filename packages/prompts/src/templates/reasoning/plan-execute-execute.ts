import type { PromptTemplate } from "../../types/template.js";

export const planExecuteExecuteTemplate: PromptTemplate = {
  id: "reasoning.plan-execute-execute",
  name: "Plan-Execute Execution Phase System Prompt",
  version: 1,
  template: "You are executing a plan for: {{task}}",
  variables: [
    {
      name: "task",
      required: true,
      type: "string",
      description: "The task description",
    },
  ],
};
