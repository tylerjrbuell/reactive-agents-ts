import type { PromptTemplate } from "../../types/template.js";

export const judgeGenericTemplate: PromptTemplate = {
  id: "evaluation.judge-generic",
  name: "Generic Dimension Scoring Prompt",
  version: 1,
  template: `You are an evaluation judge. Score "{{dimension}}" for this AI response on a scale of 0.0 to 1.0.

Input: {{input}}
Actual output: {{actualOutput}}

Respond with ONLY a decimal number between 0.0 and 1.0. No explanation.`,
  variables: [
    { name: "dimension", required: true, type: "string", description: "The evaluation dimension name" },
    { name: "input", required: true, type: "string", description: "The original input/question" },
    { name: "actualOutput", required: true, type: "string", description: "The actual AI response" },
  ],
};
