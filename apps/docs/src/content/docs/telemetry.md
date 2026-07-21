---
title: Telemetry
description: Exactly what anonymous data Reactive Intelligence telemetry collects, what it never collects, and every way to turn it off.
---

When Reactive Intelligence is enabled, the framework sends an **anonymous run
report** after each run to help improve model calibration profiles. A
dismissible notice is shown the first time this happens in a process, linking
here. This page is the complete, honest inventory.

## What is collected

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

## Turning it off

Any one of these disables telemetry entirely:

```bash
# Environment (no code change) — either variable works
export DO_NOT_TRACK=1                  # console DNT convention
export REACTIVE_AGENTS_TELEMETRY=0
```

```typescript
// Per agent, in code
ReactiveAgents.create()
  .withReactiveIntelligence({ telemetry: false })
  .build();
```

Disabling telemetry does not disable Reactive Intelligence itself — the
entropy sensor and controller keep working locally; only the anonymous
reporting stops. When the environment opt-out is set, the first-run notice is
suppressed too (the framework never claims to send what it doesn't).
