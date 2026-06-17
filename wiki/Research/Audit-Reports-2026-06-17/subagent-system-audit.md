---
title: Subagent / Multi-Agent System — Current State Audit + Target Evaluation
date: 2026-06-17
tags: [subagents, multi-agent, orchestration, architecture-audit]
status: gathering → evaluation
---

# Subagent System Audit (current state) + "What it should become"

Goal: make RA's subagent system more powerful + robust to power advanced
multi-agent workflows. This doc maps **what exists today** (code-verified), then
evaluates **the target**.

## 1. The three multi-agent primitives (today)

| Primitive | Builder | Mechanism | Worker defined by |
|---|---|---|---|
| **Static agent-as-tool** | `.withAgentTool(name, { provider?, model?, tools?, maxIterations?, persona? })` | Registers a named agent as a callable tool. | User, ahead of time (fixed roster). |
| **Dynamic sub-agents** | `.withDynamicSubAgents({ maxIterations?, maxRecursionDepth? })` | Adds `spawn-agent` (single) + `spawn-agents` (batch, parallel) meta-tools the orchestrator calls at runtime. | Orchestrator (model decides), at runtime. |
| **Remote A2A** | `.withRemoteAgent(name, url)` + `A2AOptions` | Registers a remote agent (other host/process) as a callable tool via `RemoteAgentClient`. | User; executes off-process. |
| **Workflow engine** | `@reactive-agents/orchestration` `WorkflowEngine` | `sequential`/`parallel`/`map-reduce`/`pipeline`/`orchestrator-workers` patterns; per-step `requiresApproval`; checkpoints; event log. | **Not wired into the builder/cortex** — standalone. |

## 2. How a sub-agent runs (code-verified)

`spawn-agent`/`spawn-agents` → `buildSubAgentTask` (runtime
`sub-agent-executor.ts`) → `createSubAgentExecutor` (tools
`agent-tool-adapter.ts`) → **`createLightRuntime`** → `ExecutionEngine.execute`.

**What a worker INHERITS from the parent:** provider, model, reasoningOptions,
guardrails, observability options, contextProfile, costTracking, **MCP tools
(proxied** — reuses the parent's live connections, no duplicate Docker
containers).

**What a worker can OVERRIDE / receive:**
- `tools` (subset; auto-relevance-filtered when unset so a worker doesn't see all
  40+ tools), which become *required* when set.
- `persona` (role / instructions / tone / background).
- `systemPrompt`.
- `maxIterations`.
- **Parent context** (`ParentContext`): parent task description + recent tool
  results + working memory, injected as a **text prefix bounded to 2000 chars**
  (`buildParentContextPrefix`).

**Robustness already present:**
- **Recursion depth cap** — `resolveMaxRecursionDepth` (default 3; per-agent
  `maxRecursionDepth`, or `REACTIVE_AGENTS_MAX_RECURSION_DEPTH` env). Depth ≥ cap
  → returns a failure result, not a throw.
- **Parallel batch w/ concurrency** — `spawn-agents` runs N workers via
  `Effect.all(..., { concurrency })`.
- **Bounded result** — worker returns a structured `SubAgentResult`
  `{ success, summary, tokensUsed, stepsCompleted, delegatedToolsUsed,
  forwardedScratchpadKeys }` (output summarized, not raw dumped).
- **Scratchpad forwarding** — worker scratchpad keys forwarded to the parent
  prefixed `sub:<name>:` (a partial blackboard).
- **`delegatedToolsUsed`** rollup — the parent sees which real tools the worker
  used (for required-tool accounting).

## 3. Gaps / weaknesses (the improvement surface)

