---
title: Workspace-Scoped Coding Agent
description: >-
  Point an agent at one project directory, let it load that project's skills,
  cap risky tools, and override the workspace for a single run.
sidebar:
  order: 20
---

A coding agent needs three things: a root it cannot escape, the project's own instructions, and limits on the tools that touch the outside world. In v0.18 these are all per-run, so one agent instance can work on several projects without leaking state between them.

## Scope the agent to a project

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTools({
    builtins: ["file-read", "file-edit", "grep", "list-directory"],
    workspace: "/home/me/projects/billing-api",   // must be an existing directory
    maxCallsPerTool: { "file-edit": 20, grep: 40 },
    riskLevels: { grep: "low" },                  // lets the text parser bind embedded grep calls
  })
  .withSkills()                                   // no paths: discovers the workspace's skills
  .build();

const result = await agent.run("Find where invoices are rounded and fix the off-by-one");
console.log(result.output);

await agent.dispose();
```

What this gives you:

- **File tools stay inside `workspace`.** Relative paths resolve against it, and paths outside it are refused.
- **Skills come from the project.** `.withSkills()` with no arguments loads `<workspace>/.agents/skills`, `<workspace>/.<agentId>/skills`, and `<workspace>/.claude/skills`. The agent sees the project's own conventions. User-global skills (`~/.agents/skills`) load only with `.withSkills({ global: true })`.
- **Caps bound the damage.** `file-edit` runs at most 20 times in the run, however the model splits its calls across turns.

## Switch projects per run

The workspace is a run option. Override it without building a second agent:

```typescript
await agent.run("Add retry logic to the webhook sender", {
  workspace: "/home/me/projects/notifications",
});
```

Precedence is: the run option, then `.withTools({ workspace })`, then an ambient `withFileRoot()`. The skills for that run are discovered from the run's workspace, so the second project's `.agents/skills` apply to that run only.

## Load a skill mid-run

Skills in the catalog are not all injected up front. The agent can call `activate-skill` to load one when the task needs it. A skill loaded this way is kept through context compaction, so it does not fall out of the conversation on long runs.

## Durable version

Add `.withDurableRuns()` to make the run resumable. Any file edit that succeeded before a crash is recorded as a tool effect and is not re-applied on resume. See [Durable Execution](/guides/durable-execution/#tool-effects-are-recorded).
