# Pre-Release Polish — Examples Suite & Docs Audit

**Date:** 2026-02-26
**Status:** Approved
**Release target:** v0.5.5

---

## Context

At v0.5.5 the framework has 17 packages and ~886 tests, but the developer-facing examples directory
only covers 6 scenarios using builtin tools with an Ollama backend. Major layers —
orchestration, identity, guardrails, verification, cost tracking, eval, prompt A/B experiments,
self-improvement, and advanced reasoning — have no runnable example. The integration test runner
(`main.ts`) exists but is coupled to Ollama and not structured as discoverable documentation.

This sprint produces:
1. A fully-reorganized `apps/examples/` with 21 examples across 6 categories
2. A unified `run-all.ts` entry point replacing `main.ts`
3. An accuracy pass on 8 stale documentation pages
4. Category README files for every example group

---

## 1. Example Suite Structure

### Directory Layout

```
apps/examples/
├── README.md                     ← top-level navigation table (all 21 examples)
├── run-all.ts                    ← single runner: all examples + pass/fail summary
├── package.json                  ← updated scripts per category
├── tsconfig.json
└── src/
    ├── foundations/
    │   ├── README.md
    │   ├── 01-simple-agent.ts
    │   ├── 02-lifecycle-hooks.ts
    │   ├── 03-multi-turn-memory.ts
    │   └── 04-agent-composition.ts
    ├── tools/
    │   ├── README.md
    │   ├── 05-builtin-tools.ts
    │   ├── 06-mcp-filesystem.ts
    │   └── 07-mcp-github.ts
    ├── multi-agent/
    │   ├── README.md
    │   ├── 08-a2a-protocol.ts
    │   ├── 09-orchestration.ts
    │   └── 10-dynamic-spawning.ts
    ├── trust/
    │   ├── README.md
    │   ├── 11-identity.ts
    │   ├── 12-guardrails.ts
    │   └── 13-verification.ts
    ├── advanced/
    │   ├── README.md
    │   ├── 14-cost-tracking.ts
    │   ├── 15-prompt-experiments.ts
    │   ├── 16-eval-framework.ts
    │   ├── 17-observability.ts
    │   └── 18-self-improvement.ts
    ├── reasoning/
    │   ├── README.md
    │   ├── 19-reasoning-strategies.ts
    │   └── 20-context-profiles.ts
    └── interaction/
        ├── README.md
        └── 21-interaction-modes.ts
```

### File Migration

The 6 existing files move into `foundations/` with slight renaming:

| Old path | New path | Changes |
|---|---|---|
| `src/01-simple-agent.ts` | `foundations/01-simple-agent.ts` | None |
| `src/02-lifecycle-hooks.ts` | `foundations/02-lifecycle-hooks.ts` | Add pass/fail exit |
| `src/03-multi-turn-agent.ts` | `foundations/03-multi-turn-memory.ts` | Rename only |
| `src/05-agent-composition.ts` | `foundations/04-agent-composition.ts` | Renumber |
| `src/04-a2a-agents.ts` | `multi-agent/08-a2a-protocol.ts` | Renumber + expand |
| `src/06-remote-mcp.ts` | Merged into `tools/06-mcp-filesystem.ts` | Expand config demo |
| `src/index.ts` | Replaced by `run-all.ts` | Rewrite |
| `main.ts` (root) | Deleted | Scenarios absorbed |

---

## 2. Example Specifications

### foundations/ (offline-runnable, test mode)

| # | File | Scenario | Pass Signal | Key APIs |
|---|---|---|---|---|
| 01 | simple-agent | Q&A: "What is O(n log n)?" | output contains "n log n" | `.withTestResponses()`, `.build()`, `.run()` |
| 02 | lifecycle-hooks | Phase timing with before/after hooks | all 5 phases fire, "complete" hook called | `.withHook()`, `ExecutionPhase` |
| 03 | multi-turn-memory | Customer support: 3 turns, SQLite episodic memory | turn 3 references context from turn 1 | `.withMemory()`, sequential `.run()` |
| 04 | agent-composition | Coordinator delegates to researcher sub-agent | output from sub-agent reaches parent result | `.withAgentTool()`, `SubAgentResult` |

### tools/ (05 offline; 06-07 require running MCP server)

