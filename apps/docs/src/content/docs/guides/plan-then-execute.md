---
title: Plan Then Execute
stability: experimental
description: >-
  Ask an agent for a plan first, review or edit it, then execute it. The plan is
  a typed object backed by the agent's checklist, and it works with no UI.
sidebar:
  order: 28
---

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
  .withTools()
  .build()

const plan = await agent.plan("Audit the repo for unused exports and write a summary")
console.log(plan.steps) // [{ id: "1", title: "...", tool: "file-read", status: "pending" }, ...]

const result = await agent.execute(plan)
console.log(result.plan.steps) // same steps, each now "done", "in-progress" or "pending"
```

## What a plan is

A `Plan` is `{ id, goal, steps, createdAt, source }`. Each step is `{ id, title, tool?, status }` with status `"pending"`, `"in-progress"`, `"done"` or `"skipped"`. `source` says who wrote it: `"model"` (the model recorded it with the `todo` tool), `"harness-derived"` (the harness read the steps out of the model's reply) or `"user-edited"`.

A plan is the agent's advisory checklist, not a second store. A step that names a tool in its title as `tool: file-read` gets `tool: "file-read"`. The types, `isPlanEmpty`, `planFromChecklist` and `planToChecklistSeed` come from `@reactive-agents/core`.

## `agent.plan(input, options?)`

Runs the task under **plan posture**. Only the planning tools are offered: `todo` (when the agent has it), `brief` and `final-answer`. Every capability tool is refused, so a plan run never writes, fetches or executes anything.

The returned plan always has steps. If the model records a `todo` list, that list is the plan. If it only writes the plan as prose, the harness reads the numbered or bulleted step lines from the reply and records them (`source: "harness-derived"`, step ids `"1"` to `"n"`). If the reply holds no steps at all, `plan()` rejects with `PlanNoStepsError`, which carries the `goal` and the `reply`.

To let the model record the list itself, add the `todo` meta tool: `.withMetaTools({ todo: true })`. It is not required.

`options` takes `history` and `origin`, the same as `run()`. A `PlanRecorded` event is published on the agent's EventBus.

## `agent.execute(plan, options?)` and `agent.run(input, { plan })`

Both run the task seeded from the plan's checklist. While a step is still unchecked, one advisory line tells the model to work the list: take the next unchecked step, mark it done with `todo`, and revise the list if reality differs. It never blocks completion.

- `agent.execute(plan)` runs `plan.goal`.
- `agent.run(input, { plan })` runs your own `input` against the plan.

The result is the normal `AgentResult` plus `result.plan`: the plan with each step's final status. `PlanStepStatusChanged` is published for every step whose status changed. A steps list the model rewrote mid-run is reported as it ended.

A run with no plan, or with an empty plan, is identical to a run today. `execute()` of an empty plan runs the goal with no seed.

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

Plan posture names the tools execution will have, by name (MCP tools grouped by server), so steps can say `tool: name`. A step's tool hint rides the plan into the seeded checklist, so the execute run can tell when a step's named tool has succeeded. It is on by default; the ablation is still pending. Turn it off with the harness config or the environment:

```ts
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withHarness({ planToolCatalog: false }) // or RA_PLAN_TOOL_CATALOG=0
  .build()
```

## Events

| Event | When |
| --- | --- |
| `PlanRecorded { planId, steps, source }` | `agent.plan()` returned a plan, or `session.setPlan()` edited one |
| `PlanStepStatusChanged { planId, stepId, from, to }` | a step's status changed during `execute()` / `run({ plan })`, or during a chat session turn (then carries `sessionId`) |
| `ChatModeChanged` | a session switched between plan and execute |
