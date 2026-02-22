import type { PromptTemplate } from "../../types/template.js";

export const reactThoughtTemplate: PromptTemplate = {
  id: "reasoning.react-thought",
  name: "ReAct Thought Instruction",
  version: 1,
  template: `{{context}}

Previous steps:
{{history}}

Think step-by-step. If you need a tool, respond with "ACTION: tool_name({"param": "value"})" using valid JSON for the arguments. For tools with multiple parameters, include all required fields in the JSON object. If you have a final answer, respond with "FINAL ANSWER: ...".`,
  variables: [
    {
      name: "context",
      required: true,
      type: "string",
      description: "Current context including task, tools, and memory",
    },
    {
      name: "history",
      required: true,
      type: "string",
      description: "Previous reasoning steps",
    },
  ],
};
