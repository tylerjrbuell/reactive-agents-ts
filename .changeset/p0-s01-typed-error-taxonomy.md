---
"@reactive-agents/a2a": minor
"@reactive-agents/benchmarks": minor
"@reactive-agents/cli": minor
"@reactive-agents/core": minor
"@reactive-agents/cost": minor
"@reactive-agents/eval": minor
"@reactive-agents/gateway": minor
"@reactive-agents/guardrails": minor
"@reactive-agents/health": minor
"@reactive-agents/identity": minor
"@reactive-agents/interaction": minor
"@reactive-agents/llm-provider": minor
"@reactive-agents/memory": minor
"@reactive-agents/observability": minor
"@reactive-agents/orchestration": minor
"@reactive-agents/prompts": minor
"@reactive-agents/reactive-intelligence": minor
"@reactive-agents/reasoning": minor
"@reactive-agents/runtime": minor
"@reactive-agents/testing": minor
"@reactive-agents/tools": minor
"@reactive-agents/verification": minor
"reactive-agents": minor
---

**core: typed framework error taxonomy (Phase 0 S0.1)**

Every framework-emitted error now extends one of six top-level kinds:

- `TransientError` (retryable, environmental) — `LLMTimeoutError`
- `CapacityError` (retryable, overload) — `LLMRateLimitError`
- `CapabilityError` (not retryable, structural gap) — `ModelCapabilityError`
- `ContractError` (not retryable, our bug) — `ToolIdempotencyViolation`
- `TaskError` (not retryable, ill-formed task) — `VerificationFailed` (existing `TaskError` class widened: `taskId` is now optional for backward compat with task-service consumers)
- `SecurityError` (not retryable, policy violation) — `ToolCapabilityViolation`

New `isRetryable(err)` helper classifies any error for retry rules. Retry rules across the codebase will migrate to `catchTag`/`catchTags` in Phase 2 (zero `catchAll(() => Effect.void)` remaining by end of P2).

Existing error classes (`AgentError`, `AgentNotFoundError`, `TaskError`, `ValidationError`, `RuntimeError`) continue to export unchanged. `TaskError` gains optional `taskId` — old `new TaskError({ taskId, message })` call-sites keep working.

See `packages/core/src/errors/index.ts` for JSDoc on each kind.
