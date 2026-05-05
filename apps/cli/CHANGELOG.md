# @reactive-agents/cli

## 0.10.4

### Patch Changes

-   8fb1311: feat(cortex): publish @reactive-agents/cortex to npm with lazy-load CLI support

    -   Made cortex publishable to npm as a standalone package with tsup bundling
    -   Restored `rax cortex` command with lazy-load pattern for optional peer dependency
    -   Updated CLI with cortex command restoration and full documentation
    -   Synced all package versions to match coordinated releases
    -   Cortex fully validated: health API returns 200, UI serves correctly from npm install

-   fe4b058: Critical: Fix all package.json bun exports pointing to non-existent src/ directory. All packages were exporting `"bun": "./src/index.ts"` in their exports, but npm packages only include dist/. This caused Bun module resolution to fail when importing these packages from npm-installed CLI.

    This fix is critical for v0.10.1 release viability.

-   Updated dependencies [8fb1311]
-   Updated dependencies [fe4b058]
    -   @reactive-agents/trace@0.10.2
    -   @reactive-agents/a2a@0.10.4
    -   @reactive-agents/core@0.10.4
    -   @reactive-agents/eval@0.10.4
    -   @reactive-agents/llm-provider@0.10.4
    -   @reactive-agents/runtime@0.10.4

## 0.10.1

### Patch Changes

-   80284a4: Fix CLI module resolution: mark @reactive-agents/eval, @reactive-agents/llm-provider, @reactive-agents/a2a, @reactive-agents/trace, and @reactive-agents/tools as external dependencies in tsup config. This prevents bundling issues when the CLI is installed from npm and needs to dynamically require these modules at runtime.
-   Updated dependencies [80284a4]
    -   @reactive-agents/a2a@0.10.1
    -   @reactive-agents/core@0.10.1
    -   @reactive-agents/eval@0.10.1
    -   @reactive-agents/llm-provider@0.10.1
    -   @reactive-agents/runtime@0.10.1
    -   @reactive-agents/trace@0.10.1

## 0.10.0

### Patch Changes

-   Updated dependencies [2cfded2]
    -   @reactive-agents/a2a@0.10.0
    -   @reactive-agents/core@0.10.0
    -   @reactive-agents/eval@0.10.0
    -   @reactive-agents/llm-provider@0.10.0
    -   @reactive-agents/runtime@0.10.0
    -   @reactive-agents/trace@0.10.0

## 0.10.0

### Minor Changes

-   3f8146a: **core: typed framework error taxonomy (Phase 0 S0.1)**

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

### Patch Changes

-   Updated dependencies [3f8146a]
-   Updated dependencies [3f8146a]
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
