import type { Scenario } from "../types.js"

export const longHorizonRepoTriage: Scenario = {
  id: "long-horizon-repo-triage",
  description: "Multi-step repo triage requiring plan + reflect phases",
  task: "Given this repo has 3 open bugs and 2 feature requests, triage them by priority. Explain your reasoning.",
  tags: ["long-horizon", "multi-step-planning"],
  expectedFailureWithoutRI: "abandoned-mid-plan",
  successCriteria: (output) => /priority|triage|bug/i.test(output),
  preferredModels: ["claude-haiku-4-5", "cogito:14b"],
}
