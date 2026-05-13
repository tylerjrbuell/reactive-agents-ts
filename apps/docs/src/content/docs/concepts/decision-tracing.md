---
title: Decision Tracing
description: Capture *why* every agent decision is made — tool selection, assumption, termination — as typed, queryable rationale across the harness.
---

# Decision Tracing (v0.11.x)

Reactive Agents records not just *what* the agent did but *why*. Every tool selection, model-stated assumption, curator action, and termination can carry a structured **Rationale** alongside the existing event stream. The `rax-diagnose debrief` command renders that rationale as a decision-centric timeline that post-hoc reviewers can audit without re-running.

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
| Tool call (model emitted)       | `tool-call-start`          | `rationale`               |
| Model-stated assumption         | `assumption-recorded`      | `rationale` (required)    |
| Curator decision                | `curator-decision`         | `rationale` (required)    |
| Alternatives weighed            | `alternatives-considered`  | — (uses inline shape)     |
| Termination                     | `kernel-state-snapshot`    | `terminationRationale`    |
| Strategy switch                 | `strategy-switched`        | `rationale`               |
| Reactive decision               | `decision-evaluated`       | `rationale`               |

All fields are **optional**. Existing consumers continue to work; agents that don't emit rationale produce identical traces to v0.10.

## Capturing rationale at tool-call time

Models can emit a `rationale` alongside the call in the same JSON object. The text-parse driver's tier-3 parser captures it:

```jsonc
[
  {
    "name": "web_search",
    "arguments": { "query": "AAPL stock" },
    "rationale": {
      "why": "needs fresh price data",
      "refs": ["scratch:goal"]
    }
  }
]
```

For models that don't emit rationale, the tool call still parses; the field is simply absent from the resulting `ToolCallEvent`.

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

## Reading the trace: `rax-diagnose debrief`

The debrief command folds every rationale-bearing event into a single timeline:

```bash
rax-diagnose debrief <runId>
rax-diagnose debrief latest
rax-diagnose debrief <runId> --json
```

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

## Authoring rationale-bearing tools

Tool authors don't need to do anything: the rationale lives on the model side. If you want to *require* models to emit rationale, append a one-line nudge to the system prompt:

> When you call a tool, you MAY include a short `rationale.why` (≤280 chars) explaining why this tool over alternatives. Cite observation or scratchpad keys in `rationale.refs` when relevant.

This is optional in v0.11.x to preserve backward compatibility with existing prompts and to keep prompt-token overhead minimal.

## What this isn't

- **Not LLM-as-judge.** Rationale is the *model's own* stated reasoning. A separate judge layer (post-run) can score whether the rationale matches actual behavior; the trace captures the claim, not the verdict.
- **Not a confabulation guard.** If a model emits a `refs: ["obs:99"]` that doesn't exist, the trace records it as-is. A planned anti-confabulation guard (post-v0.11.x) will reject calls citing unknown refs.
- **Not always-on coverage.** v0.11.x targets ≥50% tool-call coverage on frontier models. Coverage rises as the optional-rationale nudge spreads through community prompts and as the strict-mode `requireRationale: true` flag ships in a later minor.
