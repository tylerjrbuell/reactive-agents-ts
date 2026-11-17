---
title: Human-in-the-Loop Approval
stability: experimental
description: >-
  Have a person approve or deny high-risk tool calls: live in process, or
  durably from any process with gates that survive process death.
sidebar:
  order: 27
topic: durable-runs
updated: "0.19"
related:
  - guides/durable-execution
  - features/process-model
  - guides/security-hardening
---

Some actions need a human's sign-off before they run — a shell command, a file
write, a payment. `.withApprovalPolicy({ mode: "detach" })` hands those calls to
a person, who answers with `agent.approveRun(runId)` / `agent.denyRun(runId,
reason)`. Where the run waits depends on whether you also turned on durable runs:

| | Without `.withDurableRuns()` (live) | With `.withDurableRuns()` (durable) |
| --- | --- | --- |
| The run while waiting | Stays alive in this process, blocked at the gate | Pauses; its checkpoint goes to SQLite; the process may exit |
| `runStream()` | Emits `ApprovalRequested`, stays open, continues after the answer | Ends with `StreamCompleted` + `pendingApproval` |
| `run()` | Waits; resolves when the run ends | Returns `status: "awaiting-approval"` |
| Who can answer | Code in the same process | Any process, even after a restart |
| `approveRun` resolves with | The run's final result | The resumed run's result |

**You need durable runs only when** the answer may come from another process
(a separate worker, a web server that does not own the run), or the wait must
survive a crash or restart. For an interactive app, a chat UI or a CLI where the
process that runs the agent also receives the human's answer, the live wait is
enough and needs no store.

The durable backend is built on the same RunStore as
[crash-resume](/guides/durable-execution/): the decision and the paused
checkpoint live in SQLite, so approve/deny works across process and machine
boundaries.

## Live approval (no durable store)

```ts
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTools({ builtins: ["file-write"] })
  .withApprovalPolicy({ tools: ["file-write"], mode: "detach" })
  .build();

for await (const event of agent.runStream("clean up the temp files")) {
  if (event._tag === "ApprovalRequested") {
    // Show event.toolName / event.args to the user, then answer.
    // Do not await here: approveRun resolves when the run ends,
    // and the run's events keep arriving on this stream meanwhile.
    void agent.approveRun(event.runId); // or agent.denyRun(event.runId, "not now")
  }
}
```

- `ApprovalRequested` arrives at both stream densities.
- `agent.listPendingApprovals()` lists live waits too, so a `run()` caller (no
  stream) can find them. `run(task, { onApproval })` answers them for you.
- Parallel sub-agents ask under the root run's id, so `approveRun(runId)` alone
  answers the oldest wait. Each pending item carries `gateId`, `subAgent`,
  `toolName` and `args`; pass `{ gateId }` to answer exactly one:
  `agent.approveRun(runId, { gateId })` / `agent.denyRun(runId, reason, { gateId })`.
- `handle.stop()` while waiting denies the call (the run then finishes);
  `handle.terminate()` cancels the run. Nothing stays pending either way.
- A live wait lives in the agent object: it is gone if the process exits. Use
  durable runs when that matters.
- An `onApprove` callback is ignored in `detach` mode (live or durable); use
  `mode: "block"` for a programmatic decider.
- `timeoutMs` bounds the wait: `.withApprovalPolicy({ tools, mode: "detach",
  timeoutMs: 60_000 })`. No decision in time denies the call, and the model
  reads why. It also bounds a `mode: "block"` `onApprove` callback that never
  settles. Without it a live wait lasts until answered, stopped or terminated.

## Asking the user a question (live)

`.withUserInteraction()` lets the model call `request_user_input` to ask for a
choice, a confirmation or a small form. It uses the same two backends as
approvals. Without `.withDurableRuns()` the question waits live and the same
run continues with the answer:

```ts
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withUserInteraction({ timeoutMs: 120_000 }) // optional wait bound
  .build();

for await (const event of agent.runStream("help me pick a plan")) {
  if (event._tag === "InteractionRequested") {
    // event.kind: "choice" | "confirmation" | "form"; event.prompt; event.schema
    void agent.respondToInteraction(event.runId, event.interactionId, "basic");
  }
}
```

- The answer becomes the tool result the model reads (`The user responded:
  "basic"`). With no answer in `timeoutMs`, or after `stop()`, the model reads
  `The user did not answer: <reason>` and the run continues.
- `agent.listPendingInteractions()` lists live questions too, so a `run()`
  caller can find and answer them.
- With `.withDurableRuns()` the run instead pauses `awaiting-interaction` and
  `respondToInteraction` resumes it from any process (no wait bound applies).

### Multi-part questions

The model can also pass `questions`: a list of typed questions in one call.
Each has `id`, `prompt`, `type` (`text`, `single-choice`, `multi-choice`,
`boolean`, `number`) and optional `options` (`{ label, value, description }`),
`required` (default true), `default`, `min`/`max`, `maxLength` and `allowOther`
(free text for a choice). The old `kind`/`prompt`/`schema` call still works.

