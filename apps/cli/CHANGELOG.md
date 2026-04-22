# @reactive-agents/cli

## 0.10.0

### Minor Changes

-   551477d: v0.10.0: Adaptive Tool Calling System, Reactive Intelligence Dispatcher, Calibration System, Benchmark Suite v2, and major Cortex Studio updates.

### Patch Changes

-   Updated dependencies [551477d]
    -   @reactive-agents/a2a@0.10.0
    -   @reactive-agents/core@0.10.0
    -   @reactive-agents/eval@0.10.0
    -   @reactive-agents/llm-provider@0.10.0
    -   @reactive-agents/runtime@0.10.0
    -   @reactive-agents/trace@0.11.0

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