| # | Gap | Evidence | Impact |
|---|---|---|---|
| G1 | **Worker events don't reach the parent.** Workers run on a separate `createLightRuntime` with its own EventBus; `sub-agent-executor` holds only a text `getParentContext`, no parent EventBus. | sub-agent-executor.ts has no eventBus ref | Worker traces invisible to the parent stream **and to cortex** — the team can't be observed/debugged. |
| G2 | **Per-worker model/provider override is dropped on the DYNAMIC path.** `SubAgentConfig` HAS `provider`/`model`, and static `.withAgentTool` honors them (local-agent-tools.ts:97-98), but `buildSubAgentTask` hardcodes `parentProvider`/`parentModel`, and `spawn-agent` tool args don't expose them. | sub-agent-executor.ts:143-144 | No heterogeneous teams via the orchestrator (cheap workers + pricey planner). |
| G3 | **No per-worker budget / timeout.** Only a coarse tool-level 300s timeout on `spawn-agents`. | agent-tool-adapter.ts:502 | A runaway worker can't be bounded independently. |
| G4 | **String-only hand-off.** Worker takes a task string, returns a summary string. No typed input/output (no `withOutputSchema` per worker, no structured data flow). | SubAgentResult.summary | "Telephone game" between agents; orchestrator re-parses prose. |
| G5 | **No aggregation primitive.** Parallel results come back as a raw array; reduce/merge/vote/best-of is ad-hoc in the orchestrator's prompt. | spawn-handlers.ts | map-reduce / ensemble / self-consistency must be hand-rolled. |
| G6 | **Workers can't be durable / HITL / structured.** Light runtime → no checkpoint, no approval pause, no `result.object`. | createLightRuntime path | A worker can't itself be a durable or human-gated step. |
| G7 | **Teams are FLAT — workers can't delegate further.** The worker light runtime is built WITHOUT the spawn-agent tool, so a worker can't spawn sub-sub-agents. Nesting is capped at 1 level (orchestrator → workers). Consequence: the recursion-depth cap (default 3) is **dead code** — it never trips because nesting never happens. Also, depth is always passed as `0` and never threaded, so if workers were given spawn tools the cap would still not fire. | sub-agent-executor.ts light runtime has no spawn registration; depth param always `0` | No deep multi-agent hierarchies (planner → leads → workers). Limits orchestrator-of-orchestrators patterns. |
| G8 | **No per-worker error policy.** A failed worker returns `success:false`; no retry / fallback-worker / continue-vs-fail-fast policy. | — | Brittle teams. |
| G9 | **Orchestration WorkflowEngine is unwired.** A real `sequential/parallel/map-reduce/pipeline/orchestrator-workers` engine exists but isn't reachable from the builder or cortex. | orchestration pkg | The structured workflow story is dormant. |
| G10 | **Context is a bounded text prefix, not data.** 2000-char parent-context prefix; large/structured hand-offs are lossy. | MAX_PARENT_CONTEXT_CHARS=2000 | Workers re-fetch / lose detail. |

## 4. Mechanism status
- **M8 (sub-agent delegation)** — open GH #42: "10-scenario bench" never run; delegation quality is unmeasured. Any improvement here should ship with a bench (project lift rule).

## 5. What it should become (target capabilities)
For advanced multi-agent workflows, the subagent system should provide, as
first-class + observable + bounded primitives:

1. **Observable teams** — every worker's events stream to the parent bus (nested,
   tagged by worker) → visible in cortex. *(Foundational — G1.)*
2. **Heterogeneous, bounded workers** — per-worker model/provider/budget/timeout/
   error-policy, on BOTH static + dynamic paths. *(G2/G3/G8.)*
3. **Typed hand-off** — workers accept + return typed objects via `withOutputSchema`
   + contracts; structured data flows between agents. *(G4/G10.)*
4. **Aggregation primitives** — built-in `merge`/`vote`/`best-of`/`reduce` for
   parallel results. *(G5.)*
5. **Full-capability workers** — a worker can be durable / HITL-gated / structured
   (not stuck on the light runtime). *(G6.)*
6. **Wired workflow engine** — the orchestration `WorkflowEngine` reachable from
   the builder + cortex (the 5 patterns), composing all of the above. *(G9.)*
7. **Hardened recursion + shared blackboard** — verified depth propagation + a
   real shared workspace for worker collaboration. *(G7 + scratchpad→blackboard.)*

## 6. Recommended sequencing
G1 (observability) is the foundation — you can't improve what you can't see, and
it's the prerequisite for debugging every later change. Then G2/G3/G8 (bounded
heterogeneous workers, cheap + high-value), then G4 (typed hand-off), then G5
(aggregation), then G6 (full-capability workers) and G9 (wire the WorkflowEngine).
Each lands behind the M8 bench (≥3pp / ≤15% token rule).