| # | File | Scenario | Pass Signal | Key APIs | Mode |
|---|---|---|---|---|---|
| 05 | builtin-tools | Demonstrate all 8 built-in tools in one session | each tool called + result captured | file-write/read, web-search, http-get, code-execute, scratchpad-write/read, spawn-agent | Offline |
| 06 | mcp-filesystem | Agent reads project files and summarizes via MCP | summary contains real filename from project | `.withMCP([stdio config])`, MCP filesystem server | Real |
| 07 | mcp-github | Agent queries open PRs via MCP GitHub server | output contains repo name and PR count | `.withMCP([sse config])`, MCP GitHub server | Real |

### multi-agent/ (require LLM key)

| # | File | Scenario | Pass Signal | Key APIs |
|---|---|---|---|---|
| 08 | a2a-protocol | Agent A starts server; Agent B discovers + delegates "summarize" task | delegation response received, task completed | `generateAgentCard()`, A2A JSON-RPC, `rax serve` |
| 09 | orchestration | 3-step workflow: research → draft → review, with approval gate on publish | all steps complete; approval gate pauses correctly | `WorkflowEngine`, `requiresApproval`, `approveStep()` |
| 10 | dynamic-spawning | Parent spawns specialist agents (coder, writer) at runtime | sub-agents invoked, outputs compose into final answer | `.withDynamicSubAgents()`, `spawn-agent` tool |

### trust/ (require LLM key)

| # | File | Scenario | Pass Signal | Key APIs |
|---|---|---|---|---|
| 11 | identity | Generate Ed25519 cert, sign payload, verify signature; RBAC check | signature valid, RBAC rejects unauthorized role | `AgentCertificate`, `generateKey("Ed25519")`, RBAC |
| 12 | guardrails | Agent with behavioral contract (denied tools) + kill switch demo: pause after first tool call, resume, graceful stop | contract blocks denied tool; pause blocks ≥1s; stop completes gracefully | `.withBehavioralContracts()`, `.withKillSwitch()`, `agent.pause/resume/stop()` |
| 13 | verification | Agent makes a factual claim; verification pipeline runs semantic entropy → fact decomposition → multi-source check | verification layers all run; hallucination score returned | `.withVerification()`, semantic entropy, multi-source |

### advanced/ (require LLM key)

| # | File | Scenario | Pass Signal | Key APIs |
|---|---|---|---|---|
| 14 | cost-tracking | Budget-constrained agent: set $0.01 budget, track per-task, route to cheaper model when budget < threshold | budget tracked; model routing fires on low budget | `.withCostTracking()`, `BudgetEnforcer`, `ComplexityRouter` |
| 15 | prompt-experiments | Define 2-variant A/B experiment; route 100 assignments; record 10 outcomes | assignment distribution ~50/50; `ExperimentService.record()` succeeds | `ExperimentService`, `assign()`, `record()`, variant groups |
| 16 | eval-framework | Evaluate 5 agent responses with LLM-as-judge; persist to EvalStore; query top scores | EvalStore contains 5 records; judge returns structured scores | `EvalFramework`, LLM-as-judge, `EvalStore.query()` |
| 17 | observability | Agent with all exporters: live streaming, JSONL file, metrics dashboard | JSONL file created; dashboard printed; EventBus events captured | `.withObservability({ live: true, verbosity: "verbose", file: "..." })` |
| 18 | self-improvement | Two-run scenario: run 1 solves math task (baseline); run 2 retrieves episodic strategy preference and solves faster | run 2 step count ≤ run 1 step count | `.withSelfImprovement()`, episodic memory, StrategyOutcome |

### reasoning/ (require LLM key)

| # | File | Scenario | Pass Signal | Key APIs |
|---|---|---|---|---|
| 19 | reasoning-strategies | Same task ("plan a 3-step pipeline") solved by all 5 strategies; print side-by-side results | all 5 complete; outputs logged with step/token counts | `defaultStrategy: "reactive"|"plan-execute"|"tree-of-thought"|"reflexion"|"adaptive"` |
| 20 | context-profiles | Same long-context task run with "local" vs "frontier" tier profiles; show compaction difference | local profile triggers compaction; frontier does not | `.withContextProfile({ tier: "local"|"frontier" })` |

### interaction/ (offline-runnable)

| # | File | Scenario | Pass Signal | Key APIs |
|---|---|---|---|---|
| 21 | interaction-modes | Demo all 5 autonomy modes with mock LLM: fully-autonomous, semi-autonomous (tool approval), step-by-step, supervised, fully-manual | each mode transitions correctly; approval gate fires in mode 2+ | `InteractionMode`, `approvalGate()`, `Checkpoint` |

---

## 3. run-all.ts — Unified Test Runner

`apps/examples/run-all.ts` replaces both `src/index.ts` and root `main.ts`.

### Behavior

