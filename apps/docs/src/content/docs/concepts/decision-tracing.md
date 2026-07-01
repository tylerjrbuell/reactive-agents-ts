---
title: Decision Tracing
description: >-
  Capture *why* every agent decision is made — tool selection, assumption,
  termination — as typed, queryable rationale across the harness.
lastCommit:
  subject: >-
    docs(badges): unified badge system — sync-page-metadata replaces
    new-page-indicator
  hash: 857138c
  date: '2026-07-01'
since: v0.10
badge:
  text: Updated
  variant: note
  __auto: '1'
---

# Decision Tracing (v0.11.x)

Reactive Agents records not just *what* the agent did but *why*. Every tool selection, model-stated assumption, curator action, and termination can carry a structured **Rationale** alongside the existing event stream. The `rax diagnose debrief` command renders that rationale as a decision-centric timeline that post-hoc reviewers can audit without re-running.

## The Rationale shape

```ts
import type { Rationale } from "@reactive-agents/core";

type Rationale = {
  why: string;                 // ≤280 chars
  refs?: readonly string[];    // observation/scratchpad keys, e.g. "obs:1", "scratch:goal"
  alternatives?: readonly { option: string; rejectedBecause: string }[];
  confidence?: number;         // [0,1]
};
```

The type lives in `@reactive-agents/core` so the trace, tools, reasoning, and runtime packages can share it without cross-package coupling. Validators (`validateRationale`, `isRationale`) ship from `@reactive-agents/trace`.

## What gets captured

| Source                          | TraceEvent kind            | Rationale field           |
|---------------------------------|----------------------------|---------------------------|
| Tool call (native FC)           | `ToolCallStarted`          | `rationale` (required)    |
| Tool call (text-parse)          | `ToolCallStarted`          | `rationale` (required)    |
| Tool call (plan-execute step)   | `ToolCallStarted`          | `rationale` (required)    |
| Model-stated assumption         | `assumption-recorded`      | `rationale` (required)    |
| Curator decision                | `curator-decision`         | `rationale` (required)    |
| Alternatives weighed            | `alternatives-considered`  | — (uses inline shape)     |
| Termination                     | `kernel-state-snapshot`    | `terminationRationale`    |
| Strategy switch                 | `strategy-switched`        | `rationale`               |
| Reactive decision               | `decision-evaluated`       | `rationale`               |

Tool-call rationale is **coaxed** from the model by a kernel-injected system prompt (opt-in — see below) and (for plan-execute) a schema-enforced planner field. When the model complies, rationale is captured; when it doesn't, the field is absent and a metric fires — never synthesized.

## Opt-in: `auditRationale`

Tool-call rationale on the **reactive / adaptive** paths is **off by default** and enabled per-agent:

```ts
const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withReasoning({ auditRationale: true })   // or env RA_RATIONALE_AUDIT=1
  .build();
```

Rationale is an **audit feature, not a performance one** — the per-tool-call `<rationale>` block is pure decode/token cost with no quality benefit (ablation: enabling it added ~20–27% output tokens / latency on rationale-emitting local models, flat quality). Turn it on when you need an auditable "why" trail in the debrief; leave it off for lowest cost/latency.

Two things the flag does **not** change:

- **plan-execute-reflect** always carries rationale — it's a structural field of the plan JSON (generated once per plan, not per turn), independent of `auditRationale`.
- **Capture is opportunistic.** The flag controls whether the kernel *asks* for rationale. If a rationale block appears in model output for any other reason (e.g. recalled from memory), it is still parsed and logged.

## Capturing rationale at tool-call time

Rationale is coaxed from the model on three paths. Paths 1–2 fire only when `auditRationale` is enabled; path 3 (plan-execute) is always on:

### 1. Native function-calling (Ollama, Anthropic, OpenAI, Gemini)

When `auditRationale` is enabled, the kernel injects a requirement into the system prompt — independent of `toolSchemaDetail` — instructing the model to emit one `<rationale>` block per tool call, in order:

```text
## Decision Rationale (MANDATORY — every tool call)
Every tool call you issue MUST be preceded by a rationale block in your text content...
<rationale call="1">{"why":"one sentence, ≤280 chars","confidence":0.0-1.0}</rationale>
```

`parseRationaleBlocks()` reads them from the assistant's text + thinking content and attaches each one to the matching `ToolCallSpec` by 1-indexed position. Provider FC events have no sibling rationale field, so this side-channel is what carries the model's stated "why" into the trace.

### 2. Text-parse drivers (small local models)

When the driver falls back to text-parse mode, the tier-2/3 parsers accept `rationale` as a sibling JSON field on the tool-call object:

```jsonc
[
  {
    "name": "web_search",
    "arguments": { "query": "AAPL stock" },
    "rationale": { "why": "needs fresh price data", "refs": ["scratch:goal"] }
  }
]
```

The tier-1 XML format reads external `<rationale>` blocks identically to native-FC.

### 3. plan-execute-reflect strategy

The planner's structured-output schema requires `rationale: { why, confidence? }` on every `tool_call` step:

```jsonc
{
  "title": "Fetch recent commits",
  "type": "tool_call",
  "toolName": "github/list_commits",
  "toolArgs": { "owner": "acme", "repo": "app", "perPage": 10 },
  "rationale": {
    "why": "Need the raw commit list before any summarization can begin",
    "confidence": 0.95
  }
}
```

`plan-execute.ts` publishes `ToolCallStarted` with the step's rationale before dispatching the tool. If the model omits rationale on any `tool_call` step, the strategy issues a **`[STRICT RETRY]`** plan regeneration with a stronger reminder. Non-compliance after retry emits a `plan_rationale_missing` metric — no synthetic fallback is invented, the field stays empty so observability surfaces the gap.

