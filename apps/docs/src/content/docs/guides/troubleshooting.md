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

### Ollama model tag not found

**Symptom**
- `Model "cogito:14b" not found` or similar error when using a specific Ollama model tag.

**Root cause**
- The exact model tag (e.g. `cogito:14b`) has not been pulled locally, or the tag name differs from what Ollama has registered.

**Fix**
```bash
# List all locally available models and their exact tags
ollama list

# Pull the model you need (tag must match exactly)
ollama pull cogito
# or with a specific tag:
ollama pull cogito:14b
```

Then reference the exact tag in your builder chain:

```typescript
.withProvider("ollama")
.withModel("cogito:14b")
```

If the tag still fails after pulling, run `ollama list` again to confirm the registered name — tags may be normalized by Ollama (e.g. `:14b` → `:latest`).

### Double observability output

**Symptom**
- Console shows duplicate reasoning traces, events, or cost summaries on every run.

**Root cause**
- `.withObservability()` is on by default. Calling it explicitly a second time registers a second observer, producing duplicate output.

**Fix**
Remove the explicit `.withObservability()` call — the default configuration is already active:

```typescript
// ❌ Causes duplicate output
const agent = await ReactiveAgents.create()
  .withObservability({ verbosity: "debug", live: true })
  .withObservability() // ← redundant; adds a second observer
  .build()

// ✅ Correct — call it once, or rely on the default
const agent = await ReactiveAgents.create()
  .withObservability({ verbosity: "debug", live: true })
  .build()
```

Only call `.withObservability()` when you need to override the default verbosity or enable live streaming. Calling it with no arguments when you already have the default active is the most common source of duplicate output.

### CLI tool ENOENT (git-cli / gh-cli / gws-cli)

**Symptom**
- Tool call returns `spawn git ENOENT` or `command not found: gh`.

**Root cause**
- The built-in CLI tools (`git-cli`, `gh-cli`, `gws-cli`) are thin wrappers that invoke the corresponding system binary (`git`, `gh`, `gws`). If that binary is not on `PATH`, the tool fails immediately with ENOENT.

**Fix**
Install the missing binary and ensure it is on your `PATH`:

```bash
# Verify the binary is reachable
which git   # should print a path
which gh    # GitHub CLI — https://cli.github.com

# If not found, install via your package manager, then verify again
```

On systems where the binary exists but is not on the agent process's `PATH` (e.g. inside a Docker container or a restricted shell), set `PATH` explicitly before starting the agent or pass the full binary path via the tool's `executablePath` option.

### Sub-agent stops before reaching maxIterations

**Symptom**
- A sub-agent configured with `maxIterations: 10` (or any value > 3) stops after only 3 iterations.

**Root cause**
- This was a bug in earlier releases where the agent-tool adapter capped sub-agent `maxIterations` to 3, ignoring any higher user-supplied value.

**Fix**
Update to the current version — the cap has been removed and the user-supplied `maxIterations` is now honored:

```bash
# Check your installed version
rax --version

# Update to the latest release
pnpm update reactive-agents
```

If you are on a current version and still see the cap, verify that `maxIterations` is being set on the sub-agent's own builder chain, not on the parent agent:

```typescript
// ✅ Correct — maxIterations set on the sub-agent builder
const subAgent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withMaxIterations(10)
  .build()
```

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
