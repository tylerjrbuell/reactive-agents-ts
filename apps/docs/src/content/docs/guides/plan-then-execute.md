---
title: Plan Review with agent.plan()
stability: experimental
description: >-
  Ask an agent for a plan first, review or edit it, then execute it. The plan is
  a typed object backed by the agent's checklist, and it works with no UI.
sidebar:
  order: 28
topic: reasoning
since: "0.19"
related:
  - guides/choosing-strategies
  - guides/reasoning
---

> **Not the `plan-execute-reflect` strategy.** This page covers `agent.plan()` and `agent.execute(plan)`, an experimental way to review a plan before it runs. The `plan-execute-reflect` reasoning strategy is a different feature: see [Choosing a Strategy](/guides/choosing-strategies/).

Some tasks deserve a look before they run. `agent.plan(input)` reasons through
the task **without running any capability tool** and returns a `Plan`: a goal and
an ordered list of steps. You can show it, edit it, store it, and then run it with
`agent.execute(plan)`. The run starts from that list and the result reports which
steps got done.

```ts
import { ReactiveAgents } from "reactive-agents"

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withTools({ builtins: true })
  .build()

const plan = await agent.plan("Audit the repo for unused exports and write a summary")
console.log(plan.steps) // [{ id: "1", title: "...", tool: "file-read", status: "pending" }, ...]

const result = await agent.execute(plan)
console.log(result.plan.steps) // same steps, each now "done", "in-progress" or "pending"
```

## What a plan is

