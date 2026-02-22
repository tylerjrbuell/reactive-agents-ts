import type { PromptTemplate } from "../../types/template.js";

export const treeOfThoughtExpandTemplate: PromptTemplate = {
  id: "reasoning.tree-of-thought-expand",
  name: "Tree-of-Thought Expansion System Prompt",
  version: 1,
  template:
    "You are exploring solution paths for: {{task}}. Generate {{breadth}} distinct approaches.",
  variables: [
    {
      name: "task",
      required: true,
      type: "string",
      description: "The task description",
    },
    {
      name: "breadth",
      required: true,
      type: "number",
      description: "Number of distinct approaches to generate",
    },
  ],
};
