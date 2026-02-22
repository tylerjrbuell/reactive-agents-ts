import type { PromptTemplate } from "../../types/template.js";

export const judgeAccuracyTemplate: PromptTemplate = {
  id: "evaluation.judge-accuracy",
  name: "Accuracy Scoring Prompt",
  version: 1,
  template: `You are an evaluation judge. Score the accuracy of this AI response on a scale of 0.0 to 1.0.

Input: {{input}}
{{reference}}
Actual output: {{actualOutput}}

Accuracy measures whether the response is factually correct and matches the expected answer.
Respond with ONLY a decimal number between 0.0 and 1.0. No explanation.`,
  variables: [
    { name: "input", required: true, type: "string", description: "The original input/question" },
    { name: "reference", required: true, type: "string", description: "Reference/expected output line" },
    { name: "actualOutput", required: true, type: "string", description: "The actual AI response" },
  ],
};