A structured call puts the same list on `event.questions` (`InteractionRequested`)
and on each `listPendingInteractions()` entry; answer with an id-keyed map via
`respondToInteraction(runId, interactionId, { [questionId]: value })`. A
legacy call has no `questions`.

`@reactive-agents/tools` exports the pure helpers a host uses with it:
`parseRequest(args)` normalizes either shape, and `validateAnswers(request,
answers)` checks an answer map keyed by question id. It returns a typed result
(`status` of `answered`, `partial`, `skipped` or `timeout`, plus a per-question
status and value), or per-question errors (`RequiredMissing`, `NotInOptions`,
`OutOfRange`, `TooLong`, `WrongType`, `UnknownQuestion`) that the model reads to
correct itself. `timeoutAnswer(request)` builds the timeout result.

## Enabling it

`.withApprovalPolicy()` names which tool calls require approval. `mode: "detach"`
(the default once `.withDurableRuns()` is set) makes a gated call wait for a
person; with `.withDurableRuns()` the wait is a durable pause.
The data half of a policy (`mode`, `tools`, `commands`) has a declarative
`AgentConfig` key, `approvalPolicy`, and round-trips through `toConfig()`. The
`onApprove` / `requireFor` handlers are functions, not JSON, so supply them in
code; a stored block-mode policy with no `onApprove` refuses every gated call.

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

### Shell command rules

`commands` gates shell calls by what they run, not by tool name:

```ts
const gitAgent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withTools({ builtins: ["git"], workspace: process.cwd() })
  .withApprovalPolicy({
    commands: ["git push", "gh pr create"],
    onApprove: ({ args }) => {
      // Your approval UI here; `args.command` is the full command line.
      console.log("approve?", args);
      return false;
    },
  })
  .build();
```

- A rule is a word prefix. `"git push"` matches `git push origin main`, not
  `git pull`. A trailing `*` changes nothing (`"git push *"` = `"git push"`); a
  rule with no words, such as a bare `"*"`, matches nothing.
- The command is split into segments on `&&`, `||`, `;`, `|` and newlines. A
  call needs approval when any segment matches a rule. Leading `NAME=value`
  assignments and a bare `sudo` / `env` / `command` / `exec` / `nohup` are
  skipped, and `/usr/bin/git` counts as `git`. `git -C dir push` does not
  match `"git push"`; the read-only preset refuses it.
- Rules apply to `shell-execute` calls only (also under the removed
  `git-cli` / `gh-cli` names).
- The read-only `git` preset (`builtins: ["git"]`) normally refuses every
  git/gh write. With `commands`, the shell runs a refused write that matches a
  rule. It runs only after the approval gate let the call through: refused
  with no `onApprove` in block mode, paused in detach mode. Output redirects
  (`>`) stay refused.
- The shell gets the rules only from the approval policy. A
  `terminal.approvalCommands` set by hand is ignored.
- An approved `git push` still needs credentials, and the git preset passes
  git none: its config holds only your user name and email (no credential
  helper), and the shell's HOME is a sandbox directory with no SSH keys or
  agent socket. A push to an HTTPS or SSH remote that needs authentication
  fails; a push to a local path works. `gh` commands use your `gh` login
  (`GH_TOKEN` / `GITHUB_TOKEN` or the `gh` config directory).

> **Migration (2026-11):** `mode: "detach"` no longer requires
> `.withDurableRuns()`, and `build()` no longer throws without it. A detach
> policy on a non-durable agent now waits live in process (see
> [Live approval](#live-approval-no-durable-store)). Agents that already pair
> detach with durable runs behave as before.

## Block mode (decided in code)

`mode: "block"` is the default whenever no `mode` is given and
`.withDurableRuns()` is not set. A gated call is decided **in process** by your
`onApprove` callback, with no person in the loop and no pause/resume round trip:

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
> behavior, add `onApprove`, or switch to `mode: "detach"` to have a person
> decide (live, or durable with `.withDurableRuns()`).
>
> A sub-agent (`.withAgentTool()` / `.withDynamicSubAgents()`) always runs in
> block mode and inherits the parent's `onApprove` — it has no durable store
> of its own, so it cannot pause for cross-process approval.

## Pausing (durable)

With `.withDurableRuns()`, when the agent hits a gated call, the run pauses
durably and hands control back.
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

For interactive/CLI use, pass an `onApproval` callback — `run()` decides every
gated call through it and returns the **final** result, durable or live. You
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
`ApprovalStateError` (already decided, completed, or never paused). A run
waiting live in this process is always answered first; the durable store is
checked only when no live run matches.

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
shows the policy wiring.

```bash
ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/advanced/durable-hitl.ts
```

## See also

- [Durable Execution](/guides/durable-execution/) — crash-resume, the foundation HITL builds on.
- [Builder API](/reference/builder-api/) — `withApprovalPolicy`, `approveRun`, `denyRun`, `listPendingApprovals`.
