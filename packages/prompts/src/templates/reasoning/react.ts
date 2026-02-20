import type { PromptTemplate } from "../../types/template.js";

export const reactTemplate: PromptTemplate = {
  id: "reasoning.react",
  name: "ReAct Reasoning",
  version: 1,
  template: `You are an AI assistant using the ReAct (Reasoning + Acting) framework.

Task: {{task}}

Available tools: {{tools}}

For each step, follow this pattern:
Thought: Analyze what you know and what you need to do next
Action: Choose a tool and specify the input
Observation: Review the tool result

Continue until you can provide a final answer.

{{#if constraints}}Constraints: {{constraints}}{{/if}}

When you have enough information, respond with:
Thought: I now have enough information to answer
Final Answer: [your comprehensive answer]`,
  variables: [
    { name: "task", required: true, type: "string", description: "The task to accomplish" },
    { name: "tools", required: true, type: "string", description: "Available tools list" },
    { name: "constraints", required: false, type: "string", description: "Optional constraints", defaultValue: "" },
  ],
};
