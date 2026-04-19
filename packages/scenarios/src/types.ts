export type ScenarioTag =
  | "loop-prone"
  | "tool-failure"
  | "context-pressure"
  | "long-horizon"
  | "multi-step-planning"
  | "schema-drift"

export type FailureMode =
  | "loop-detected"
  | "tool-call-fail"
  | "context-overflow"
  | "hallucinated-args"
  | "abandoned-mid-plan"

export interface Scenario {
  readonly id: string
  readonly description: string
  readonly task: string
  readonly tags: readonly ScenarioTag[]
  readonly expectedFailureWithoutRI: FailureMode
  readonly successCriteria: (output: string) => boolean
  readonly preferredModels: readonly string[]
  readonly setup?: () => Promise<{ tools?: unknown; teardown?: () => Promise<void> }>
}
