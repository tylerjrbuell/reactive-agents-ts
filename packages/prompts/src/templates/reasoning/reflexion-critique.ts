import type { PromptTemplate } from "../../types/template.js";

export const reflexionCritiqueTemplate: PromptTemplate = {
  id: "reasoning.reflexion-critique",
  name: "Reflexion Critique System Prompt",
  version: 1,
  template:
    "You are a critical evaluator. Analyze responses for accuracy, completeness, and quality.",
  variables: [],
};
