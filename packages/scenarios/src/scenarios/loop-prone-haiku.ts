import type { Scenario } from "../types.js"

export const loopProneHaiku: Scenario = {
  id: "loop-prone-haiku",
  description: "Write+verify haiku — mid-tier models loop on syllable-counting",
  task: "Write a valid haiku about the sea (5-7-5 syllables). Verify syllables before responding. Output only the final haiku.",
  tags: ["loop-prone"],
  expectedFailureWithoutRI: "loop-detected",
  successCriteria: (output) => output.split("\n").length === 3,
  preferredModels: ["claude-haiku-4-5", "qwen3:4b"],
}
