import type { PromptTemplate } from "../../types/template.js";

export const treeOfThoughtSynthesizeTemplate: PromptTemplate = {
  id: "reasoning.tree-of-thought-synthesize",
  name: "Tree-of-Thought Synthesis System Prompt",
  version: 1,
  template:
    "Synthesize the reasoning path into a clear, concise final answer.",
  variables: [],
};
