import type { PromptTemplate } from "../../types/template.js";

export const judgeRelevanceTemplate: PromptTemplate = {
  id: "evaluation.judge-relevance",
  name: "Relevance Scoring Prompt",
  version: 1,
  template: `You are an evaluation judge. Score the relevance of this AI response on a scale of 0.0 to 1.0.

Input: {{input}}
Actual output: {{actualOutput}}

Relevance measures whether the response directly addresses the question or task.
A score of 1.0 means fully on-topic. A score of 0.0 means completely off-topic.
Respond with ONLY a decimal number between 0.0 and 1.0. No explanation.`,
  variables: [
    { name: "input", required: true, type: "string", description: "The original input/question" },
    { name: "actualOutput", required: true, type: "string", description: "The actual AI response" },
  ],
};