```typescript
// Usage:
//   bun run apps/examples/run-all.ts              -- all examples
//   bun run apps/examples/run-all.ts --offline     -- offline-runnable only (CI-safe)
//   bun run apps/examples/run-all.ts 01 05 12      -- specific examples by number
```

### Output Format (same summary table as main.ts)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Reactive Agents — Example Suite                                     │
│  21 examples | offline: 7 | real: 14                                │
└──────────────────────────────────────────────────────────────────────┘

[01] foundations/simple-agent       ✅  3 steps  420 tok  1.2s
[02] foundations/lifecycle-hooks    ✅  1 step   210 tok  0.8s
...
[21] interaction/interaction-modes  ✅  1 step   180 tok  0.5s

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Passed: 21/21   Failed: 0   Duration: 47.3s
```

- Each example exports an `async function run(): Promise<{ passed: boolean; output: string; steps: number; tokens: number; durationMs: number }>`
- `run-all.ts` imports and calls each, collects results, prints table, exits with `process.exitCode = failed > 0 ? 1 : 0`
- `--offline` flag skips examples marked `requiresKey: true`

### main.ts Replacement

The 19 scenarios from `main.ts` are absorbed:
- S1–S8 (builtin tool scenarios) → `tools/05-builtin-tools.ts`
- S9 (memory persistence) → `foundations/03-multi-turn-memory.ts`
- S10 (context profile) → `reasoning/20-context-profiles.ts`
- S11 (scratchpad) → `tools/05-builtin-tools.ts`
- S12 (sub-agent delegation) → `foundations/04-agent-composition.ts`
- S13 (dynamic spawn) → `multi-agent/10-dynamic-spawning.ts`
- S14 (sandbox isolation) → `trust/12-guardrails.ts`
- S15 (self-improvement) → `advanced/18-self-improvement.ts`
- S16 (EventBus events) → `advanced/17-observability.ts`
- S17–S19 (lifecycle pause/stop/terminate) → `trust/12-guardrails.ts`

`main.ts` is deleted after `run-all.ts` is complete.

---

## 4. Docs Audit Scope

### Pages to Update (in-place accuracy pass)

| Page | What to update |
|---|---|
| `features/observability.md` | Add metrics dashboard section: header card, timeline, tool summary, alerts; update builder examples |
| `guides/reasoning.md` | Add Reflexion strategy section with params; update strategy comparison table |
| `features/a2a-protocol.md` | Add MCP WebSocket transport; update `rax serve --with-tools` flag |
| `cookbook/multi-agent-patterns.md` | Add dynamic spawning with `.withDynamicSubAgents()`; update sub-agent delegation section |
| `features/cost-tracking.md` | Add semantic cache embeddings + LLM-based prompt compression sections |
| `guides/context-engineering.md` | Verify 4 tier profiles (local/mid/large/frontier); progressive compaction levels; scratchpad |
| `guides/interaction-modes.md` | Add `approvalGate()` + WorkflowEngine approval gates section |
| `reference/cli.md` | Add `rax serve --with-tools` flag; add `rax discover` command |

### Category READMEs to Write (new)

- `apps/examples/README.md` — top-level navigation table
- `apps/examples/src/foundations/README.md`
- `apps/examples/src/tools/README.md`
- `apps/examples/src/multi-agent/README.md`
- `apps/examples/src/trust/README.md`
- `apps/examples/src/advanced/README.md`
- `apps/examples/src/reasoning/README.md`
- `apps/examples/src/interaction/README.md`

---

## 5. package.json Scripts Update

```json
{
  "scripts": {
    "run-all": "bun run run-all.ts",
    "run-all:offline": "bun run run-all.ts --offline",
    "foundations": "bun run run-all.ts 01 02 03 04",
    "tools": "bun run run-all.ts 05 06 07",
    "multi-agent": "bun run run-all.ts 08 09 10",
    "trust": "bun run run-all.ts 11 12 13",
    "advanced": "bun run run-all.ts 14 15 16 17 18",
    "reasoning": "bun run run-all.ts 19 20",
    "interaction": "bun run run-all.ts 21"
  }
}
```

---

## 6. Success Criteria

- [ ] All 21 examples exist and are runnable
- [ ] `bun run apps/examples/run-all.ts --offline` passes all 7 offline examples (exit 0)
- [ ] Each example file is self-contained with a clear `// PASS: <criteria>` comment
- [ ] Root `main.ts` is deleted; all CI references updated
- [ ] 8 docs pages pass accuracy review
- [ ] 8 category READMEs written
- [ ] `apps/examples/README.md` navigation table covers all 21 examples