A `Plan` is `{ id, goal, steps, createdAt, source }`. Each step is `{ id, title, tool?, dependsOn?, args?, status }`. `dependsOn` lists the ids of steps that must finish first; `args` holds the tool arguments. Both survive the Markdown, JSON and HTML exports. Importing a plan whose `dependsOn` names an unknown step, itself, or forms a cycle fails with a `PlanParseError`. Status is `"pending"`, `"in-progress"`, `"done"` or `"skipped"`. `source` says who wrote it: `"model"` (the model recorded it with the `todo` tool), `"harness-derived"` (the harness read the steps out of the model's reply) or `"user-edited"`.

A plan is the agent's advisory checklist, not a second store. A step that names a tool in its title as `tool: file-read` gets `tool: "file-read"`. The types, `isPlanEmpty`, `planFromChecklist` and `planToChecklistSeed` come from `@reactive-agents/core`.

## `agent.plan(input, options?)`

Runs the task under **plan posture**. Only the planning tools are offered: `todo` (when the agent has it), `brief` and `final-answer`. Every capability tool is refused, so a plan run never writes, fetches or executes anything.

The returned plan always has steps. If the model records a `todo` list, that list is the plan. If it only writes the plan as prose, the harness reads the numbered or bulleted step lines from the reply and records them (`source: "harness-derived"`, step ids `"1"` to `"n"`). If the reply holds no steps at all, `plan()` rejects with `PlanNoStepsError`, which carries the `goal` and the `reply`.

To let the model record the list itself, add the `todo` meta tool: `.withMetaTools({ todo: true })`. It is not required.

Once a plan is recorded, `todo add` calls that only restate existing rows (the same step in other words) are not appended. The model gets the existing list and the line "A plan is already recorded (N steps). Edit or remove rows instead of adding rephrased ones, or finish."; genuinely new steps in the same call are still added. Plan posture also caps `todo` edits at 3 per turn. Each intervention publishes a `plan-todo-churn` guard event.

`options` takes `history` and `origin`, the same as `run()`. A `PlanRecorded` event is published on the agent's EventBus.

## `agent.execute(plan, options?)` and `agent.run(input, { plan })`

Both run the task seeded from the plan's checklist. While a step is still unchecked, one advisory line tells the model to work the list: take the next unchecked step, mark it done with `todo`, and revise the list if reality differs. It never blocks completion.

- `agent.execute(plan)` runs `plan.goal`.
- `agent.run(input, { plan })` runs your own `input` against the plan.

The result is the normal `AgentResult` plus `result.plan`: the plan with each step's final status. `PlanStepStatusChanged` is published for every step whose status changed. A steps list the model rewrote mid-run is reported as it ended.

A run with no plan, or with an empty plan, is identical to a run today. `execute()` of an empty plan runs the goal with no seed.

## Running a plan in a strategy

The plan is one artifact; the executor is a choice. `agent.execute(plan, { strategy? })` and `agent.run(input, { plan })` pick it from the plan and the strategy setting:

| Plan and setting | Executor |
| --- | --- |
| `strategy: "blueprint"` or `"plan-execute-reflect"` in the options | that strategy adopts your plan instead of planning |
| The agent's own strategy is `blueprint` or `plan-execute-reflect` | the same, with no option needed |
| Some step has `dependsOn` or `args` (an executable DAG) | `blueprint`: the steps run as a 0-LLM DAG, then one solve call |
| Free steps (titles, optional `tool` hints) | the ReAct loop with the plan seeded as its checklist, as before |

```ts
const plan = await agent.plan("Compare the two reports")
const [first, second, ...rest] = plan.steps
const edited = {
  ...plan,
  source: "user-edited" as const,
  steps: [first, { ...second, dependsOn: [first.id], args: { path: "b.md" } }, ...rest], // add a dependency and a tool argument
}

const result = await agent.execute(edited) // runs in blueprint (rich plan)
result.plan.steps // each step "done", "skipped", "in-progress" or "pending"
```

`result.plan` is the plan the strategy ended with (its steps may have been repaired or extended), keeping your plan's `id`, `goal` and `source`. A tool hint alone does not make a plan rich: `blueprint` needs `args` to call a tool without a model.

A plan that cannot run fails before any run starts, with `PlanInvalidError` (exported from `@reactive-agents/runtime`): it is not a valid `Plan`, or its `dependsOn` names an unknown step, itself, or forms a cycle. `error.reason` says which.

The seeded-plan loop has two harness kill switches, both on by default: `autoTick` marks a step done when its hinted tool just succeeded, and `bookkeepingRefund` stops a `todo`-only round from using up `maxIterations` (at most half the budget is refunded). Turn them off with `.withHarness({ autoTick: false, bookkeepingRefund: false })` or `RA_AUTO_TICK=0` / `RA_BOOKKEEPING_REFUND=0`. The run-started config records both.

## Chat sessions

Sessions already have a mode (`session.setMode("plan" | "execute")`). The same plan is there as well:

```ts
const session = agent.session()
session.setMode("plan")
for await (const e of session.runStream("Migrate the build to bun", { density: "full" })) { /* render */ }

session.plan // Plan | undefined, built from the conversation's to-do list
session.setPlan(["Read the config", { title: "Rewrite scripts", tool: "file-write" }])

session.setMode("execute")
for await (const e of session.runStream("go", { density: "full" })) { /* seeded from the edited plan */ }
```

`session.plan` reads the conversation's to-do list as a `Plan`. `session.setPlan(planOrSteps)` replaces the list (steps may be plain titles) and publishes `PlanRecorded` with `source: "user-edited"`. The next execute turn starts from it. Plan turns carry their list to the next turn through both streamed (`session.runStream`) and buffered (`session.chat`) tool turns. `session.plan.source` is `"harness-derived"` when the harness derived the rows from the model's reply, and each row keeps its `tool` hint.

## Plan tool catalog

Plan posture names the tools execution will have, by name (MCP tools grouped by server), so steps can say `tool: name`. A step's tool hint rides the plan into the seeded checklist, so the execute run can tell when a step's named tool has succeeded. It is on by default; the 2026-11-16 ablation measured no lift and no harm (+5.6 and +11.1pp on two local models, within noise, at roughly 8 to 11% more billed tokens). Turn it off with the harness config or the environment:

```ts
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withHarness({ planToolCatalog: false }) // or RA_PLAN_TOOL_CATALOG=0
  .build()
```

## Plan-sized iteration budget

A run seeded from a plan gets enough iterations to finish it. The configured `maxIterations` is the floor. When the unchecked steps plus a reserve of max(2, 25%) need more, the plan-sized target is steps + reserve, at most min(60, 3x the configured value). The raise is staged: the run starts with half of the way to the target (for 18 open steps and `maxIterations` 10: 17, target 23). Near that bound the rest is granted only if the run made progress since the raise (a checklist row completed or a tool step succeeded). A run that stalls ends at the first stage instead of spending the whole budget. Bookkeeping refunds are counted on top, and the total never passes the hard cap. Unseeded runs, and plans that already fit, are unchanged. Cost, token and time limits are not touched. The raise is recorded as a `plan-budget` signal (and a `plan_budget_raised` guard event with `stage` 1 or 2) and the `planBudget` mechanism appears in the run-started config. It is opt-in (off by default) because it raises token use without a measured gain in task success. Turn it on with the harness config or the environment:

```ts
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withHarness({ planBudget: true }) // or RA_PLAN_BUDGET=1
  .build()
```

## Questions and recon

Plan posture can do two things beyond writing steps.

**Questions.** When user interaction is wired (`.withUserInteraction()`), a plan turn is offered `request_user_input`. The model is told to ask only when the answer changes the plan, to batch its questions, and never to ask what recon or the conversation can answer. The answer resumes the same planning run. This works for `agent.plan()` and plan-mode sessions. Without interaction the tool is not offered.

**Recon.** Opt-in, off by default: `.withHarness({ planRecon: true })` (or `RA_PLAN_RECON=1`; config wins) lets a plan turn call tools whose effect is `read` to look up facts the plan needs, such as an id from a list call. Recon is bounded: 6 calls per run, 2 per tool. When it is spent, or on the last iteration, only `todo` and `final-answer` stay offered so the plan reply is produced. The run-started config records the effective `planRecon` value.

A tool's effect comes from what it declares, never from its name:

| Tool | Effect |
| --- | --- |
| `mutatesExternalState: false` and no approval needed | `read` (recon may call it) |
| `mutatesExternalState: true` | `write` |
| nothing declared, or read-only but approval-gated | `unknown` (never in recon) |

An MCP tool's `readOnlyHint` counts as `read` only when you trust the server's annotations: set `trustAnnotations: true` on the server config, or list the tool under `readOnly: [...]`. A destructive or `readOnlyHint: false` hint maps to `write`. Untrusted or missing hints stay `unknown`.

### Findings

Each successful recon result becomes a finding on the plan: `{ id, tool, summary, at }`.

```ts
const plan = await agent.plan("Report on my site")
plan.findings // [{ id: "f1", tool: "site-list", summary: "site-42 (main)", at: 1731780000000 }]

await agent.execute(plan) // the execute run is shown the findings once, as context
```

`PlanRecorded` carries `findings`, and the Markdown, JSON and HTML plan formats include them. A plan with findings but no steps is still empty: findings never make a plan executable. `result.plan` keeps the findings, and a user-edited plan keeps them too. In a session, `session.plan.findings` holds what plan turns found and they seed later turns. `session.setPlan(steps)` keeps the held findings; `session.setPlan(plan)` takes the findings that plan states. To rebuild a session from stored state, pass `agent.session({ initialTodo, initialPlanFindings })`: the findings come back on `session.plan` and ride the next execute turn. Malformed rows are dropped.

## Strategy planners: one context, one completion rule

The `blueprint` and `plan-execute-reflect` strategies write their own plans (generate, patch and augment). Every one of those planner calls is built from the same context: plan only (never run the steps or answer), the tool catalog with each tool's parameters and its read or write effect, and the env date and timezone. The date rule appears when a tool takes a date: a date argument must come from the goal or from today's date, never invented. The interaction line appears only when the planner may ask or look something up.

A command-running tool (`shell-execute` with `terminal: true`) also lists its allowed executables in the catalog: which are on the host's PATH (checked without spawning a process), which are allowed but not installed, and which are not enabled. With a Docker sandbox the PATH split is skipped, because the container's PATH is not the host's. The planner is told not to plan a step only to check that a tool or command exists, so it no longer plans `gh --version` just to confirm shell access. Plan posture lists the same commands in its `Execute-phase tools:` line; `shell-execute` is plannable by name there but still not callable in the plan turn. See the [Tools guide](/guides/tools/) for the command policy.

The plan's tool-call arguments are checked at plan time, against the tool schemas, before anything runs:

| Finding | What the plan does |
| --- | --- |
| a step names a tool the catalog does not have | reported (`blueprint` then degrades to reactive, as before) |
| a required argument has no value and no `{{from_step}}` reference | the step runs as a composite step: the model chooses the argument when the step runs |
| a date in a date argument that the goal does not give (for example a baked `2024-11-21` on a 2026 run) | same: deferred to execute time, never baked. A relative phrase the goal used (`tomorrow`) is resolved against the env date instead |
| a step typed `analysis` that names a tool | becomes a composite step scoped to that tool, so the tool can run |

One `plan-args-validated` guard event lists the findings. A plan you pass yourself (`run(input, { plan })`) keeps its dates; only missing required arguments are deferred.

A strategy run cannot finish `completed` with plan steps left open. Each step ends `done`, `skipped` or `failed`, listed in `result.metadata.planSteps`. A step that never ran (a deferred composite step, a tool named on an analysis step) is finished by the step executor before the answer is written. A step the run budget no longer allows stays open: the run is `partial`, `result.metadata.planIncomplete.open` names it, the verification warning says so, and a `plan-incomplete` guard event is published. In `plan-execute-reflect` a SATISFIED reflection on a plan with unrun steps sends the loop back to run them while refinements remain.

When the step results are too long for the final synthesis call, the steps most relevant to the goal are kept whole within the model's evidence budget, the rest are named as not shown, and a `solve-evidence` guard event records what the call saw (steps, characters, budget).

### Handing a plan to a strategy

`ReasoningService.execute` takes an optional `plan` (the portable core plan or the strategy plan). `blueprint` and `plan-execute-reflect` adopt it instead of calling the planner, after checking it (empty plan, unknown `dependsOn` id, self reference or cycle fail with an `ExecutionError` before any call). `adaptive` forwards it, and when its pick would not adopt a plan (reactive, reflexion, tree-of-thought) it runs `plan-execute-reflect` instead. Other strategies ignore it.

The plan the run ended with comes back in core shape in `result.metadata.extensions.plan`, each step carrying its final status (`done`, `skipped`, `in-progress`, `pending`; a `failed` step reads `skipped`, core has no failed state). A plan you supplied keeps its `source`.

### Plan only

`ReasoningService.execute({ ..., planOnly: true })` makes `blueprint` and `plan-execute-reflect` stop once the plan exists. It is the planner without the run: the planner call (or none, for a supplied `plan`), the deterministic plan repair, plan-time argument grounding and, in `blueprint`, VERIFY. No tool runs, and no solve or synthesis call is made. `adaptive` routes a plan-only run to one of the two (a pick of reactive, reflexion or tree-of-thought becomes `plan-execute-reflect`) and never falls back to reactive, since the plan-only result is `partial` by design. Any other strategy fails with an `ExecutionError` rather than running the task.

The result is `status: "partial"` with `output: null`, `metadata.planOnly: true`, `metadata.rawTerminatedBy: "plan-only"` and the plan in `metadata.extensions.plan` (core shape, every step `pending`). It does not raise `plan-incomplete`: that rule judges a plan the run set out to execute. In `blueprint`, a plan VERIFY rejects is returned too, with the reasons in `metadata.verificationWarning`, instead of degrading to reactive (which would run tools).

## Wrap-up reserve

Opt-in, off by default: set `.withHarness({ wrapUpReserve: true })` (or `RA_WRAPUP_RESERVE=1`; config wins) to hold back the last iterations of a run for the answer. The run-started config records the effective `wrapUpReserve` value. When the reserve takes the last think call it publishes a `wrap_up_reserve` guard event (the budget answer turn publishes `budget_answer_turn`), so a trace shows whether it fired.

## Auto-tick and bookkeeping refund

Two behaviors of a plan-seeded run are on by default and can be switched off, for example to measure them. Auto-tick marks a step done when its tool hint names a tool that just succeeded and no other open step names it. The bookkeeping refund does not count a todo-only round (or, with `planRecon`, a recon-only round) against `maxIterations`, at most half the budget; each refund publishes a `bookkeeping_refund` guard event.

The switches are the reasoning package's harness config keys `autoTick` and `bookkeepingRefund` (config wins over the environment), or `RA_AUTO_TICK=0` and `RA_BOOKKEEPING_REFUND=0`. The builder's `.withHarness()` does not accept them yet.

## Events

| Event | When |
| --- | --- |
| `PlanRecorded { planId, steps, source, findings? }` | `agent.plan()` returned a plan, or `session.setPlan()` edited one |
| `PlanStepStatusChanged { planId, stepId, from, to }` | a step's status changed during `execute()` / `run({ plan })`, or during a chat session turn (then carries `sessionId`) |
| `ChatModeChanged` | a session switched between plan and execute |
