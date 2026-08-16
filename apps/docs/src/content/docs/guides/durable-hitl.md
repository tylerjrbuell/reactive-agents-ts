---
title: Durable Human-in-the-Loop
stability: experimental
description: >-
  Pause an agent on a high-risk tool call, persist it, and approve or deny from
  any process — approval gates that survive process death.
sidebar:
  order: 27
---

Some actions need a human's sign-off before they run — a shell command, a file
write, a payment. **Durable human-in-the-loop (HITL)** lets an agent *pause* on
those calls, persist the pause to disk, and hand control back so the process can
exit. A human then approves or denies from **any** process — a CLI, a web
dashboard, a different worker — and the run resumes from its checkpoint to
completion.

It is built on the same durable RunStore as [crash-resume](/guides/durable-execution/):
the decision and the paused checkpoint live in SQLite, so approve/deny works
across process and machine boundaries.

## Enabling it

`.withApprovalPolicy()` names which tool calls require approval. `mode: "detach"`
(the default once `.withDurableRuns()` is set) makes a gated call pause durably.

<!-- docs-skip-typecheck -->
```ts
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withModel({ provider: "anthropic", model: "claude-sonnet-4-6" })
  .withTools({ tools: [/* ... */] })
  .withDurableRuns()
  .withApprovalPolicy({
    tools: ["shell-execution", "file-write"], // names that must pause
    mode: "detach",                           // durable pause (default with durable runs)
  })
  .build();
```

You can also gate by predicate instead of (or in addition to) a name list:

<!-- docs-skip-typecheck -->
```ts
.withApprovalPolicy({
  requireFor: ({ toolName, iteration }) => toolName.startsWith("delete-") || iteration > 10,
  mode: "detach",
})
```

> `mode: "detach"` requires `.withDurableRuns()` — a detached pause needs a
> durable store to persist it. `build()` throws if it is missing. Use
> `mode: "block"` for the in-process approval gate (no durable pause).

## Block mode (no durable store)

`mode: "block"` is the default whenever `.withDurableRuns()` is not set — the
common case if you haven't opted into crash-resume. A gated call is decided
**in process**, synchronously, with no pause/resume round trip:

```ts
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withModel("claude-sonnet-4-6")
  .withApprovalPolicy({
    tools: ["shell-execution", "file-write"],
    mode: "block",
    onApprove: async ({ toolName, args, iteration }) => {
      // Your approval UI/logic here, e.g. a Slack prompt, a CLI confirm, a policy check.
      return true;
    },
  })
  .build();
```

`onApprove` returns `boolean | { approve, reason }`, sync or async. A
throw/rejection denies (fail-closed).

> **Deny-by-default.** A gated call in block mode with no `onApprove` supplied
> is **refused** — the tool does not run, and the agent's loop sees the
> refusal rather than the tool's result. Earlier versions treated `"block"` as
> inert (nothing read it, so gated tools ran unattended); if you rely on that
> behavior, add `onApprove`, or switch to `mode: "detach"` +
> `.withDurableRuns()` for a real durable pause.
>
> A sub-agent (`.withAgentTool()` / `.withDynamicSubAgents()`) always runs in
> block mode and inherits the parent's `onApprove` — it has no durable store
> of its own, so it cannot pause for cross-process approval.

## Pausing

When the agent hits a gated call, the run pauses durably and hands control back.
Use whichever entrypoint you already use — `run()` or `runStream()`.

With **`run()`** the result carries `status: "awaiting-approval"` and a
`pendingApproval` descriptor:

```ts
const result = await agent.run("clean up the temp files");
if (result.status === "awaiting-approval") {
  const { runId, toolName, args } = result.pendingApproval!;
  // The process can now exit. The pause is persisted under runId.
}
```

With **`runStream()`** the terminal event carries the same `pendingApproval`:

```ts
for await (const event of agent.runStream("clean up the temp files")) {
  if (event._tag === "StreamCompleted" && event.pendingApproval) {
    const { runId, toolName, args } = event.pendingApproval;
  }
}
```

### Same-process convenience: `onApproval`

For interactive/CLI use, pass an `onApproval` callback — `run()` drives the whole
pause → decide → resume loop in one call and returns the **final** result. You
never touch the runId:

```ts
const result = await agent.run("clean up the temp files", {
  onApproval: async ({ toolName, args }) => {
    // return true to approve, false to deny, or { approve, reason }
    return confirm(`Run ${toolName}(${JSON.stringify(args)})?`);
  },
});
```

## Approving or denying — from any process

A fresh process (or the same one) lists what is waiting and decides:

```ts
const waiting = await agent.listPendingApprovals();
// → [{ runId, gateId, toolName, args, task, updatedAt }]  (empty if nothing is paused)

const next = waiting[0];
if (next) {
  // Approve → the agent executes the gated call, then runs to completion:
  const result = await agent.approveRun(next.runId);

  // Deny → the agent observes the denial and continues WITHOUT running the call:
  // await agent.denyRun(next.runId, "not allowed in production");
}
```

`approveRun` resumes from the exact checkpoint and executes **the same call the
human reviewed** — no fresh LLM step is taken for the gated action, so what is
approved is what runs. `denyRun` injects the denial as an observation and lets the
agent react on the next step.

Calling `approveRun`/`denyRun` on a run with no pending approval throws
`ApprovalStateError` (already decided, completed, or never paused).

## Lifecycle

```
run() / runStream() ──▶ gated call ──▶ status: awaiting-approval ──▶ process may exit
                                              │
                  approveRun / denyRun  ◀──────┘   (any process)
                         │
                         ▼
                  resume from checkpoint ──▶ status: completed
```

## Scope notes (v0.12)

- Durable pauses work on **both `run()` and `runStream()`**. `approveRun`/`denyRun`
  resume from the exact paused checkpoint; a re-pause on resume is persisted too
  (multi-gate). The `onApproval` callback is sugar over this loop for same-process use.
- Gate triggers are the explicit `tools` list and the `requireFor` predicate. The
  per-tool `requiresApproval` flag does not auto-feed the durable gate yet — list
  the tool names explicitly.
- One pending gate at a time: if a single step proposes several gated calls, the
  first pauses; the rest re-surface after the resume.

## Runnable example

A complete, runnable demo lives at
[`apps/examples/src/advanced/durable-hitl.ts`](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/apps/examples/src/advanced/durable-hitl.ts).
With a provider key it drives the real gate (pause → approve → deny); offline it
shows the policy wiring and the detach-requires-durable guard.

```bash
ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/advanced/durable-hitl.ts
```

## See also

- [Durable Execution](/guides/durable-execution/) — crash-resume, the foundation HITL builds on.
- [Builder API](/reference/builder-api/) — `withApprovalPolicy`, `approveRun`, `denyRun`, `listPendingApprovals`.
