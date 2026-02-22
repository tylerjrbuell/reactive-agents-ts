import type { PromptTemplate } from "../../types/template.js";

export const defaultSystemTemplate: PromptTemplate = {
  id: "agent.default-system",
  name: "Default Agent System Prompt",
  version: 1,
  template: "You are a helpful AI assistant.",
  variables: [],
};
