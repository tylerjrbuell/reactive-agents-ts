---
title: Durable Execution
stability: experimental
description: >-
  Persist agent runs to disk and resume a crashed or paused run from its last
  checkpoint — kill the process, restart, finish the job.
sidebar:
  order: 26
badge:
  text: Experimental
  variant: caution
  __auto: '1'
lastCommit:
  subject: >-
    docs(accuracy): fix strategy IDs, withModelRouting section, sub-package
    import
  hash: 1216d5f
  date: '2026-07-01'
since: v0.12
---

Long-running agents crash. The machine reboots, the container is rescheduled, a
deploy rolls the process. **Durable execution** lets an agent survive that: every
iteration is checkpointed to disk, and a fresh process can reconstruct the run
from its last checkpoint and finish it — without re-doing completed tool work.

![An agent checkpointing each step to disk, getting killed mid-run, then a fresh process reconstructing the run from its last checkpoint and finishing the job](../../../assets/durable-resume.gif)

*Process A checkpoints each step, then is killed mid-run. Process B — a fresh process, same agent, same store — finds the crashed run on disk and finishes it. [Demo source](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/apps/examples/src/demos/durable-resume.ts).*

## Enabling durable runs

Opt in with `.withDurableRuns()`. Absent this call there is zero overhead: no
store, no database file, no checkpoint writes.

```typescript
import { ReactiveAgents } from "reactive-agents";

const agent = await ReactiveAgents.create()
  .withName("research-bot")
  .withSystemPrompt("You are a thorough research assistant.")
  .withReasoning()
  .withTools({ builtins: ["web-search"] })
  .withDurableRuns({ dir: "./.runs", checkpointEvery: 1 })
  .build();
```

`withDurableRuns` options:

| Option | Default | Meaning |
|---|---|---|
| `dir` | `~/.reactive-agents/<agentId>` | Directory for the SQLite run store (`runs.db`). |
| `checkpointEvery` | `1` | Persist a snapshot every N iterations. |

Each checkpoint is a **lossless serialized `KernelState`** — iteration counter,
reasoning steps, scratchpad, tools used, token accounting, and the provider
message thread. Checkpoints fire at every iteration boundary on the streaming
run path (`runStream` / the run-control plane).

## Resuming a run

After a crash, build the **same agent** in a new process and call `resumeRun`:

```typescript
// List runs to find what's resumable.
const runs = await agent.listRuns();
// → [{ runId, agentId, task, status, configHash, updatedAt }, ...]

const crashed = (await agent.listRuns({ status: "running" }))[0];
if (crashed) {
  const result = await agent.resumeRun(crashed.runId);
  console.log(result.output);
}
```

`resumeRun(runId)`:

1. Loads the highest-iteration checkpoint for the run.
2. Verifies the agent config still matches (see the guard below).
3. Seeds the restored `KernelState` and continues the reasoning loop to
   completion.
4. Flips the run status to `completed` (or `failed`).

`listRuns(filter?)` enumerates persisted runs, newest-updated first, optionally
filtered by `status` (`running` | `paused` | `awaiting-approval` | `completed`
| `failed`).

Both methods require `.withDurableRuns()`; calling them on a non-durable agent
throws.

### Completed tools are not replayed

Resume does **not** re-execute tools that already ran — their results live in the
restored steps and message thread. The agent picks up where it left off. (Side
effects from completed tools are therefore not repeated; in-flight work at the
moment of the crash is re-attempted from the last checkpoint boundary.)

## The config-hash guard

A run is captured under a specific agent identity. Resuming it under a materially
different agent — a changed system prompt, a different provider — would be
incoherent. `resumeRun` guards against this: the run stores an identity hash
(system prompt + provider) at capture time, and resume recomputes it. On a
mismatch it fails with `DurableConfigMismatchError` rather than silently
continuing under the wrong configuration.

```typescript
import { DurableConfigMismatchError } from "reactive-agents";

try {
  await agent.resumeRun(runId);
} catch (e) {
  if (e instanceof DurableConfigMismatchError) {
    // Agent config drifted since the run was captured.
  }
}
```

An unknown run id (or a run with no checkpoint) fails with
`DurableRunNotFoundError`.

## Kill it, resume it

The guarantee end to end: a run captured in one OS process is reconstructed and
finished in a **different** process, purely from the on-disk checkpoint.

```typescript
// Process A — does work, then is hard-killed (SIGKILL, crash, reboot).
const a = await buildAgent();          // .withDurableRuns({ dir })
for await (const _ of a.runStream(task)) { /* ... process dies mid-run ... */ }

// Process B — a fresh start, same agent config, same dir.
const b = await buildAgent();          // .withDurableRuns({ dir })
const runId = (await b.listRuns())[0].runId;
const result = await b.resumeRun(runId);   // reconstructs + completes
```

## Relationship to `withProgressCheckpoint`

`.withProgressCheckpoint(every)` is a lighter, plan-level hint: on restart,
session resumption surfaces the incomplete plan as prior context. It does **not**
reconstruct full kernel state. For true crash-resume, use `.withDurableRuns()`.

## Human-in-the-loop builds on this

The same checkpoint + resume machinery powers durable **approval gates**: a gated
tool call pauses the run (`status: "awaiting-approval"`), persists it, and a human
approves or denies — from any process — to resume from the exact checkpoint. See
[Durable Human-in-the-Loop](/guides/durable-hitl/).

## See also

- [Durable Human-in-the-Loop](/guides/durable-hitl/) — approval gates that survive process death.
- [Reasoning](/guides/reasoning) — the kernel loop that produces the state being checkpointed.
- [Snapshot & Replay](/features/snapshot-replay) — `@reactive-agents/replay` for deterministic run capture and inspection.
