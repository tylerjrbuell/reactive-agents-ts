import type { PromptTemplate } from "../../types/template.js";

export const judgeCompletenessTemplate: PromptTemplate = {
  id: "evaluation.judge-completeness",
  name: "Completeness Scoring Prompt",
  version: 1,
  template: `You are an evaluation judge. Score the completeness of this AI response on a scale of 0.0 to 1.0.

Input: {{input}}
{{reference}}
Actual output: {{actualOutput}}

Completeness measures whether all parts of the question were answered and nothing important was left out.
A score of 1.0 means fully complete. A score of 0.0 means nothing was answered.
Respond with ONLY a decimal number between 0.0 and 1.0. No explanation.`,
  variables: [
    { name: "input", required: true, type: "string", description: "The original input/question" },
    { name: "reference", required: true, type: "string", description: "Reference/expected output line" },
    { name: "actualOutput", required: true, type: "string", description: "The actual AI response" },
  ],
};
