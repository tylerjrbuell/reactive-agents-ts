import type { Scenario } from "../types.js"

export const contextPressureNoisy: Scenario = {
  id: "context-pressure-noisy",
  description: "Agent accumulates noisy tool outputs until context pressure spikes",
  task: "Summarize the following 50 document snippets into 3 key themes: " + "snippet. ".repeat(50),
  tags: ["context-pressure"],
  expectedFailureWithoutRI: "context-overflow",
  successCriteria: (output) => output.length > 50,
  preferredModels: ["cogito:14b"],
}
