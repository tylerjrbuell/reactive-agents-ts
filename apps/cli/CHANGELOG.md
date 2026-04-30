# @reactive-agents/cli

## 0.10.0

### Minor Changes

-   93ff679: **core: typed framework error taxonomy (Phase 0 S0.1)**

    Every framework-emitted error now extends one of six top-level kinds:

    -   `TransientError` (retryable, environmental) — `LLMTimeoutError`
    -   `CapacityError` (retryable, overload) — `LLMRateLimitError`
    -   `CapabilityError` (not retryable, structural gap) — `ModelCapabilityError`
    -   `ContractError` (not retryable, our bug) — `ToolIdempotencyViolation`
    -   `TaskError` (not retryable, ill-formed task) — `VerificationFailed` (existing `TaskError` class widened: `taskId` is now optional for backward compat with task-service consumers)
    -   `SecurityError` (not retryable, policy violation) — `ToolCapabilityViolation`

    New `isRetryable(err)` helper classifies any error for retry rules. Retry rules across the codebase will migrate to `catchTag`/`catchTags` in Phase 2 (zero `catchAll(() => Effect.void)` remaining by end of P2).

    Existing error classes (`AgentError`, `AgentNotFoundError`, `TaskError`, `ValidationError`, `RuntimeError`) continue to export unchanged. `TaskError` gains optional `taskId` — old `new TaskError({ taskId, message })` call-sites keep working.

    See `packages/core/src/errors/index.ts` for JSDoc on each kind.

-   e7f4df9: v0.10.0: Adaptive Tool Calling System, Reactive Intelligence Dispatcher, Calibration System, Benchmark Suite v2, and major Cortex Studio updates.

### Patch Changes

-   Updated dependencies [93ff679]
-   Updated dependencies [e7f4df9]
    -   @reactive-agents/a2a@0.10.0
    -   @reactive-agents/core@0.10.0
    -   @reactive-agents/eval@0.10.0
    -   @reactive-agents/llm-provider@0.10.0
    -   @reactive-agents/runtime@0.10.0
    -   @reactive-agents/trace@0.10.0

## 0.9.0

### Patch Changes

-   Updated dependencies
    -   @reactive-agents/core@0.9.0
    -   @reactive-agents/llm-provider@0.9.0
    -   @reactive-agents/runtime@0.9.0
    -   @reactive-agents/a2a@0.9.0
    -   @reactive-agents/eval@0.9.0

## 0.8.0

### Patch Changes

-   Updated dependencies [93eac55]
    -   @reactive-agents/core@0.8.0
    -   @reactive-agents/a2a@0.8.0
    -   @reactive-agents/eval@0.8.0
    -   @reactive-agents/llm-provider@0.8.0
    -   @reactive-agents/runtime@0.8.0

## 0.7.8

### Patch Changes

-   Updated dependencies
    -   @reactive-agents/core@0.7.8
    -   @reactive-agents/a2a@0.7.8
    -   @reactive-agents/eval@0.7.8
    -   @reactive-agents/llm-provider@0.7.8
    -   @reactive-agents/runtime@0.7.8

## 0.7.7

### Patch Changes

-   1023a93: Fix flaky `gcloud run deploy` CLI contract test — all gcloud tests were missing an explicit timeout, causing them to hit Bun's default 5s limit when `gcloud --help` commands were slow. Added `20_000ms` timeout matching `probe()`'s own timeout to all 7 gcloud tests.
    -   @reactive-agents/core@0.7.7
    -   @reactive-agents/llm-provider@0.7.7
    -   @reactive-agents/eval@0.7.7
    -   @reactive-agents/a2a@0.7.7
    -   @reactive-agents/runtime@0.7.7
