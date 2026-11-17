---
title: Telemetry
description: Anonymous run telemetry is off by default. Exactly what it collects if you opt in, what it never collects, and how opt-in and opt-out interact.
topic: observability
---

Anonymous run telemetry is **off by default**. An agent with no telemetry
setting builds no telemetry client, creates no install ID, sends nothing to
`api.reactiveagents.dev` and prints no notice. If you opt in, the framework
sends an **anonymous run report** after each run to help improve model
calibration profiles, and shows a one-time notice per process linking here.
This page is the complete, honest inventory of what that report contains.

Local run observations (used by the opt-in learned calibration tier) are still
written to `~/.reactive-agents/observations` whether or not you opt in; they
never leave your machine. The opt-in community calibration profile is a
separate, receive-only request; see
[Model Calibration](/features/llm-providers/#model-calibration).

## What is collected (only if you opt in)

Run-shape metrics only — the report is built in
`packages/runtime/src/engine/finalize/telemetry-emit.ts` and its exact type is
`RunReport` in `@reactive-agents/reactive-intelligence`:

- A random per-install ID (UUID — no account, no hardware fingerprint)
- Model ID, tier, and provider name (e.g. `qwen3:4b` / `local` / `ollama`)
- Task **category label** (a classifier output like `coding` — see below)
- Tool **names** used and call counts
- Strategy used, termination reason, outcome, iteration/token/duration totals
- Entropy-trace metrics (numeric signals about run stability)

## What is never collected

- **No prompt or task text** — only the classified category label leaves the
  machine
- **No model outputs, tool arguments, or tool results**
- **No file contents, paths, or environment variables**
- **No API keys**

Reports are signed and sent fire-and-forget to
`api.reactiveagents.dev` (override with
`REACTIVE_AGENTS_TELEMETRY_REPORTS_URL`); a network failure never affects the
run. Runs on the `test` provider never send anything.

## Opting in

Either of these turns it on:

```typescript
// Per agent, in code
ReactiveAgents.create()
  .withReactiveIntelligence({ telemetry: true })
  .build();
```

```bash
# Environment (no code change)
export REACTIVE_AGENTS_TELEMETRY=1     # or "true"
```

## Opting out, and precedence

Precedence, strongest first:

1. `DO_NOT_TRACK=1` (console DNT convention) or `REACTIVE_AGENTS_TELEMETRY=0`
   in the environment: telemetry is off, even over an explicit
   `telemetry: true`.
2. An explicit `telemetry: false` in code beats the
   `REACTIVE_AGENTS_TELEMETRY=1` opt-in.
3. `telemetry: true` (or `{ enabled: true }`) or
   `REACTIVE_AGENTS_TELEMETRY=1` opts in.
4. Nothing set: off.

Opting in or out does not change Reactive Intelligence itself: the entropy
sensor and controller keep working locally; only the anonymous reporting is
affected. The notice prints only when telemetry is actually on (the framework
never claims to send what it does not).
