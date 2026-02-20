import type { PromptTemplate } from "../../types/template.js";

export const reflexionTemplate: PromptTemplate = {
  id: "reasoning.reflexion",
  name: "Reflexion",
  version: 1,
  template: `You are an AI assistant using the Reflexion framework for self-improving reasoning.

Task: {{task}}

{{#if previous_attempt}}
Previous attempt:
{{previous_attempt}}

Reflection on previous attempt:
{{reflection}}
{{/if}}

Instructions:
1. Attempt to solve the task
2. After your attempt, reflect on what went well and what could be improved
3. If your solution is unsatisfactory, revise it based on your reflection

Provide your final answer after reflection.`,
  variables: [
    { name: "task", required: true, type: "string", description: "The task to accomplish" },
    { name: "previous_attempt", required: false, type: "string", description: "Previous attempt output", defaultValue: "" },
    { name: "reflection", required: false, type: "string", description: "Reflection on previous attempt", defaultValue: "" },
  ],
};
