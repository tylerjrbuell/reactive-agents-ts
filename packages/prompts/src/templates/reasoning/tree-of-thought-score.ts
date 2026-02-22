import type { PromptTemplate } from "../../types/template.js";

export const treeOfThoughtScoreTemplate: PromptTemplate = {
  id: "reasoning.tree-of-thought-score",
  name: "Tree-of-Thought Scoring System Prompt",
  version: 1,
  template:
    "You are evaluating a reasoning path. Rate its promise on a scale of 0.0 to 1.0. Respond with ONLY a number.",
  variables: [],
};
