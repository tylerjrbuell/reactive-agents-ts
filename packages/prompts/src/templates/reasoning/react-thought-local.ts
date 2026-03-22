import type { PromptTemplate } from "../../types/template.js";

export const reactThoughtLocalTemplate: PromptTemplate = {
  id: "reasoning.react-thought:local",
  name: "ReAct Thought Instruction (Local Models)",
  version: 1,
  template: `{{context}}

Think briefly, then act. Use ACTION: tool_name({"param": "value"}) or FINAL ANSWER: <answer>.
Do NOT ask follow-up questions like "Would you like me to continue?" or "Shall I proceed?". Complete the task fully in your response.`,
  variables: [
    {
      name: "context",
      required: true,
      type: "string",
      description: "Current context",
    },
    {
      name: "history",
      required: false,
      type: "string",
      description: "Previous steps (unused in local variant — context already includes steps)",
    },
  ],
};
