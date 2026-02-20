import type { PromptTemplate } from "../../types/template.js";

export const treeOfThoughtTemplate: PromptTemplate = {
  id: "reasoning.tree-of-thought",
  name: "Tree of Thought",
  version: 1,
  template: `You are an AI assistant using the Tree-of-Thought reasoning framework.

Problem: {{problem}}

Generate {{branches}} different approaches to solve this problem.
For each approach:
1. Describe the approach
2. Evaluate its strengths and weaknesses
3. Rate its likelihood of success (0-1)

Then select the most promising approach and develop it fully.

{{#if evaluation_criteria}}Evaluation criteria: {{evaluation_criteria}}{{/if}}`,
  variables: [
    { name: "problem", required: true, type: "string", description: "The problem to solve" },
    { name: "branches", required: false, type: "number", description: "Number of approaches to generate", defaultValue: 3 },
    { name: "evaluation_criteria", required: false, type: "string", description: "Criteria for evaluating approaches", defaultValue: "" },
  ],
};
