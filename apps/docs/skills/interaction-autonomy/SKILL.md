---
name: interaction-autonomy
description: Control agent autonomy with durable human-in-the-loop approval gates, agent-initiated user-input pauses, and runtime pause/resume/stop controls.
compatibility: Reactive Agents TypeScript projects using @reactive-agents/*
metadata:
  author: reactive-agents
  version: "2.0"
  tier: "capability"
---

# Interaction and Autonomy

## Agent objective

Produce a builder that inserts human oversight into an otherwise autonomous run — pausing for approval before risky tool calls, letting the agent ask the human a question mid-run, or exposing runtime pause/resume/stop controls.

## When to load this skill

- Requiring human approval before certain tool calls (file writes, sends, code execution)
- Letting the agent pause and ask the human for a decision, form, or confirmation
- Building a supervised deployment where a run can be reviewed and approved from another process
- Needing runtime pause/resume/stop controls on an in-flight run

## How autonomy is controlled

There is no single "mode" switch. Autonomy is shaped by three independent, opt-in mechanisms:

| Mechanism | Builder method | What it does |
|-----------|----------------|--------------|
| Approval gates | `.withApprovalPolicy({ mode: "detach" })` (+ `.withDurableRuns()` optional) | Named tool calls wait for human approve/deny |
| Agent-initiated input | `.withUserInteraction()` (+ `.withDurableRuns()` optional) | The agent can call `request_user_input` to ask the human |
| Runtime control | `.withKillSwitch()` | In-process `pause()` / `resume()` / `stop()` / `terminate()` on the run handle |

Approval gates and agent questions both wait **live** by default: the run blocks in process until `approveRun`/`denyRun`/`respondToInteraction` answers, then the same run continues. Add `.withDurableRuns()` when the answer may come from another process or must survive a crash: the run then pauses and the pause persists to a run store.

## Implementation baseline — durable approval gate

```ts
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withName("assistant")
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "plan-execute-reflect", maxIterations: 20 })
  .withTools({ allowedTools: ["web-search", "file-read", "file-write"] })
  .withDurableRuns()                                 // optional for approvals: pauses survive restarts
  .withApprovalPolicy({
    tools: ["file-write"],                           // these calls wait for human approval
    mode: "detach",                                  // a person decides (durable pause here; live wait without durable runs)
  })
  .build();
```

## Key patterns

### Approval gates

Name the tool calls that must pause. When the agent tries to call one, the run pauses and returns control:

```ts
.withApprovalPolicy({
  tools: ["file-write", "send-email"],               // pause before any of these
  requireFor: (ctx) => ctx.iteration > 5,            // or gate by a predicate
  mode: "detach",                                    // "detach" = a person decides, "block" = onApprove decides
})
```

Note: tools whose definition declares `requiresApproval: true` (built-ins like `code-execute` / `file-write`, and the `shell-execute` terminal tool) are folded in automatically once any approval policy is configured — you do not have to list them by hand.

Gate shell calls by command with `commands`. A rule is a word prefix of a command segment (`"git push"` matches `git push origin main`; a bare `"*"` matches nothing). With the read-only `git` preset, a matched write asks for approval instead of being refused:

```ts
.withTools({ builtins: ["git"], workspace: repoDir })
.withApprovalPolicy({
  commands: ["git push"],                            // asks before any `git push ...`
  onApprove: ({ args }) => askHuman(args),           // block mode; no onApprove = refused
})
```

An approved push still needs credentials the sandboxed shell does not have (no credential helper, no SSH keys or agent), so only pushes to a local path or an unauthenticated remote succeed.

#### Resolving a paused run

A paused run returns `status: "awaiting-approval"` with a `pendingApproval` descriptor. Approve or deny it — from this process or any other with access to the run store:

```ts
const result = await agent.run("Refactor and save utils.ts");

if (result.status === "awaiting-approval" && result.pendingApproval) {
  const { runId } = result.pendingApproval;
  // ...human reviews the pending action...
  const final = await agent.approveRun(runId);       // resumes and runs to completion
  // or: await agent.denyRun(runId, "not allowed to touch that file");
}

// List everything currently awaiting approval (e.g. for an inbox UI):
const pending = await agent.listPendingApprovals();
```

#### Same-process convenience

To handle the pause→decide→resume loop in one call, pass an `onApproval` callback — `run()` returns the FINAL result and you never touch the runId:

```ts
const result = await agent.run("Refactor and save utils.ts", {
  onApproval: (pending) => {
    // pending = { runId, gateId, toolName, args }
    return pending.toolName === "file-write" && isSafePath(pending.args);
    // return a boolean, or { approve, reason }
  },
});
```

### Agent-initiated user input

`.withUserInteraction()` lets the model call the `request_user_input` tool to ask the human for a form, choice, or confirmation.

Live (no durable store): the run waits, the stream shows `InteractionRequested`, and the answer becomes the tool result of the same run:

```ts
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withUserInteraction({ timeoutMs: 120_000 })      // optional: unanswered -> the model reads "did not answer"
  .build();

for await (const event of agent.runStream("Set up the deployment config")) {
  if (event._tag === "InteractionRequested") {
    // event.kind / event.prompt / event.schema describe the question
    void agent.respondToInteraction(event.runId, event.interactionId, { region: "us-east-1" });
  }
}
```

Durable: add `.withDurableRuns()` and the run pauses `awaiting-interaction` instead; answer from any process:

```ts
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "plan-execute-reflect", maxIterations: 20 })
  .withDurableRuns()
  .withUserInteraction()
  .withSystemPrompt(`
    When a decision genuinely needs the user (ambiguous requirements, a
    destructive choice), call request_user_input rather than guessing.
  `)
  .build();

const result = await agent.run("Set up the deployment config");

if (result.status === "awaiting-interaction" && result.pendingInteraction) {
  const { runId, interactionId } = result.pendingInteraction;
  // ...collect the human's answer...
  const final = await agent.respondToInteraction(runId, interactionId, { region: "us-east-1" });
}

// List runs awaiting a human response:
const waiting = await agent.listPendingInteractions();
```

### Runtime pause/resume/stop (kill switch)

For in-process control over an in-flight run — independent of the durable rails above:

```ts
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withKillSwitch()  // enables pause/resume/stop/terminate on the run handle
  .build();

const handle = agent.run("Do a long task...");

await handle.pause();     // graceful pause (waits for current phase)
await handle.resume();    // resume from paused state
await handle.stop("cancelled by user");   // graceful stop
await handle.terminate("emergency shutdown"); // immediate termination
```

Kill switch controls are no-ops if `.withKillSwitch()` was not called during build.

## Builder API reference

| Method | Notes |
|--------|-------|
| `.withDurableRuns(opts?)` | Required for durable approval/interaction pauses; persists run state to a store |
| `.withApprovalPolicy(cfg)` | Gate named tool calls, shell commands (`commands`), or a predicate behind human approval; `timeoutMs` denies an unanswered wait |
| `.withUserInteraction(opts?)` | Enable agent-initiated `request_user_input` (live wait, or a durable pause with `.withDurableRuns()`); `timeoutMs` bounds a live wait |
| `.withKillSwitch()` | In-process pause/resume/stop/terminate on the run handle |

### Runtime methods (durable HITL)

| Method | Notes |
|--------|-------|
| `agent.approveRun(runId, opts?)` | Approve a paused run and resume to completion |
| `agent.denyRun(runId, reason)` | Deny a paused run |
| `agent.listPendingApprovals()` | Runs currently awaiting approval |
| `agent.respondToInteraction(runId, interactionId, value)` | Answer an agent-initiated `request_user_input` and resume |
| `agent.listPendingInteractions()` | Runs currently awaiting a human response |

## Pitfalls

- `.withApprovalPolicy({ mode: "detach" })` does NOT need `.withDurableRuns()`: without it the run waits live in process (`runStream()` emits `ApprovalRequested` and stays open) until `approveRun`/`denyRun` or `run(task, { onApproval })` answers. Add `.withDurableRuns()` only when the answer comes from another process or must survive a restart
- With `mode: "detach"` + `.withDurableRuns()`, a gated run returns `status: "awaiting-approval"` and does NOT block — you must call `approveRun`/`denyRun` (or pass an `onApproval` callback) to finish it
- `mode: "block"` decides in code via `onApprove` (no person in the loop); with no `onApprove` every gated call is refused
- `.withUserInteraction()` does NOT need `.withDurableRuns()`: without it a question waits live. Without `timeoutMs` that wait lasts until answered, stopped or terminated; an unanswered question (timeout, `stop()`) reaches the model as "The user did not answer: <reason>" and the run continues
- Kill switch controls (`pause`, `resume`, `stop`, `terminate`) are no-ops without `.withKillSwitch()` — no error is thrown, calls are silently ignored
- `request_user_input` only fires if the model chooses to call it — reinforce in the system prompt when it should ask rather than guess
- `denyRun` requires a reason string; `approveRun` takes an optional `{ reason }`
