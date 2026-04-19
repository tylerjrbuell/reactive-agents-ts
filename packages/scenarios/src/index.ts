export type { Scenario, ScenarioTag, FailureMode } from "./types.js"
export { loopProneHaiku } from "./scenarios/loop-prone-haiku.js"
export { toolFailureWebSearch } from "./scenarios/tool-failure-web-search.js"
export { contextPressureNoisy } from "./scenarios/context-pressure-noisy.js"
export { longHorizonRepoTriage } from "./scenarios/long-horizon-repo-triage.js"
export { schemaDriftSql } from "./scenarios/schema-drift-sql.js"

import { loopProneHaiku } from "./scenarios/loop-prone-haiku.js"
import { toolFailureWebSearch } from "./scenarios/tool-failure-web-search.js"
import { contextPressureNoisy } from "./scenarios/context-pressure-noisy.js"
import { longHorizonRepoTriage } from "./scenarios/long-horizon-repo-triage.js"
import { schemaDriftSql } from "./scenarios/schema-drift-sql.js"

export const allScenarios = [
  loopProneHaiku,
  toolFailureWebSearch,
  contextPressureNoisy,
  longHorizonRepoTriage,
  schemaDriftSql,
] as const
