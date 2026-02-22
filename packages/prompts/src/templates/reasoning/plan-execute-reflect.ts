import type { PromptTemplate } from "../../types/template.js";

export const planExecuteReflectTemplate: PromptTemplate = {
  id: "reasoning.plan-execute-reflect",
  name: "Plan-Execute Reflection Phase System Prompt",
  version: 1,
  template:
    "You are evaluating plan execution. Determine if the task has been adequately addressed.",
  variables: [],
};