## Capturing model assumptions automatically

The think phase scans thought text for `I assume X (because Y).` patterns and emits an `assumption-recorded` event per detected assumption (capped at 3 per iteration). No model prompting required — the pattern is conventional enough that frontier and local models hit it naturally.

```text
think.ts output: "I assume the user wants USD because no currency given. ..."
↓
AssumptionRecordedEvent {
  assumption: "the user wants USD",
  rationale: { why: "no currency given" }
}
```

## Marking a termination with rationale

The `terminate()` helper accepts an optional `rationale` that surfaces on `KernelStateSnapshotEvent.terminationRationale`:

```ts
terminate(state, {
  reason: "quality_threshold",
  output: synthesized,
  rationale: { why: "quality 0.92 ≥ threshold 0.90" },
});
```

Use this when `reason` is opaque (e.g. `"quality_threshold"`) and the threshold/score context makes the choice auditable.

## Reading the trace: `rax diagnose debrief`

The debrief command folds every rationale-bearing event into a single timeline:

```bash
rax diagnose debrief <runId>
rax diagnose debrief latest
rax diagnose debrief <runId> --json
```

The legacy standalone bin `rax-diagnose debrief …` continues to work as well.

Example output:

```text
Debrief: run abc-123
├─ Goal: find current price of AAPL stock
├─ Path: web_search → calculator
├─ Why this path
│   • iter 1 chose tool:web_search: "needs fresh price data" (refs: scratch:goal)
│   • iter 2 chose tool:calculator: "verify cited number"
├─ Assumptions
│   • "user means USD" (conf: 0.60) — no currency specified
├─ Curator
│   • iter 2 marked-untrusted obs:scrape-1 — "no audit trail"
├─ Termination: quality_threshold — "quality 0.92 ≥ threshold 0.90"
└─ Verdict: success | 1500 tok | 2500ms
```

Unlike `rax-diagnose replay`, which is event-centric and shows every event in the trace, `debrief` is decision-centric: it drops events that carry no rationale signal so reviewers see the audit trail, not the raw firehose.

## Programmatic access

For custom dashboards or LLM-as-judge debriefing, build the structured shape directly:

```ts
import { buildDebrief } from "@reactive-agents/diagnose";

const debrief = await buildDebrief("/path/to/trace.jsonl");
console.log(debrief.path);            // [{ iter, action, rationale? }, ...]
console.log(debrief.termination);     // { by, rationale? }
console.log(debrief.assumptions);     // [{ iter, assumption, rationale }, ...]
```

## Reading rationale from `AgentResult.debrief`

`result.debrief.rationale[]` is a unified log of every task-advancing decision the agent made. Each entry carries an `iteration`, a `decision` tag, an optional `toolName`, and the structured `rationale`. The `decision` tag identifies the source:

| `decision` value                       | Source                                                       |
|----------------------------------------|--------------------------------------------------------------|
| `tool-selection`                       | Model emitted `<rationale>` block for a tool call             |
| `curator-{kept\|dropped\|compressed\|marked-untrusted}` | `CuratorDecisionEmitted` event from context curator |
| `strategy-switch:{from}→{to}`          | `StrategySwitched` event from the strategy evaluator         |
| `reactive-{early-stop\|branch\|compress\|switch-strategy\|attribute}` | `ReactiveDecision` event from RI dispatcher |
| `termination:{reason}`                 | `KernelStateSnapshotEmitted` event with `terminationRationale` |

Example:

```ts
const result = await agent.run("Fetch and summarize the last 10 commits, then write to file");

console.log(result.debrief?.rationale);
// [
//   { iteration: 1, decision: "tool-selection", toolName: "github/list_commits",
//     rationale: { why: "Need the raw commit list before any summarization can begin", confidence: 0.95 } },
//   { iteration: 2, decision: "curator-dropped",
//     rationale: { why: "Observation contained no audit trail", refs: ["obs:scrape-1"] } },
//   { iteration: 3, decision: "tool-selection", toolName: "file-write",
//     rationale: { why: "Save the final summary to a local file for future reference", confidence: 0.9 } },
//   { iteration: 4, decision: "termination:quality_threshold",
//     rationale: { why: "quality 0.92 ≥ threshold 0.90" } }
// ]
```

The rendered `debrief.markdown` includes a `## Decision Rationale` section automatically — strategy switches, reactive interventions, curator decisions, and terminations all surface alongside tool selections.

## Authoring rationale-bearing tools

Tool authors don't need to do anything: the rationale lives on the model side. On the reactive/adaptive paths it's coaxed by the kernel-injected system prompt **when `auditRationale` is enabled**; the `plan-execute` strategy always requires it as a plan-step field and retries plan generation if the model forgets. The parser tolerates messy small-model output (markdown-fenced JSON bodies, over-length `why`, repeated `call="N"` attributes) so opt-in capture is reliable cross-tier.

## What this isn't

- **Not LLM-as-judge.** Rationale is the *model's own* stated reasoning. A separate judge layer (post-run) can score whether the rationale matches actual behavior; the trace captures the claim, not the verdict.
- **Not a confabulation guard.** If a model emits a `refs: ["obs:99"]` that doesn't exist, the trace records it as-is. A planned anti-confabulation guard will reject calls citing unknown refs.
- **Not synthesized.** If a small model fails to comply after the strict retry, the field stays empty and a `plan_rationale_missing` metric fires. Rationale is intentional model output or nothing — never a generated stand-in derived from the instruction text.
