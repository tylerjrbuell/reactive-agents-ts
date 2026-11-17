---
title: Reasoning, tools and skills
description: >-
  Builder reference for withReasoning, withTools, withRequiredTools, meta-tools and skills, with ReasoningOptions, ToolsOptions and MetaToolsConfig.
sidebar:
  order: 3
topic: config-reference
related:
  - reference/builder-api
  - guides/reasoning
  - guides/tools
  - guides/choosing-strategies
---

Methods that shape how the agent thinks and acts: the reasoning strategy and its options, the tool layer, required tools, meta-tools and living skills. Part of the [builder reference](/reference/builder-api/).

## Reasoning and tools methods

| Method                               | Description                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `withReasoning(options?)`            | Strategies + ICS — see [ReasoningOptions](#reasoningoptions)                                                                                                                                                                                                                                                                                                                                                 |
| `withTools(options?)`                | Tool layer — see [ToolsOptions](#toolsoptions) below                                                                                                                                                                                                                                                                                                                                                         |
| `withRequiredTools(config)`          | Tools that must run before success — `{ tools?, adaptive?, maxRetries? }`. When `adaptive: true`, the framework also auto-sets a per-tool call budget of 3 for search-type tools to prevent infinite research loops.                                                                                                                                                                                         |
| `withMetaTools(config?)`             | Conductor meta-tools; pass **`false`** to turn off defaults when using `.withTools()`. See [MetaToolsConfig](#metatoolsconfig)                                                                                                                                                                                                                                                                               |
| `withSkills(config?)`                | `{ paths?, activate?, global? }` — per-run skill discovery at the run's root (`<root>/.agents/skills` etc.; no args = workspace only). Relative `paths` resolve against the run's root; `global: true` adds `~/.agents/skills` and `~/.reactive-agents/skills` (opt-in). Per-run pins: `run(task, { skills: { activate } })`. The removed `packages` / `evolution` / `overrides` keys throw. |

### ToolsOptions

| Field               | Description                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `tools`             | `{ definition: ToolDefinition, handler: (args) => Effect.Effect<unknown> }[]` — custom tools (handlers return **Effect**). Each `definition` is validated against the `ToolDefinition` schema when the tool is registered (lazily, on first `run()`/`runStream()` — not at `.build()`); a malformed definition (missing `description`, a parameter with no `name`, etc.) throws a `ToolDefinitionError` naming the tool and the offending field, rather than being silently accepted and failing later during execution. |
| `resultCompression` | `ResultCompressionConfig` — previews, overflow keys, transforms                                                           |
| `allowedTools`      | If set, only these tool names are exposed to the model (others filtered) — and the allowlist is enforced at execution on every strategy: a call outside it is blocked, never run. A toolset name grants only that toolset: `["git"]` without `"shell-execute"` limits the shell to `git` and `gh`, even with `terminal` on. Name `"shell-execute"` to allow the full terminal |
| `adaptive`          | Adaptive tool listing from task text (heuristic), reduces noise for small models                                          |
| `terminal`          | `true \| ShellExecuteConfig` — opt in to the sandboxed `shell-execute` tool (command allowlist, blocklist, locked cwd). Its working directory is the `workspace` when one is set, else a fresh /tmp sandbox dir |
| `workspace`         | `string` — the agent's working directory. File tools resolve relative paths against it and refuse paths outside it; `shell-execute` runs in it. A `terminal.cwd` resolves inside it and is refused if it escapes, unless `terminal.allowUnsafeCwd` is set. Stored absolute; must be an existing directory, or `.withTools()` throws `ToolsOptionError`. Sub-agents inherit it. Override per run with `run(task, { workspace })`. Precedence: run option, then this, then an ambient `withFileRoot()`, then none (`process.cwd()` for file tools). Round-trips as `tools.workspace` in `toConfig()`. |
| `webSearch`         | `{ apiKeys?, providers? }` — configure the `web-search` built-in for this agent. `apiKeys` maps `tavily`, `brave`, `serper`, `keenable` to a string or `Redacted` key and wins over the provider's env var (per agent: no process env, so shell and code-execute children never see it). `providers` is the ordered subset to try (`"duckduckgo"` is the keyless fallback; leave it out to disable). Applies only when `web-search` is a permitted built-in. Round-trips only `providers` as `tools.webSearch` in `toConfig()`; `apiKeys` are runtime-only and never serialized. |
| `riskLevels`        | `Record<string, "low" \| "medium" \| "high" \| "critical">` — override any tool's declared risk level by name, built-ins and MCP tools included (e.g. `{ "file-read": "low" }`). A tool call embedded in prose or code (`const x = fileRead("/abs")`) is bound only for `"low"` tools. Maps merge across `.withTools()` calls; unknown names log a build warning and are ignored. |
| `maxCallsPerTool`   | `Record<string, number>` — cap how many times each named tool may run in one agent run (e.g. `{ "web-search": 3 }`). A call past the cap is not run; the model gets a tool result saying so and keeps working. The cap counts the whole run, including several calls in one turn. Unnamed tools have no cap; names that match no tool have no effect. Each cap must be a positive integer, or `.withTools()` throws `ToolsOptionError`. Maps merge across `.withTools()` calls (later call wins per name). Every strategy enforces it. Sub-agents run under the parent's caps; a `.withAgentTool()` sub-agent's own `maxCallsPerTool` is merged over them (its cap wins per name). |

### MetaToolsConfig

| Field                                       | Description                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| `brief`, `find`, `pulse`, `recall`          | Enable each Conductor meta-tool                                             |
| `todo`                                      | Enable the `todo` checklist meta-tool. Opt-in on library agents; accepts a closed table of action aliases (`update`/`set` heal to the canonical actions), skips duplicate titles on `add`, and closes the loop in its result lines. Experimental: its effect on task outcomes is not lift-measured |
| `todoGuidance`                              | `{ reminder?, systemLine? }` — opt-in nudges to keep the to-do list current. Default off, experimental, not lift-measured. Threaded to the kernel as `checklistGuidance` |
| `harnessSkill`                              | `boolean`, path string, or `{ frontier?, local? }` for harness skill source |
| `findConfig`, `pulseConfig`, `recallConfig` | Fine-tuning (scopes, previews, LLM pulse behavior, …)                       |

**Live checklist (`observability.checklist`).** `.withObservability({ checklist })` (default `true`) projects a live checklist from the contract and ledger facts the terminal gate judges and emits `ChecklistUpdated` on the stream. It is display-only: a request-identity test proves the model-visible request is identical with it on or off. Requirement rows carry gate truth; advisory rows (the `todo` tool) never count toward done.

**Session mode: Plan and Execute.** A chat session is in one of two modes, `"execute"` (the default) or `"plan"`. Read it with `session.mode` and switch it with `session.setMode("plan")`, or start in a mode with `agent.session({ mode: "plan" })`. The mode is session state: it holds for every later turn until you change it, and each session has its own. Every turn's run posture comes from the session mode (`plan` gives `rails.posture: "plan"`; `execute` carries nothing). In plan mode the turn reasons without running tools: only the planning tools (`todo`, `brief`, `final-answer`) are offered, every capability tool call is refused, and the reply is the plan. The plan is also a checklist: if the model records no `todo` list, the harness derives one from the reply's numbered or bulleted step lines. That reply stays in the session history, and the checklist seeds the next execute turn. A per-turn `posture` option (on `chat()` and `runStream()`) still overrides the mode for that turn only and never changes it. Session mode is unrelated to the `plan-execute` reasoning strategy. Types: `ChatMode` from `@reactive-agents/runtime`.

**Carrying a to-do list across chat turns.** `agent.session({ initialTodo })` seeds the conversation with a prior to-do list; `session.todo()` reads the current list back so a host can persist it. `snapshotToTodoSeed(snapshot)` (from `@reactive-agents/runtime`) maps a streamed checklist snapshot to the seed rows. Each turn continues the list instead of starting empty.

**Plan then execute.** `agent.plan(input, options?)` runs the task under plan posture and returns a typed `Plan` (`{ id, goal, steps, createdAt, source }`; each step is `{ id, title, tool?, status }`). It always has steps, or it rejects with `PlanNoStepsError`. `agent.execute(plan, options?)` and `agent.run(input, { plan })` run seeded from the plan's checklist and add `result.plan` with each step's final status. `session.plan` reads the conversation's to-do list as a `Plan`; `session.setPlan(planOrSteps)` replaces it before the next execute turn. Events: `PlanRecorded`, `PlanStepStatusChanged`. `agent.execute(plan, { strategy? })` runs the plan in the loop, `blueprint` or `plan-execute-reflect`: an explicit `strategy` wins, an agent already on one of those two adopts the plan, a plan with `dependsOn` or `args` runs in `blueprint`, free steps run in the loop. A plan that does not decode or whose `dependsOn` is unsound rejects `PlanInvalidError` before any run. Seeded-plan harness switches, both default on: `.withHarness({ autoTick: false })` (`RA_AUTO_TICK=0`) and `.withHarness({ bookkeepingRefund: false })` (`RA_BOOKKEEPING_REFUND=0`). Plan guidance names the execute-phase tools by default; `.withHarness({ planToolCatalog: false })` or `RA_PLAN_TOOL_CATALOG=0` turns that off. See the [Plan Then Execute guide](/guides/plan-then-execute/). Types (`Plan`, `PlanStep`, `isPlanEmpty`) come from `@reactive-agents/core`; `PlanNoStepsError` from `@reactive-agents/runtime`.

### ReasoningOptions

<!-- docs-skip-typecheck -->
```typescript
interface ReasoningOptions {
    /**
     * Which strategy to use. Defaults to "reactive".
     * "adaptive" requires adaptive.enabled: true.
     */
    defaultStrategy?:
        | 'reactive'
        | 'reflexion'
        | 'plan-execute-reflect'
        | 'tree-of-thought'
        | 'adaptive'

    /**
     * Per-strategy overrides (iterations, temperatures, plan knobs, etc.).
     * Each bundle may also set ICS fields (`synthesis`, `synthesisModel`, `synthesisProvider`,
     * `synthesisStrategy`, `synthesisTemperature`) — they override the top-level synthesis
     * options for that strategy only (see Intelligent Context Synthesis).
     */
    strategies?: Partial<{
        reactive: ReasoningConfig['strategies']['reactive'] &
            StrategySynthesisFields
        planExecute: ReasoningConfig['strategies']['planExecute'] &
            StrategySynthesisFields
        treeOfThought: ReasoningConfig['strategies']['treeOfThought'] &
            StrategySynthesisFields
        reflexion: ReasoningConfig['strategies']['reflexion'] &
            StrategySynthesisFields
    }>

    /** Adaptive strategy config. Must set enabled: true when defaultStrategy is "adaptive". */
    adaptive?: {
        enabled?: boolean // Required for adaptive strategy
        learning?: boolean // Enable cross-run learning (default: false)
    }

    /** Max iterations of the reasoning loop (default: 10). */
    maxIterations?: number

    /**
     * Automatically switch to a better-suited strategy when the current one appears stuck
     * (repeated tool calls, repeated thoughts, or consecutive think-only steps).
     * Default: false (opt-in). Measured 2026-11-05: no accuracy lift, +28% billed tokens.
     */
    enableStrategySwitching?: boolean

    /**
     * Maximum number of strategy switches allowed in a single run.
     * Default: 1.
     */
    maxStrategySwitches?: number

    /**
     * When set, bypasses the LLM evaluator and always switches to this strategy on loop
     * detection. Useful when you want deterministic switching without the extra LLM call.
     * Example: "plan-execute-reflect"
     */
    fallbackStrategy?: string

    /** ICS default mode: auto (heuristic), fast (templates), deep (LLM), custom, or off. */
    synthesis?: 'auto' | 'fast' | 'deep' | 'custom' | 'off'
    /** Model for deep synthesis when different from the executing model. */
    synthesisModel?: string
    /** Provider for the synthesis model when different from the executing provider. */
    synthesisProvider?: string
    /** Custom synthesis pipeline when `synthesis: "custom"`. */
    synthesisStrategy?: SynthesisStrategy
    /** Temperature for deep synthesis LLM calls. */
    synthesisTemperature?: number
}

/** ICS-only fields allowed on each `strategies.*` bundle (merged with top-level synthesis). */
interface StrategySynthesisFields {
    synthesis?: 'auto' | 'fast' | 'deep' | 'custom' | 'off'
    synthesisModel?: string
    synthesisProvider?: string
    synthesisStrategy?: SynthesisStrategy
    synthesisTemperature?: number
}
```

Per-strategy objects under `strategies` also accept strategy-specific fields from `@reactive-agents/reasoning` (for example `kernelMaxIterations` on the `reflexion` bundle).

At runtime, `ReasoningOptions` may also include a non-JSON `synthesisStrategy` function when using `synthesis: "custom"` (omitted from `toConfig()` / JSON).

**Examples:**

<!-- docs-skip-typecheck -->
```typescript
// Default: ReAct with no options
.withReasoning()

// Switch to Plan-Execute-Reflect strategy
.withReasoning({ defaultStrategy: "plan-execute-reflect" })

// Adaptive strategy (must set adaptive.enabled)
.withReasoning({ defaultStrategy: "adaptive", adaptive: { enabled: true } })

// Auto-switch when stuck, up to 2 times, via LLM evaluator
.withReasoning({ enableStrategySwitching: true, maxStrategySwitches: 2 })

// Auto-switch deterministically (no extra LLM call) to plan-execute-reflect
.withReasoning({ enableStrategySwitching: true, fallbackStrategy: "plan-execute-reflect" })

// ICS: fast templates globally, but deep LLM synthesis when running ReAct
.withReasoning({
  synthesis: "fast",
  strategies: { reactive: { synthesis: "deep", synthesisModel: "claude-haiku-4-5-20251001" } },
})
```

When `enableStrategySwitching` is active, two EventBus events are emitted around each switch:

-   `StrategySwitchEvaluated` — after the evaluator runs, before the switch (includes `willSwitch`, `rationale`, `recommendedStrategy`)
-   `StrategySwitched` — after the new strategy takes over (includes `fromStrategy`, `toStrategy`, `switchNumber`, `stepsCarriedOver`)

See [Automatic Strategy Switching](/guides/choosing-strategies/#automatic-strategy-switching) for full details on loop detection triggers, handoff context, and EventBus subscription examples.

### RequiredToolsConfig

```typescript
interface RequiredToolsConfig {
    /** Static list of tool names the agent MUST call before answering. */
    tools?: string[]
    /** Enable adaptive inference — LLM analyzes task + tools to determine required tools. */
    adaptive?: boolean
    /** Number of retry loops if required tools are missed (default: 2). */
    maxRetries?: number
}
```

**Examples:**

<!-- docs-skip-typecheck -->
```typescript
// Static required tools — agent must call web-search before answering
.withRequiredTools({ tools: ["web-search"] })

// Adaptive inference — LLM determines which tools are required per-task
.withRequiredTools({ adaptive: true })

// Both — static list as baseline, adaptive for additional inference
.withRequiredTools({ tools: ["web-search"], adaptive: true, maxRetries: 3 })
```

When `adaptive: true`, the framework calls the LLM with the task description and available tool schemas to infer which tools are required. The inferred list is merged with any static `tools` list. A hallucination guard ensures only actual tool names are included.
