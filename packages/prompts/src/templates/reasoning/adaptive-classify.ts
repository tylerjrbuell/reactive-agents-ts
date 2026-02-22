import type { PromptTemplate } from "../../types/template.js";

export const adaptiveClassifyTemplate: PromptTemplate = {
  id: "reasoning.adaptive-classify",
  name: "Adaptive Task Classification System Prompt",
  version: 1,
  template:
    "You are a task analyzer. Classify the task and recommend the best reasoning strategy. Respond with ONLY one of: REACTIVE, REFLEXION, PLAN_EXECUTE, TREE_OF_THOUGHT",
  variables: [],
};
