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
| Approval gates | `.withApprovalPolicy()` + `.withDurableRuns()` | Named tool calls pause the run for human approve/deny |
| Agent-initiated input | `.withUserInteraction()` + `.withDurableRuns()` | The agent can call `request_user_input` to pause and ask the human |
| Runtime control | `.withKillSwitch()` | In-process `pause()` / `resume()` / `stop()` / `terminate()` on the run handle |

Approval gates and agent-initiated input are **durable** — the pause persists to a run store, so a run can be approved/answered from any process (or after a crash). They require `.withDurableRuns()`.

## Implementation baseline — durable approval gate

```ts
import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withName("assistant")
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "plan-execute-reflect", maxIterations: 20 })
  .withTools({ allowedTools: ["web-search", "file-read", "file-write"] })
  .withDurableRuns()                                 // required — pauses persist to a run store
  .withApprovalPolicy({
    tools: ["file-write"],                           // these calls pause for human approval
    mode: "detach",                                  // durable pause (default when durable runs are on)
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
  mode: "detach",                                    // "detach" = durable, "block" = in-process
})
```

Note: tools whose definition declares `requiresApproval: true` (built-ins like `code-execute` / `file-write`, and the `shell-execute` terminal tool) are folded in automatically once any approval policy is configured — you do not have to list them by hand.

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

`.withUserInteraction()` lets the model call the `request_user_input` tool to pause the run and ask the human for a form, choice, or confirmation. It also requires `.withDurableRuns()`:

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
| `.withApprovalPolicy(cfg)` | Gate named tool calls (or a predicate) behind human approval |
| `.withUserInteraction()` | Enable the agent-initiated `request_user_input` pause (needs `.withDurableRuns()`) |
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

- `.withApprovalPolicy({ mode: "detach" })` and `.withUserInteraction()` both REQUIRE `.withDurableRuns()` — the builder throws at `.build()` otherwise, because the pause has nowhere to persist
- With `mode: "detach"`, a gated run returns `status: "awaiting-approval"` and does NOT block — you must call `approveRun`/`denyRun` (or pass an `onApproval` callback) to finish it
- `mode: "block"` handles approval in-process instead and does not need durable runs, but the pause cannot outlive the process
- Kill switch controls (`pause`, `resume`, `stop`, `terminate`) are no-ops without `.withKillSwitch()` — no error is thrown, calls are silently ignored
- `request_user_input` only fires if the model chooses to call it — reinforce in the system prompt when it should ask rather than guess
- `denyRun` requires a reason string; `approveRun` takes an optional `{ reason }`
