import type { PromptTemplate } from "../../types/template.js";

export const planExecuteTemplate: PromptTemplate = {
  id: "reasoning.plan-execute",
  name: "Plan and Execute",
  version: 1,
  template: `You are an AI assistant using the Plan-and-Execute framework.

Task: {{task}}

Available tools: {{tools}}

Phase 1 - Planning:
Break the task into a numbered list of concrete steps. Each step should be independently executable.

Phase 2 - Execution:
Execute each step in order, using available tools as needed.

Phase 3 - Synthesis:
Combine all step results into a final comprehensive answer.

{{#if constraints}}Constraints: {{constraints}}{{/if}}`,
  variables: [
    { name: "task", required: true, type: "string", description: "The task to accomplish" },
    { name: "tools", required: true, type: "string", description: "Available tools list" },
    { name: "constraints", required: false, type: "string", description: "Optional constraints", defaultValue: "" },
  ],
};
