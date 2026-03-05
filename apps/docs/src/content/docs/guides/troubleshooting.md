---
title: Troubleshooting
description: Fast diagnosis for common Reactive Agents issues in development and production.
sidebar:
  order: 11
---

Use this page as a symptom → cause → fix reference when agents fail, hang, or behave unexpectedly.

## Quick Triage Checklist

1. Reproduce with a minimal script using `runOnce()`.
2. Enable observability:

```typescript
.withObservability({ verbosity: "debug", live: true })
.withEvents()
```

3. Confirm provider/model settings and required env vars.
4. Run targeted tests for the affected package.
5. Verify resource cleanup (`await using` or explicit `dispose()`).

## Common Failures

### Model not found (Ollama)

**Symptom**
- `Model "..." not found locally. Run: ollama pull ...`

**Root cause**
- Local model is not downloaded, or wrong model alias is configured.

**Fix**
```bash
ollama pull qwen3.5
```

Use an explicit model in builder config:

```typescript
.withProvider("ollama")
.withModel("qwen3.5")
```

### Noisy FiberFailure error output

**Symptom**
- Error output includes nested `FiberFailure` and Cause internals.

**Root cause**
- Defects surfaced from `runPromise()` boundary without unwrapping.

**Fix**
- Use the runtime boundary methods (`build()`, `run()`, `runOnce()`) that unwrap framework errors.
- If running lower-level effects directly, normalize thrown errors before presenting them to users.

### Process hangs after run completes

**Symptom**
- Program does not exit after successful run.

**Root cause**
- Open MCP stdio subprocesses (or other long-lived transports) still active.

**Fix**
```typescript
await using agent = await ReactiveAgents.create()
  .withMCP({ name: "filesystem", transport: "stdio", command: "bunx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] })
  .build();
```

Or use one-shot execution:

```typescript
const result = await ReactiveAgents.create()
  .withProvider("anthropic")
  .runOnce("Summarize this file");
```

### Wrong model shown in metrics summary

**Symptom**
- Metrics header model does not match expected provider/model settings.

**Root cause**
- Provider defaults are being applied due to missing/overridden model config.

**Fix**
- Set both provider and model explicitly in the same builder chain.
- Verify no environment fallback is overriding your model selection.
- Inspect startup logs/events to confirm resolved model before first LLM call.

### Guardrail blocks expected input

**Symptom**
- Requests are rejected with guardrail violations.

**Root cause**
- Input contains high-risk patterns, PII-like strings, or policy-sensitive content.

**Fix**
- Subscribe to `GuardrailViolationDetected` and log structured details.
- Apply targeted allow/deny behavioral contracts instead of broad bypasses.
- Keep guardrails enabled; tune upstream input formatting and prompt scope.

### Budget exhausted / execution throttled

**Symptom**
- Agent pauses, degrades, or fails under budget policy.

**Root cause**
- Per-request/session/daily budgets reached.

**Fix**
- Lower context/tool result footprint with `withContextProfile()`.
- Prefer cheaper models for simple tasks.
- Reduce `maxIterations` for low-complexity workflows.

## Diagnostics by Layer

| Layer | What to check |
|---|---|
| LLM Provider | Provider key, model name, timeout/retry settings |
| Reasoning | Selected strategy, iteration count, structured output retries |
| Tools/MCP | Transport type, process cleanup, server auth headers |
| Memory | Tier setting, embedding provider config (Tier 2), DB file access |
| Cost | Router decisions, budget policy thresholds, cache hit rate |
| Observability | Live logs enabled, event subscriptions, phase latency spikes |

## High-Signal Commands

```bash
bun test packages/llm-provider/
bun test packages/tools/
bun test packages/runtime/
bun run build
```

## Escalation Template

When filing an issue, include:
- Exact builder chain (provider/model/features enabled)
- Full error message and stack
- Event/phase logs around failure
- Minimal reproducible script
- Whether behavior reproduces with `runOnce()`
