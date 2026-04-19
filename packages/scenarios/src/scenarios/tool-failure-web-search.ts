import type { Scenario } from "../types.js"

export const toolFailureWebSearch: Scenario = {
  id: "tool-failure-web-search",
  description: "Agent must recover from web-search returning empty results",
  task: "Find the current price of AAPL stock. Use web-search. If search fails, say 'search unavailable'.",
  tags: ["tool-failure"],
  expectedFailureWithoutRI: "tool-call-fail",
  successCriteria: (output) => /\$\d+|\bunavailable\b/i.test(output),
  preferredModels: ["claude-haiku-4-5"],
}
