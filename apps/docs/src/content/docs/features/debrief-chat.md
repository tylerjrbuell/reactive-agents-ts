---
title: Debrief & Chat
description: Structured run artifacts, post-run synthesis, and conversational interaction with agents.
sidebar:
  order: 15
---

## Overview

Every agent run now produces a structured debrief — a synthesized account of what was accomplished, what tools were used, what errors occurred, and what was learned. Between and during runs, `agent.chat()` lets you query the agent conversationally.

Three components work together:

| Component | What it does |
|-----------|-------------|
| `final-answer` tool | Hard-gates the ReAct loop when the task is done; declares format + confidence |
| `DebriefSynthesizer` | Post-run service: collects signals + one LLM call → `AgentDebrief` |
| `agent.chat()` | Conversational Q&A with adaptive routing (direct LLM or tool-capable) |

---

## The `final-answer` Tool

When reasoning is enabled, the agent sees a `final-answer` meta-tool (alongside `task-complete`). Calling it hard-terminates the ReAct loop immediately — no more "FINAL ANSWER:" text matching:

```
final-answer({
  output: string,    // The deliverable — answer text, JSON, file path, etc.
  format: "text" | "json" | "markdown" | "csv" | "html",
  summary: string,   // Self-report of what was accomplished
  confidence?: "high" | "medium" | "low"
})
```

The tool appears once the agent has:
1. Run ≥ 2 iterations
2. Called at least one non-meta tool
3. Met all required tools (if `.withRequiredTools()` was used)
4. Has no pending errors

`result.terminatedBy` will be `"final_answer_tool"` when this path is taken, or `"final_answer"` for legacy text-regex fallback.

---

## AgentDebrief

Automatically synthesized after each run when both `.withMemory()` and `.withReasoning()` are enabled:

```typescript
interface AgentDebrief {
  outcome: "success" | "partial" | "failed";
  summary: string;                    // 2-3 sentence narrative
  keyFindings: string[];
  errorsEncountered: string[];
  lessonsLearned: string[];           // Auto-written to ExperienceStore
  confidence: "high" | "medium" | "low";
  caveats?: string;
  toolsUsed: { name: string; calls: number; successRate: number }[];
  metrics: { tokens: number; duration: number; iterations: number; cost: number };
  markdown: string;                   // Pre-rendered Markdown
}
```

Access it from the run result:

```typescript
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning()
  .withMemory({ tier: "enhanced", dbPath: "./memory-db" })
  .build();

const result = await agent.run("Fetch the 5 latest commits from tylerjrbuell/reactive-agents-ts and summarize them");

if (result.debrief) {
  console.log(result.debrief.summary);
  // "Agent retrieved 5 commits from the repository, summarized..."

  console.log(result.debrief.markdown);
  // Full Markdown debrief with ## Summary, ## Key Findings, ## Tools Used, ## Metrics

  console.log(result.debrief.toolsUsed);
  // [{ name: "github/list_commits", calls: 1, successRate: 1 }]
}
```

### Persistence

Debriefs are persisted to the memory SQLite DB in the `agent_debriefs` table alongside episodic/semantic/procedural memory. No extra config needed — it uses the same DB path from `.withMemory()`.

---

## Enriched `AgentResult`

`AgentResult` gains optional fields that are backward compatible (existing code reading only `result.output` and `result.success` is unaffected):

```typescript
interface AgentResult {
  // Existing — unchanged
  output: string;
  success: boolean;
  taskId: string;
  agentId: string;
  metadata: { duration, cost, tokensUsed, strategyUsed?, stepsCount, confidence? };

  // New optional fields
  format?: "text" | "json" | "markdown" | "csv" | "html";
  terminatedBy?: "final_answer_tool" | "final_answer" | "max_iterations" | "end_turn";
  debrief?: AgentDebrief;
}
```

`terminatedBy` tells you exactly how the run ended:

| Value | Meaning |
|-------|---------|
| `"final_answer_tool"` | Agent called the `final-answer` meta-tool (preferred) |
| `"final_answer"` | Agent wrote "FINAL ANSWER:" in text (legacy fallback) |
| `"max_iterations"` | Hit the iteration cap |
| `"end_turn"` | Model stopped naturally without explicit completion |

---

## agent.chat()

Conversational interaction with the agent. Routes automatically based on intent:

```typescript
// Simple Q&A — uses direct LLM path (fast, no tools)
const reply = await agent.chat("What did you accomplish in the last run?");
console.log(reply.message);
// "In the last run, I fetched 5 commits from the repository and..."
// (Context from result.debrief is injected automatically)

// Tool-capable request — routes through lightweight ReAct loop
const reply2 = await agent.chat("Fetch the latest issues from the GitHub repo");
console.log(reply2.toolsUsed); // ["github/list_issues"]
```

Intent routing heuristic (zero tokens):
- **Direct path**: conversational questions, summaries, status checks
- **Tool path**: requests containing action words: search, fetch, find, get, check, write, create, send, run, execute, calculate, etc.

Override routing manually:

```typescript
await agent.chat("Tell me about the results", { useTools: false }); // force direct
await agent.chat("Get the latest commits", { useTools: true });      // force tool path
```

---

## agent.session()

Multi-turn conversations with persistent history:

```typescript
const session = agent.session();

const r1 = await session.chat("What tools did you use in the last run?");
const r2 = await session.chat("Tell me more about the first one");
// r2 has full context: both turns are included in the LLM's message history

const history = session.history();
// [{ role: "user", content: "...", timestamp: ... }, { role: "assistant", ... }, ...]

await session.end(); // Clears history
```

`session.history()` returns a copy of the message array. History is cleared on `session.end()`.

---

## Setup

```typescript
const agent = await ReactiveAgents.create()
  .withName("my-agent")
  .withProvider("anthropic")
  .withReasoning({ defaultStrategy: "reactive" })
  .withMemory({ tier: "enhanced", dbPath: "./memory-db" })  // Enables debrief
  .withTools()
  .build();

// Run a task
const result = await agent.run("Summarize the 3 latest PRs in the repo");
console.log(result.terminatedBy);  // "final_answer_tool"
console.log(result.debrief?.summary);

// Ask a follow-up
const reply = await agent.chat("Which PR had the most changes?");
console.log(reply.message); // Uses debrief context

// Multi-turn session
const session = agent.session();
await session.chat("What did the agent find?");
await session.chat("Can you elaborate on the second point?");
await session.end();

await agent.dispose();
```
