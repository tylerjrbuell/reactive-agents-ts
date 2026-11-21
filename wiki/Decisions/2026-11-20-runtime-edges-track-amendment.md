---
type: decision
status: proposed
created: 2026-11-20
tags: [decision, amendment, 09-unified-program, runtime, process-model, agent-spec, owner-ruling-pending]
---

# Amendment to 09: the runtime edges track (proposed)

**Status:** proposed and awaiting the owner's ratification. Once ratified, the text in "Proposed changes to 09" is applied to `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md` and this record moves to `accepted`. 09 §9 makes a change to 09 a ratification event, so this record is that event.

## Why

08 already states the goal: "runs are processes … the model is the CPU; RA is everything that made CPUs usable." The *inside* of that OS is mostly built: `RunHandle` (pause, resume, stop, terminate, inspect, fork), durable runs, and `rax ps` / `rax attach`. The *edges* a user or operator touches are missing:
- There is no executable format. An agent exists only as code or as a Cortex DB row.
- `rax run` maps no OS signals, and every failure exits 1.
- There is no single-file artifact to ship.
- The tool boundary enforces approval (`packages/tools/src/governance/tool-approval-gate.ts`) but not the full policy surface of 08 §5.1.

Owner observation (2026-11-20): these lower-level primitives are what would set Reactive Agents apart as an **agent harness runtime**. Library frameworks run inside your app. Harness products (coding agents) are closed apps. An open runtime that ships, runs, controls and audits agents as files and processes is the gap.

Two limits keep this honest:
1. **The runtime is the delivery vehicle, not the story.** 08's defensible core is still a harness that makes any model reliable, plus in-runtime verification. 08 §0 already calls durable execution "table stakes", and process control alone is the same.
2. **Stay at the agent layer.** Isolation stays with containers and scheduling with systemd or Kubernetes. The track owns agent semantics only: what a signal, an exit code and a policy mean for a run.

## Evidence

- Issue #299 and `wiki/Planning/Implementation-Plans/2026-11-20-portable-agent-file.md`. Track step E1 is in progress: the runtime module `packages/runtime/src/agent-spec.ts` landed in `2088150f1`.
- **Zero-token overhead probe, 2026-11-20.** The test provider answers instantly, so wall time is harness time. One kernel run (`.withReasoning()`), importing from `src` under Bun, on a loaded machine with swap exhausted:
  - import 488 ms, build 66 ms;
  - first run 168 ms, warm median 126 ms, warm p90 160 ms;
  - RSS 582 MB.

  Per run, the harness is small next to model latency (0.5 to 30 s per turn). Process start-up and memory are what an "agent as a process" fleet pays per process. They are the budgets that matter for this track, and they are unmeasured from `dist`.
- 09 §8 lists "`RunSupervisor` / `AgentSpec` as a greenfield seam" as NOT the path. The file format here is **not** that seam. It is a serialization at the edge of the existing `AgentConfig`, with no new internal config model, so §8 stands. The name collision needs a clarifying line (below).

## Proposed changes to 09

**§1, Strand P row.** Append: "runtime edges (file → process → binary → boundary) carry the OS to the user (2026-11-20 amendment)."

**§7, a new paragraph after W1/W2:**

> **Track E — runtime edges (2026-11-20 amendment).** A Strand P track that runs alongside Steps 4–6. It changes no kernel boundary; each step builds on substrate that already exists (`AgentConfig`, `RunHandle`, durable runs, `ToolService.execute`). WIP = 1 inside the track. Each step ships only when its exit gate is green:
>
> | Step | What | Exit gate |
> |---|---|---|
> | E1 | Agent file: an Open Agent Spec document, with Reactive Agents settings in `metadata` (#299) | round-trip identity Cortex ⇄ file ⇄ builder; no secret in any exported file; a reference Agent Spec reader loads the fixtures |
> | E2 | Process contract: `rax run --agent` maps signals to `RunHandle`, exit codes to outcomes, stdin/stdout/`--events jsonl`, and `--durable` for `rax ps`/`attach` | a test sends real signals to a child process and checks each mapped outcome and exit code; cold start and RSS budgets set from a `dist` measurement and pinned by a test |
> | E3 | Single executable: `rax build` | a compiled keyless agent runs Code Action, memory and an stdio MCP server from an empty directory, inside `test:install` |
> | E4 | Policy boundary: 08 §5.1 pulled forward (allowed tools, approval, per-tool budget and rate, risk level, enforced in `ToolService.execute`, audited, declared once in the file) | the deny/approve/budget-exceeded matrix at `execute()` is green; a policy in the file is enforced identically in code, `rax` and Cortex |
> | E5 | Supervision: process trees (sub-agents as supervised child runs) | **not moved.** Stays Arc 3, still gated by C5 |
>
> **Claim threshold:** "agent harness runtime" appears in public copy only when E1–E4 exit gates are green (08 honest-claims law).

**§7, the closing line** becomes: "Then, and only then: the rest of Arc 2 (the gate; the boundary lands as E4), Arc 3 (teams, gated by C5), Arc 4 + Phase 7 (C6)."

**§8, two additions:**
- Under the `RunSupervisor` / `AgentSpec` bullet: "The Open Agent Spec file format (Track E1) is an edge serialization of `AgentConfig`, not this seam."
- A new bullet: "**A rewrite in another language for speed.** The harness costs about 126 ms per warm run against 0.5–30 s of model time per turn (zero-token probe, 2026-11-20). The process-level costs (start-up, RSS) are fixed in TypeScript first: lazy layers, a smaller import graph, measuring from `dist`. A native component is considered only for a profiled hot spot that TypeScript cannot meet a pinned budget for, and it goes through the §2 evidence rule like any other mechanism."

## Owner decisions

1. Ratify Track E as worded, or with changes.
2. Pull the policy boundary forward as E4 (ahead of the rest of Arc 2), or leave it in Arc 2.
3. Accept the §8 language ruling.
